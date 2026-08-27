/**
 * authz.ts — CROSS-CUTTING: single permission choke point (G0.1, ADR-006)
 * ===========================================================================
 * EVERY authorization decision goes through `can()`. The matrix is data, so
 * it is exhaustively unit-testable (test/p0.test.ts walks every role ×
 * action pair). Route guards are thin wrappers around this module.
 *
 * MENTAL MODEL FOR NEW TEAM MEMBERS
 * ---------------------------------
 * 1. A request arrives with a Bearer token → `authenticate()` (auth.ts)
 *    resolves WHO is calling (userId).
 * 2. `buildActorContext()` gathers WHAT that person IS: every ACTIVE persona
 *    row (G0.1b: a person can be moderator + crowd_expert + learner at once)
 *    plus WHICH farms they own or are a member of.
 * 3. `can(ctx, action, resource)` answers the single question "may this
 *    actor perform this action on this resource?" — nothing else in the
 *    codebase decides permissions (single choke point rule).
 * 4. `requirePermission(action)` wraps steps 2–3 as a Fastify preHandler and
 *    attaches `request.actor` for handlers that need farm scoping.
 *
 * FAIL-SAFE RULES (security posture)
 * ----------------------------------
 * - Unknown action names are DENIED even for admins (fail closed).
 * - Missing/unknown farmId on farm-scoped actions is DENIED.
 * - Every denial is logged (debug in dev; warn for security-relevant ones)
 *   so production dashboards can alert on abnormal denial rates.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/V2_REQUIREMENTS_ANALYSIS.md §G0.1 (roles & visibility matrix)
 *   - docs/V2_REQUIREMENTS_ANALYSIS.md §G0.1b (multi-persona identity model)
 *   - docs/READINESS_REVIEW.md §3 guarantee #1 (server-side enforcement;
 *     client hiding is cosmetic only)
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IssueStage, Persona } from './types.js';
import { getUser, listUserPersonas, listFarmMembers } from './store.js';
import { makeLogger } from './logger.js';

// Scoped logger: every authorization decision can be traced in production
// with `grep '"scope":"authz"'`. Debug-level = normal flow; warn = denials.
const log = makeLogger('authz');

/** Everything an authorization check may need about the caller. */
export interface ActorContext {
  userId: string;
  /** Union of all active personas (G0.1b multi-persona model). */
  personas: Persona[];
  /** Farms this user OWNS. */
  ownedFarmIds: Set<string>;
  /** farmId → roleInFarm for memberships. */
  memberships: Map<string, 'owner' | 'moderator' | 'worker' | 'accountant'>;
}

/** Actions protected by the matrix. Extend as modules land. */
export type Action =
  | 'issue.view'
  | 'issue.create'
  | 'issue.advance'
  | 'issue.close'
  | 'task.create'
  /** Any-authenticated reads whose farm scoping happens IN THE HANDLER via
   *  assertFarmAccess() (generic lists like devices/videos/trees). */
  | 'device.view'
  | 'valve.control'
  | 'plan.manage'
  | 'subscription.assign'
  | 'persona.verify'
  | 'audit.view'
  | 'flag.manage';

/** Resources a guard may scope the check to. */
export interface ResourceRef {
  farmId?: string;
  issueStage?: IssueStage;
}

/** Resolve the full ActorContext for a user (store lookups + persona union). */
export function buildActorContext(userId: string): ActorContext | null {
  const user = getUser(userId);
  if (!user) return null;
  // Primary role is seeded as a persona row too; read both sources and union.
  const held = new Set<Persona>([user.role as Persona]);
  for (const p of listUserPersonas(userId)) {
    if (p.status === 'active') held.add(p.persona);
  }
  const owned = new Set<string>();
  const memberships = new Map<string, 'owner' | 'moderator' | 'worker' | 'accountant'>();
  for (const m of listFarmMembers(userId)) {
    if (m.roleInFarm === 'owner') owned.add(m.farmId);
    else memberships.set(m.farmId, m.roleInFarm);
  }
  return { userId, personas: [...held], ownedFarmIds: owned, memberships };
}

/** Every action `can()` knows about — unknown ones must FAIL CLOSED, even for admins. */
const KNOWN_ACTIONS: Action[] = [
  'issue.view', 'issue.create', 'issue.advance', 'issue.close', 'task.create',
  'device.view', 'valve.control',
  'plan.manage', 'subscription.assign', 'persona.verify', 'audit.view', 'flag.manage',
];

/** Is `ctx` allowed `action` on `resource`? THE decision function. */
export function can(ctx: ActorContext, action: Action, resource: ResourceRef = {}): boolean {
  if (!(KNOWN_ACTIONS as string[]).includes(action)) return false; // unknown → deny
  if (ctx.personas.includes('admin')) return true;

  switch (action) {
    // Farm-scoped visibility: any member (or the owner) of THAT farm.
    case 'issue.view':
      return belongsToFarm(ctx, resource.farmId);

    // Authenticated read — real scoping is enforced per-item in handlers
    // through assertFarmAccess(); this keeps generic lists usable while
    // individual resources stay protected.
    case 'device.view':
      return ctx.personas.length > 0;

    // Workers may REPORT problems; moderators/owners manage their farm's issues.
    case 'issue.create':
      return (
        belongsToFarmWithRole(ctx, resource.farmId, ['worker', 'moderator']) ||
        ctx.ownedFarmIds.has(resource.farmId ?? '')
      );

    // Advancing stages is further constrained per-stage inside modules/issues.ts
    case 'issue.advance':
      return (
        belongsToFarmWithRole(ctx, resource.farmId, ['worker', 'moderator']) ||
        ctx.ownedFarmIds.has(resource.farmId ?? '')
      );

    // Physical actuation is high-stakes: moderator+ ONLY (never workers).
    // Full audit trail is written by the route (ADR-013-adjacent safety rule).
    case 'valve.control':
      return (
        belongsToFarmWithRole(ctx, resource.farmId, ['moderator']) ||
        ctx.ownedFarmIds.has(resource.farmId ?? '')
      );

    // Closing requires authority over the farm.
    case 'issue.close':
      return (
        belongsToFarmWithRole(ctx, resource.farmId, ['moderator']) ||
        ctx.ownedFarmIds.has(resource.farmId ?? '')
      );

    // Platform administration is admin-only by definition.
    case 'plan.manage':
    case 'subscription.assign':
    case 'persona.verify':
    case 'audit.view':
    case 'flag.manage':
      return false;

    default:
      return false; // deny unknown actions — fail closed
  }
}

// --- helpers ----------------------------------------------------------------

/**
 * Handler-side tenancy assertion for item-level reads: the caller must own,
 * be a member of, or administer THAT farm. Throws nothing — returns boolean;
 * routes map false → 403.
 */
export function hasFarmAccess(ctx: ActorContext, farmId?: string): boolean {
  return !!farmId && belongsToFarm(ctx, farmId);
}

function belongsToFarm(ctx: ActorContext, farmId?: string): boolean {
  if (!farmId) return false;
  return ctx.ownedFarmIds.has(farmId) || ctx.memberships.has(farmId);
}

function belongsToFarmWithRole(
  ctx: ActorContext,
  farmId: string | undefined,
  roles: Array<'worker' | 'moderator' | 'accountant' | 'owner'>
): boolean {
  if (!farmId) return false;
  const r = ctx.memberships.get(farmId);
  return r !== undefined && roles.includes(r);
}

/**
 * Fastify preHandler factory used by /v2 routes:
 * resolves the session → ActorContext, evaluates `can()` (skipped when no
 * action given = auth-only), exposes both as request.session / request.actor.
 * Sends 401/403 itself otherwise.
 */
export function requirePermission(action?: Action, getResource?: (request: FastifyRequest) => ResourceRef) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = authenticateSession(request);
    if (!session) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const actor = buildActorContext(session.userId);
    if (!actor) {
      await reply.code(401).send({ error: 'Unknown user' });
      return;
    }
    if (action) {
      const resource = getResource ? getResource(request) : {};
      if (!can(actor, action, resource)) {
        // Denials are security signals: warn-level so they survive 'info'
        // production configs and can drive brute-force/IDOR alerts.
        log.warn('permission denied', {
          action,
          userId: session.userId,
          personas: actor.personas,
          resource,
        });
        await reply.code(403).send({ error: `Forbidden: ${action}` });
        return;
      }
      // Debug trace of every GRANTED decision — only visible with LOG_LEVEL=debug.
      log.debug('permission granted', { action, userId: session.userId, resource });
    }
    (request as any).session = session;
    (request as any).actor = actor;
  };
}

/** Inline token verification shared with auth.ts (kept DRY via import). */
import { authenticate } from './auth.js';
function authenticateSession(request: FastifyRequest) {
  return authenticate(request);
}

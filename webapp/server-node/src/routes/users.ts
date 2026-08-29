/**
 * routes/users.ts — user directory & rating statistics
 *   GET   /users                 → User[] (redacted for non-privileged callers)
 *   GET   /users/:id/stats       → {user, avgStars, count}    (auth: any)
 *   PATCH /admin/users/:id/role  → User                       (admin only, audited)
 *
 * SECURITY FIXES APPLIED
 * ----------------------
 *   GAP-01 / SEC-C1 — `createUser` accepted any string as a role because `Role`
 *     is erased at runtime. It now validates through security/roles.ts and is
 *     the single choke point for role assignment.
 *   SEC-M4 — the directory returned every user's email to any authenticated
 *     caller. Emails are now visible only to privileged roles.
 *   The id was `u-${role}-${Date.now()}`, which leaked the role and collided
 *     under concurrent registration; it is now a UUID.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { User } from '../types.js';
import { requireRole } from '../auth.js';
import { getUser, listUsers, ratingStats, insertUser, listFarmMembers } from '../store.js';
import { audit } from '../audit.js';
import {
  isKnownRole,
  isPrivilegedRole,
  resolveAdminAssignedRole,
  type AnyRole,
} from '../security/roles.js';

/**
 * Shared factory and the ONLY place a user record is created.
 * @throws TypeError when the role has not been validated by the caller — a
 *         loud failure is preferable to silently persisting an unknown role.
 */
export function createUser(name: string, email: string, role: AnyRole): User {
  if (!isKnownRole(role)) {
    throw new TypeError(`refusing to create a user with unrecognised role '${String(role)}'`);
  }
  const user: User = {
    id: `u-${randomUUID()}`,
    name,
    email,
    role,
    createdAt: Date.now(),
  };
  return insertUser(user);
}

/** Strip PII the caller has no need to see. */
function redact(user: User): Omit<User, 'email'> & { email?: string } {
  const { email, ...rest } = user;
  return rest;
}

/**
 * SEC — tenant scope for the directory: the caller plus everyone who shares at
 * least one farm with them. Without this, an authenticated worker (or an
 * external network expert, who belongs to no farm at all) could enumerate
 * every account on the platform.
 *
 * Platform `admin` is exempt because role administration operates across
 * tenants by definition; it is already the most audited role.
 */
function visibleUserIds(userId: string): Set<string> {
  const farms = new Set(listFarmMembers(userId).map((m) => m.farmId));
  const ids = new Set<string>([userId]);
  for (const m of listFarmMembers()) {
    if (farms.has(m.farmId)) ids.add(m.userId);
  }
  return ids;
}

export default async function userRoutes(app: FastifyInstance) {
  /**
   * Directory used by rating pickers and task assignment. Workers get names and
   * ids only; contact details stay with the roles that administer the farm.
   */
  app.get('/users', { preHandler: requireRole() }, async (request) => {
    const session = (request as any).session;
    const users = session?.role === 'admin'
      ? listUsers()
      : listUsers().filter((u) => visibleUserIds(session.userId).has(u.id));
    return isPrivilegedRole(session?.role) ? users : users.map(redact);
  });

  /** Aggregate evaluation stats for one person (Evaluations page stars). */
  app.get('/users/:id/stats', { preHandler: requireRole() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = getUser(id);
    const session = (request as any).session;
    // Out-of-tenant reads are indistinguishable from "no such user".
    if (!user || (session?.role !== 'admin' && !visibleUserIds(session.userId).has(id))) {
      return reply.code(404).send({ error: 'User not found' });
    }
    // Merge identity with the aggregate star summary for this person.
    const stats = ratingStats(id);
    return {
      user: isPrivilegedRole(session?.role) ? user : redact(user),
      avgStars: stats.avgStars,
      count: stats.count,
    };
  });

  /**
   * The ONLY privilege-elevation path. Requires an authenticated administrator
   * and writes an append-only audit record for every change.
   *
   * NOTE (accepted limitation): tokens already issued to the target user keep
   * their embedded role until expiry. `requireRole` re-reads the live user on
   * every request, so a demotion takes effect immediately for role checks;
   * full token revocation is tracked as WP-1.7.
   */
  app.patch(
    '/admin/users/:id/role',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const decision = resolveAdminAssignedRole(body.role);
      if (!decision.ok) {
        return reply.code(decision.status).send({ error: decision.error });
      }
      const target = getUser(id);
      if (!target) {
        return reply.code(404).send({ error: 'User not found' });
      }
      const session = (request as any).session;
      const previousRole = target.role;
      const updated: User = { ...target, role: decision.role };
      insertUser(updated);
      audit({
        actorId: session.userId,
        persona: session.role,
        action: 'user.role.changed',
        targetType: 'user',
        targetId: id,
        detail: { from: previousRole, to: decision.role },
      });
      return updated;
    },
  );
}

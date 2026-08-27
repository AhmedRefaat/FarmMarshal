/**
 * security/roles.ts — runtime role validation.
 *
 * Addresses: GAP-01 / SEC-C1 (public registration accepted an arbitrary,
 * caller-supplied `role`, including `admin`, because `Role` is erased at
 * runtime and nothing validated the value).
 *
 * The rule enforced here: a role only becomes trusted after passing through
 * this module. Route handlers must never cast a request body field to `Role`.
 */

import type { Role } from '../types.js';

/** Every role the platform recognises. Order is not significant. */
export const ALL_ROLES = ['owner', 'moderator', 'worker', 'admin'] as const;
export type AnyRole = (typeof ALL_ROLES)[number];

/**
 * Roles a caller may self-assign through unauthenticated public registration.
 * Deliberately the least-privileged role only — everything else is granted by
 * an administrator through the audited assignment flow.
 */
export const PUBLIC_SELF_SERVICE_ROLES: readonly AnyRole[] = ['worker'];

/** Role assigned when public registration omits one. */
export const DEFAULT_REGISTRATION_ROLE: AnyRole = 'worker';

/** Roles that confer authority over other users or other tenants. */
export const PRIVILEGED_ROLES: readonly AnyRole[] = ['admin', 'owner', 'moderator'];

export function isKnownRole(value: unknown): value is AnyRole {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value);
}

export function isPrivilegedRole(value: unknown): boolean {
  return isKnownRole(value) && PRIVILEGED_ROLES.includes(value);
}

export type RoleDecision =
  | { ok: true; role: AnyRole }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Decide the role for a public, unauthenticated registration request.
 *
 * Unknown values are a client error (400); known-but-privileged values are an
 * authorization failure (403) so the attempt is distinguishable in logs and
 * can be alerted on.
 */
export function resolvePublicRegistrationRole(requested: unknown): RoleDecision {
  if (requested === undefined || requested === null || requested === '') {
    return { ok: true, role: DEFAULT_REGISTRATION_ROLE };
  }
  if (!isKnownRole(requested)) {
    return { ok: false, status: 400, error: 'role is not a recognised value' };
  }
  if (!PUBLIC_SELF_SERVICE_ROLES.includes(requested)) {
    return {
      ok: false,
      status: 403,
      error: 'role cannot be self-assigned; privileged roles are granted by an administrator',
    };
  }
  return { ok: true, role: requested };
}

/**
 * Validate a role supplied by an authenticated administrator.
 * Authorization of the *caller* is the route's responsibility; this only
 * guarantees the value itself is one the platform understands.
 */
export function resolveAdminAssignedRole(requested: unknown): RoleDecision {
  if (!isKnownRole(requested)) {
    return { ok: false, status: 400, error: `role must be one of ${ALL_ROLES.join('|')}` };
  }
  return { ok: true, role: requested };
}

/** Narrow an already-validated role to the legacy `Role` union used by stored entities. */
export function asStoredRole(role: AnyRole): Role | 'admin' {
  return role;
}

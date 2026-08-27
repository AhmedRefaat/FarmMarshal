/**
 * security/config.ts — environment-derived security configuration with fail-fast.
 *
 * Addresses:
 *   SEC-H8 / SEC-C01 — AUTH_SECRET silently fell back to a committed literal.
 *   SEC-H5  — CORS reflected any origin (`origin: true`).
 *   REQ-OPS-003 — no documented configuration surface.
 *
 * Rule: the repository contains NO usable signing secret in any environment.
 * A non-development process must be given AUTH_SECRET or it refuses to start;
 * a development process mints a random per-process key instead of falling back
 * to a value an attacker can read out of the source tree.
 */

import { randomBytes } from 'node:crypto';

/**
 * The value that shipped in source before this fix. It is retained ONLY as a
 * deny-list entry — it is never returned as a usable secret. Treat every token
 * ever signed with it as forged.
 */
export const INSECURE_LEGACY_SECRET = 'agritasks-dev-secret';

/**
 * Values that are syntactically fine but are never a deliberate choice. A
 * deployment carrying one of these is misconfigured, not configured.
 */
export const PLACEHOLDER_SECRETS: readonly string[] = Object.freeze([
  INSECURE_LEGACY_SECRET,
  'changeme',
  'change-me',
  'secret',
  'password',
  'todo',
  'placeholder',
  'your-secret-here',
  'xxxxxxxx',
]);

/** Minimum accepted length for an operator-supplied secret, in characters. */
export const MIN_AUTH_SECRET_LENGTH = 32;

const DEV_ENVIRONMENTS = new Set(['development', 'test']);

export function currentEnv(): string {
  return process.env.NODE_ENV ?? 'development';
}

export function isDevLikeEnv(env = currentEnv()): boolean {
  return DEV_ENVIRONMENTS.has(env);
}

export class SecurityConfigError extends Error {}

/**
 * Ephemeral development key, generated once per process. Because it does not
 * survive a restart, tokens minted by a previous run stop verifying — which is
 * the behaviour operators need from a rotation anyway.
 */
let ephemeralDevSecret: string | undefined;
function developmentSecret(): string {
  ephemeralDevSecret ??= randomBytes(32).toString('hex');
  return ephemeralDevSecret;
}

function isPlaceholder(raw: string): boolean {
  const normalised = raw.trim().toLowerCase();
  return PLACEHOLDER_SECRETS.some((p) => normalised === p);
}

/** How many distinct characters the value uses — a cheap proxy for entropy. */
function looksTriviallyWeak(raw: string): boolean {
  return new Set(raw).size < 8;
}

/**
 * Resolve the token signing secret.
 *
 * A supplied value is validated in EVERY environment: a placeholder or a
 * trivially weak key is a configuration defect wherever it appears. Only the
 * consequence of omitting the variable differs — development mints a random
 * key, anything else refuses to start.
 *
 * @throws SecurityConfigError when the value is missing outside development,
 *         blank, a known placeholder, too short, or trivially weak.
 */
export function resolveAuthSecret(
  env = currentEnv(),
  raw = process.env.AUTH_SECRET,
): string {
  const devLike = isDevLikeEnv(env);

  if (raw === undefined || raw.trim() === '') {
    if (devLike) return developmentSecret();
    throw new SecurityConfigError(
      'AUTH_SECRET must be set in a non-development environment',
    );
  }
  if (isPlaceholder(raw)) {
    throw new SecurityConfigError(
      'AUTH_SECRET is a placeholder value and must be replaced with a generated secret',
    );
  }
  if (raw.length < MIN_AUTH_SECRET_LENGTH) {
    throw new SecurityConfigError(
      `AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters`,
    );
  }
  if (looksTriviallyWeak(raw)) {
    throw new SecurityConfigError(
      'AUTH_SECRET is trivially weak; use a randomly generated value',
    );
  }
  return raw;
}

/**
 * Boot-time description of the signing configuration. Reports validity and
 * provenance ONLY — the value and any derivative of it never appear here.
 */
export function describeAuthSecret(
  env = currentEnv(),
  raw = process.env.AUTH_SECRET,
): { source: 'environment' | 'ephemeral-development'; env: string; length: number } {
  const supplied = raw !== undefined && raw.trim() !== '';
  return {
    source: supplied ? 'environment' : 'ephemeral-development',
    env,
    length: resolveAuthSecret(env, raw).length,
  };
}

/**
 * Resolve the allowed CORS origins.
 * Development keeps the permissive reflect-any behaviour so Vite and LAN
 * devices work; every other environment requires an explicit allow-list.
 */
export function resolveCorsOrigins(
  env = currentEnv(),
  raw = process.env.CORS_ORIGINS,
): true | string[] {
  const configured = (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  if (isDevLikeEnv(env)) return true;
  throw new SecurityConfigError(
    'CORS_ORIGINS must list the allowed origins in a non-development environment',
  );
}

/**
 * Whether demo accounts with published passwords may be seeded.
 * Production seeding of fixed credentials is the SEC-C3 root cause and is
 * refused outright.
 */
export function allowDemoSeed(env = currentEnv()): boolean {
  if (process.env.ALLOW_DEMO_SEED === 'false') return false;
  return isDevLikeEnv(env);
}

/**
 * security/passwords.ts — password hashing at the single authentication seam.
 *
 * Addresses: GAP-03 / SEC-C3 (plaintext passwords were the entire credential store).
 *
 * KDF CHOICE — scrypt (RFC 7914), not Argon2id or bcrypt.
 *   OWASP Password Storage ranks Argon2id > scrypt > bcrypt > PBKDF2. Argon2id
 *   requires a native (node-gyp) build, which is a supply-chain and build-
 *   reliability risk on the Windows CI target and adds a compiled dependency.
 *   scrypt is memory-hard, ships in Node's stdlib, and needs zero new
 *   dependencies. Recorded as ADR-SEC-002; revisit if a prebuilt Argon2id
 *   binding becomes acceptable.
 *
 * Encoded form (self-describing so parameters can be raised without a flag day):
 *   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 */

import {
  randomBytes,
  scrypt as scryptCb,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Cost parameters. N=2^15 keeps a single hash near ~100 ms on commodity hardware. */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
/** scrypt needs ~128*N*r bytes; the default 32 MB cap is too low for N=32768. */
const MAXMEM = 128 * N * R * 2;

const PREFIX = 'scrypt';

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt-style truncation does not apply to scrypt, but an upper bound blocks DoS via huge inputs. */
export const PASSWORD_MAX_LENGTH = 1024;

/** True when `stored` is an encoded hash rather than a legacy plaintext value. */
export function isHashed(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(`${PREFIX}$`);
}

/**
 * Reject weak or abusive passwords before hashing.
 * @returns null when acceptable, otherwise a caller-safe reason string.
 */
export function validatePasswordPolicy(plain: unknown): string | null {
  if (typeof plain !== 'string' || plain.length === 0) return 'password is required';
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    return `password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (!/[a-zA-Z]/.test(plain) || !/[0-9]/.test(plain)) {
    return 'password must contain at least one letter and one digit';
  }
  return null;
}

/** Derive a fresh salted hash. Never logs or returns the plaintext. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [PREFIX, N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

/**
 * Blocking variant used only for seeding development fixtures at module load,
 * where the surrounding code path cannot await. Never call this on a request path.
 */
export function hashPasswordSync(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [PREFIX, N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

/**
 * Constant-time verification against an encoded hash.
 * Returns false (never throws) for malformed or unparsable stored values so a
 * corrupted record cannot escalate into a 500 or an authentication bypass.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Bound the parameters read from storage: a tampered record must not be able
  // to pin the event loop by requesting an enormous work factor.
  if (n < 2 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(plain, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: Math.max(MAXMEM, 128 * n * r * 2),
    });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

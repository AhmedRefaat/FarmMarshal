/**
 * security/rateLimit.ts — in-process fixed-window throttle for credential endpoints.
 *
 * Addresses: SEC-H7 (no brute-force protection on /auth/login or /auth/register).
 *
 * SCOPE LIMIT: this is per-process state. It is correct for the current
 * single-instance deployment and for tests, but it does NOT survive a restart
 * and does NOT coordinate across replicas. Horizontal scaling requires a shared
 * store (Redis) — tracked as ADR-SEC-006 / WP-1.9.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Remaining attempts in the current window; 0 once blocked. */
  remaining: number;
  /** Seconds until the window resets. Suitable for a Retry-After header. */
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Record an attempt against `key` and decide whether it may proceed. */
  consume(key: string, now = Date.now()): RateLimitDecision {
    this.evictExpired(now);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterSeconds: 0 };
    }
    bucket.count += 1;
    if (bucket.count > this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }
    return {
      allowed: true,
      remaining: this.limit - bucket.count,
      retryAfterSeconds: 0,
    };
  }

  /** Clear a key after a successful authentication so honest users are not penalised. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Test seam — drops all state. */
  clear(): void {
    this.buckets.clear();
  }

  private evictExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

const WINDOW_MS = 15 * 60 * 1000;

/** Login attempts are keyed by client IP + submitted email to slow credential stuffing. */
export const loginLimiter = new RateLimiter(
  Number(process.env.RATE_LIMIT_LOGIN ?? 10),
  WINDOW_MS,
);

/** Registration is keyed by client IP only to slow bulk account creation. */
export const registerLimiter = new RateLimiter(
  Number(process.env.RATE_LIMIT_REGISTER ?? 5),
  WINDOW_MS,
);

/**
 * Build a rate-limit key. The email is lower-cased and length-capped; it is
 * used only as a bucket key and must never be logged.
 */
export function credentialKey(ip: string | undefined, email?: string): string {
  const safeIp = ip && ip.length <= 64 ? ip : 'unknown';
  if (!email) return safeIp;
  return `${safeIp}|${email.toLowerCase().slice(0, 254)}`;
}

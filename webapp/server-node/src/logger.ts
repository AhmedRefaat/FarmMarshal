/**
 * logger.ts — CROSS-CUTTING: application logging with mode + level control
 * ===========================================================================
 * WHAT THIS SOLVES
 * ----------------
 * The owner asked for three observable behaviours:
 *   1. Ability to SEE the app's logs while running.
 *   2. Ability to ENABLE/DISABLE logging overall.
 *   3. Separate CUSTOMER logging (what we ship/collect in production) from
 *      DEV logging (verbose, human-readable during development).
 *
 * HOW IT WORKS
 * ------------
 * Two environment variables control everything — no code changes needed:
 *
 *   LOG_LEVEL  = off | error | warn | info | debug     (default: info)
 *                'off' disables ALL output (requirement 2).
 *                'debug' adds developer-only detail (requirement 3, dev side).
 *
 *   LOG_FORMAT = dev | json                            (default: depends on NODE_ENV)
 *                dev  → human-readable coloured lines for terminals (dev mode)
 *                json → one-line machine-parseable JSON per event; this is the
 *                       "customer" format shipped to production log collectors
 *                       (CloudWatch/Datadog/ELK parse it natively).
 *
 * USAGE
 * -----
 *   import { makeLogger } from './logger.js';
 *   const log = makeLogger('issues');       // scope shown in every line
 *   log.info('issue created', { id });      // visible at info+
 *   log.debug('stage rule eval', {...});    // visible ONLY at debug
 *   log.warn(...); log.error(...);
 *
 * DESIGN RULES
 * ------------
 * - Logging NEVER throws and NEVER blocks business logic (all output is
 *   wrapped; a broken stdout must not fail an HTTP request).
 * - Audit trail ≠ logging: the append-only audit_log (src/audit.ts) records
 *   security-relevant actions to the DATABASE and runs regardless of log
 *   level. Logs are ephemeral diagnostics; audit is compliance evidence.
 * - Secrets (passwords, tokens) must never be passed as metadata.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - Owner review "enable/disable logs, customer vs dev logging" (2026-08-25)
 *   - docs/ARCHITECTURE_EVOLUTION_PLAN.md §6 Security (no secrets in logs)
 */

/** Ordered severities; 'off' sits below everything so nothing prints. */
type Level = 'off' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<Level, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/** Read once at boot; changing env vars requires restart (documented behaviour). */
const CURRENT_LEVEL: Level = (process.env.LOG_LEVEL as Level) || 'info';
const CURRENT_FORMAT: 'dev' | 'json' =
  (process.env.LOG_FORMAT as 'dev' | 'json') ||
  (process.env.NODE_ENV === 'production' ? 'json' : 'dev');

/** ANSI colour codes — terminal-only nicety, stripped naturally by collectors. */
const COLORS = {
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  info: '\x1b[36m', // cyan
  debug: '\x1b[90m', // grey
  reset: '\x1b[0m',
} as const;

/** ISO timestamp helper (UTC, collector-friendly). */
function timestamp(): string {
  return new Date().toISOString();
}

/** Serialise metadata safely: undefined → omitted; circular refs tolerated. */
function metaString(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  try {
    return ' ' + JSON.stringify(meta);
  } catch {
    return ' [unserializable metadata]';
  }
}

/**
 * Create a scoped logger. One instance per module keeps output greppable:
 * `grep '"scope":"authz"'` finds every permission decision in production.
 */
export interface Logger {
  /** Severity-gated emitters; each accepts a message + optional metadata. */
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export function makeLogger(scope: string): Logger {
  /** Core emitter shared by the four severity methods. */
  function emit(level: Exclude<Level, 'off'>, msg: string, meta?: Record<string, unknown>) {
    // Gate 1 — global kill switch / level filter ('off' disables EVERYTHING).
    if (LEVEL_ORDER[CURRENT_LEVEL] === 0) return;
    if (LEVEL_ORDER[level] > LEVEL_ORDER[CURRENT_LEVEL]) return;

    if (CURRENT_FORMAT === 'json') {
      // Customer/production format: stable keys for log queries & alerts.
      const line = JSON.stringify({ ts: timestamp(), level, scope, msg, ...meta });
      write(line);
    } else {
      // Developer format: readable, coloured, scoped.
      const color = COLORS[level];
      write(
        `${color}[${timestamp()}] ${level.toUpperCase().padEnd(5)} [${scope}]${COLORS.reset} ${msg}${metaString(meta)}`
      );
    }
  }

  /** Isolate stdout failures so logging can never crash the app. */
  function write(line: string) {
    try {
      console.log(line);
    } catch {
      /* ignore — logging must never throw */
    }
  }

  return {
    error: (m, meta) => emit('error', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    info: (m, meta) => emit('info', m, meta),
    debug: (m, meta) => emit('debug', m, meta),
  };
}

/** Boot-time banner proving the chosen configuration (visible when enabled). */
export function logBootConfig() {
  const log = makeLogger('boot');
  log.info('logging configured', { level: CURRENT_LEVEL, format: CURRENT_FORMAT });
}

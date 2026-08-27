/**
 * audit.ts — CROSS-CUTTING: append-only audit trail (READINESS_REVIEW §3)
 * ---------------------------------------------------------------------------
 * Sensitive actions (valve commands, persona verification, stage closures…)
 * call `audit()`; admins read the trail via /v2/audit. Append-only by design.
 *
 * IMPORTANT DISTINCTION (owner requirement on logging)
 * ----------------------------------------------------
 * Audit is DATABASE evidence and runs REGARDLESS of LOG_LEVEL — turning logs
 * off never erases the compliance trail. Logs (src/logger.ts) are ephemeral
 * diagnostics; audit_log is the permanent record.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/READINESS_REVIEW.md §3 guarantee #1 + §4 security tests
 *   - docs/ARCHITECTURE_EVOLUTION_PLAN.md §2 `audit_log` DDL
 */

import { randomUUID } from 'node:crypto';
import type { AuditEntry } from './types.js';
import { insertAudit } from './store.js';

export function audit(entry: Omit<AuditEntry, 'id' | 'at'>): AuditEntry {
  return insertAudit({ ...entry, id: randomUUID(), at: Date.now() });
}

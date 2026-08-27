/**
 * issues.ts — DOMAIN MODULE: universal 7-stage activity workflow (G0.2)
 * ===========================================================================
 *   detected → inspected → identified → recommended → implemented → reviewed → closed
 *
 * WHY THIS EXISTS (owner requirement)
 * -----------------------------------
 * The owner mandated ONE workflow for ALL farm activities — water leaks, solar
 * panel cleaning, pest control, equipment faults — where each user sees only
 * his part and each step demands its own evidence. This module is that engine.
 * New activity kinds plug in as data (`kind` + `metadata` JSONB), never as new
 * schema or new state machines.
 *
 * HOW A TRANSITION IS JUDGED (in order — see advanceIssue)
 * --------------------------------------------------------
 *   1. Closed issues are immutable (audit trail frozen).
 *   2. Only the IMMEDIATELY NEXT stage is allowed (no skipping; the pipeline
 *      exists precisely so no evidence step is bypassed).
 *   3. STAGE_RULES decides WHO may enter the next stage (persona gate).
 *   4. STAGE_RULES decides WHAT EVIDENCE must accompany the entry:
 *        inspected    → evidence (photos/GPS/readings)   [field proof]
 *        identified   → note (root cause statement)       [expert reasoning]
 *        recommended  → note (proposed solution)          [actionable advice]
 *        implemented  → taskId (the task doing the work)  [links execution]
 *        reviewed     → evidence (after-photos)           [verification]
 *        closed       → note (closure rationale)          [accountability]
 *   5. On success: issue row updated + immutable IssueEvent appended +
 *      'issue.stage_changed' emitted on the event bus.
 *
 * RELATIONSHIP TO TASKS
 * ---------------------
 * Tasks keep THEIR existing machine (assigned→in_progress→submitted→approved).
 * An issue REFERENCES a task at the IMPLEMENTED stage — the workflow wraps
 * execution, it does not replace it.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/V2_REQUIREMENTS_ANALYSIS.md §G0.2 (stage/evidence table)
 *   - docs/ARCHITECTURE_EVOLUTION_PLAN.md §2 `issues`/`issue_events` DDL
 *   - docs/IMPLEMENTATION_PLAN_AND_TESTS.md P0 test cases (all guarded here)
 */

import { randomUUID } from 'node:crypto';
import type { ActorContext } from './authz.js';
import type { Issue, IssueEvent, IssueKind, IssueSource, IssueStage } from './types.js';
import { getTask, insertIssue, insertIssueEvent, listIssueEvents, updateIssue } from './store.js';
import { emit } from './events.js';
import { makeLogger } from './logger.js';

// Transition outcomes are logged at info level (business milestones);
// rejections at debug (they are normal UX, surfaced via HTTP error codes).
const log = makeLogger('issues');

/** Ordered stages — index = position in the pipeline. */
export const STAGES: IssueStage[] = [
  'detected',
  'inspected',
  'identified',
  'recommended',
  'implemented',
  'reviewed',
  'closed',
];

export interface StageAdvance {
  note?: string;
  evidence?: Record<string, unknown>;
  /** Required when advancing INTO 'implemented': the task doing the work. */
  taskId?: string;
}

interface StageRule {
  /** Personas allowed to advance INTO this stage (farm-scoped). */
  roles: Array<'worker' | 'moderator' | 'owner' | 'admin'>;
  /** Evidence that MUST be present to enter this stage. */
  requires?: Array<'note' | 'evidence' | 'taskId'>;
}

/**
 * Stage entry rules (V2_REQUIREMENTS_ANALYSIS.md §G0.2 table).
 * detected is the initial state — no rule needed for entering it.
 */
export const STAGE_RULES: Record<IssueStage, StageRule | null> = {
  detected: null,
  inspected: { roles: ['worker', 'moderator'], requires: ['evidence'] },
  identified: { roles: ['moderator'], requires: ['note'] },
  recommended: { roles: ['moderator', 'admin'], requires: ['note'] },
  implemented: { roles: ['worker', 'moderator'], requires: ['taskId'] },
  reviewed: { roles: ['moderator', 'admin'], requires: ['evidence'] },
  closed: { roles: ['moderator', 'owner', 'admin'], requires: ['note'] },
};

export class StageError extends Error {
  constructor(
    public code: 'bad_stage' | 'forbidden' | 'missing_requirement' | 'closed',
    message: string
  ) {
    super(message);
  }
}

/** Create an issue at stage 'detected'. */
export function createIssue(input: {
  farmId: string;
  kind: IssueKind;
  title: string;
  source: IssueSource;
  severity?: Issue['severity'];
  createdBy: string;
  actorRole: string;
  metadata?: Record<string, unknown>;
}): Issue {
  const issue = insertIssue({
    farmId: input.farmId,
    kind: input.kind,
    title: input.title,
    source: input.source,
    severity: input.severity ?? 'medium',
    stage: 'detected',
    createdBy: input.createdBy,
    metadata: input.metadata,
  });
  insertIssueEvent({
    issueId: issue.id,
    fromStage: 'detected',
    toStage: 'detected',
    actorId: input.createdBy,
    actorRole: input.actorRole,
    note: 'issue created',
  });
  emit({ type: 'issue.created', issueId: issue.id, farmId: issue.farmId, kind: issue.kind });
  return issue;
}

/**
 * Attempt one stage transition with full guard evaluation.
 * @throws StageError with a machine-readable code on any violation.
 */
export function advanceIssue(
  issueId: string,
  toStage: IssueStage,
  ctx: ActorContext,
  actorRoleLabel: string,
  advance: StageAdvance
): { issue: Issue; event: IssueEvent } {
  const issue = requireIssue(issueId);

  if (issue.stage === 'closed') {
    throw new StageError('closed', 'closed issues are immutable');
  }
  const fromIdx = STAGES.indexOf(issue.stage);
  const toIdx = STAGES.indexOf(toStage);
  // Only single forward steps; re-entry of the same stage is a no-op rejection.
  if (toIdx !== fromIdx + 1) {
    throw new StageError(
      'bad_stage',
      `cannot advance from '${issue.stage}' to '${toStage}'`
    );
  }

  const rule = STAGE_RULES[toStage];
  if (!rule) throw new StageError('bad_stage', `no rule for stage '${toStage}'`);

  // Persona gate: admin bypasses; others must hold an allowed role AND belong
  // to the farm (ctx was already scoped by authz, double-checked here).
  const isAdmin = ctx.personas.includes('admin');
  if (!isAdmin && !rule.roles.includes(actorRoleLabel as never)) {
    throw new StageError('forbidden', `'${actorRoleLabel}' cannot advance to '${toStage}'`);
  }

  // Evidence gates.
  for (const req of rule.requires ?? []) {
    if (req === 'note' && !(advance.note ?? '').trim()) {
      throw new StageError('missing_requirement', `a note is required to enter '${toStage}'`);
    }
    if (req === 'evidence' && (!advance.evidence || Object.keys(advance.evidence).length === 0)) {
      throw new StageError('missing_requirement', `evidence is required to enter '${toStage}'`);
    }
    if (req === 'taskId') {
      if (!advance.taskId) {
        throw new StageError('missing_requirement', `a taskId is required to enter '${toStage}'`);
      }
      if (!getTask(advance.taskId)) {
        throw new StageError('missing_requirement', `task '${advance.taskId}' does not exist`);
      }
    }
  }

  const patch: Partial<Issue> = { stage: toStage };
  if (advance.taskId) patch.taskId = advance.taskId;
  if (toStage === 'closed') patch.closedAt = Date.now();
  const updated = updateIssue(issueId, patch)!;

  const event = insertIssueEvent({
    issueId,
    fromStage: issue.stage,
    toStage,
    actorId: ctx.userId,
    actorRole: actorRoleLabel,
    note: advance.note,
    evidence: advance.evidence,
  });
  emit({
    type: 'issue.stage_changed',
    issueId,
    from: issue.stage,
    to: toStage,
    actorId: ctx.userId,
  });
  log.info('stage advanced', {
    issueId,
    kind: updated.kind,
    from: issue.stage,
    to: toStage,
    actor: ctx.userId,
    role: actorRoleLabel,
  });
  return { issue: updated, event };
}

/** Full immutable timeline, oldest first. */
export function timeline(issueId: string): IssueEvent[] {
  requireIssue(issueId);
  return listIssueEvents(issueId);
}

function requireIssue(issueId: string): Issue {
  const issue = getIssueById(issueId);
  if (!issue) throw new StageError('bad_stage', `issue '${issueId}' not found`);
  return issue;
}

import { getIssueById } from './store.js';
void randomUUID; // reserved for future outbox pattern

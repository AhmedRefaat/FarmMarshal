/**
 * routes/tasks.ts — task CRUD + lifecycle transitions
 *   GET   /tasks?status=&workerId=  → Task[]   (scoped to caller)
 *   GET   /tasks/:id                → Task     (membership + assignment checked)
 *   POST  /tasks                    → Task     (moderator|owner, own farm)
 *   PATCH /tasks/:id/status         → Task     (role + state + ownership)
 *
 * SECURITY FIXES APPLIED
 * ----------------------
 *   SEC-C4 (BOLA / OWASP A01) — every route here was authenticated but not
 *   authorized at the object level:
 *     · GET /tasks returned every task on the platform to any logged-in user.
 *     · GET /tasks/:id had no ownership check at all.
 *     · PATCH /tasks/:id/status checked the caller's ROLE but never whether the
 *       task belonged to them, so any worker could start or submit any other
 *       worker's task and any moderator could approve another farm's work.
 *   Access is now derived from farm membership, and workers are further limited
 *   to tasks assigned to them.
 *
 * Lifecycle guards mirror the mobile app's state machine exactly
 * (ARCHITECTURE.md §4.2) so both clients stay consistent.
 */

import type { FastifyInstance } from 'fastify';
import type { Session, Task, TaskStatus } from '../types.js';
import { requireRole } from '../auth.js';
import {
  getFarm,
  getTask,
  getUser,
  insertTask,
  listComments,
  listFarmMembers,
  listIssueEvents,
  listIssues,
  listTasks,
  updateTask,
} from '../store.js';
import { financeEntriesForTask } from './farmsFinance.js';

/** Farms the caller belongs to. Empty means the caller is in no tenant. */
function farmIdsFor(userId: string): Set<string> {
  return new Set(listFarmMembers(userId).map((m) => m.farmId));
}

/** Identity fields safe to show inside a report — never the credential seam. */
function publicUser(userId?: string) {
  if (!userId) return null;
  const u = getUser(userId);
  return u ? { id: u.id, name: u.name, role: u.role } : null;
}

/**
 * Object-level authorization for a single task.
 * Workers only ever reach their own assignments; moderators and owners reach
 * anything inside a farm they are a member of. Admins are handled by their own
 * farm memberships too — platform admin does not imply tenant data access.
 */
function canAccessTask(session: Session, task: Task, farms: Set<string>): boolean {
  if (!farms.has(task.farmId)) return false;
  if (session.role === 'worker') {
    return task.workerId === session.userId;
  }
  return true;
}

export default async function taskRoutes(app: FastifyInstance) {
  /** Filterable listing powering the TaskList table and Dashboard KPIs. */
  app.get('/tasks', { preHandler: requireRole() }, async (request) => {
    const q = request.query as { status?: string; workerId?: string };
    const session = (request as any).session as Session;
    const farms = farmIdsFor(session.userId);
    // Scope first, then apply the caller's display filters.
    return listTasks({ status: q.status, workerId: q.workerId }).filter((t) =>
      canAccessTask(session, t, farms),
    );
  });

  /** Single task fetch (TaskDetail page). */
  app.get('/tasks/:id', { preHandler: requireRole() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    const session = (request as any).session as Session;
    // 404 rather than 403 so the endpoint cannot be used to probe which task
    // ids exist in other farms.
    if (!canAccessTask(session, task, farmIdsFor(session.userId))) {
      return reply.code(404).send({ error: 'Task not found' });
    }
    return task;
  });

  /**
   * Full audit report for ONE task — everything that happened to it from the
   * moment it was reported until it was solved, in a single response so the
   * owner/moderator does not have to stitch four endpoints together.
   * Same object-level authorization as GET /tasks/:id.
   */
  app.get('/tasks/:id/report', { preHandler: requireRole() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTask(id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    const session = (request as any).session as Session;
    if (!canAccessTask(session, task, farmIdsFor(session.userId))) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    // The issue that this task implements, if the workflow created one.
    const issue = listIssues({ farmId: task.farmId }).find((i) => i.taskId === task.id);
    const comments = listComments(task.id);

    // What the corrective action cost. Only the people who can already read the
    // task get this, and only rows booked against this task — the rest of the
    // farm ledger stays behind /finances.
    const costs = financeEntriesForTask(task.id);
    const sum = (type: 'expense' | 'income') =>
      costs.filter((c) => c.type === type).reduce((n, c) => n + c.amount, 0);
    const expense = sum('expense');
    const income = sum('income');

    return {
      task,
      farm: getFarm(task.farmId) ?? null,
      // "reporter" is whoever opened the work: the issue author when the task
      // came out of the 7-stage workflow, otherwise the assigning moderator.
      reporter: publicUser(issue?.createdBy ?? task.assigneeId),
      assignee: publicUser(task.assigneeId),
      worker: publicUser(task.workerId),
      issue: issue ?? null,
      issueEvents: issue ? listIssueEvents(issue.id) : [],
      comments,
      costs,
      costTotal: {
        expense,
        income,
        net: income - expense,
        // A mixed-currency ledger cannot be summed; the demo is single-currency
        // and the first row decides the label.
        currency: costs[0]?.currency ?? 'EGP',
      },
      // Lifecycle stamps flattened into one ordered list for the timeline UI.
      // `by` is a display name (never an internal id) so the report reads as a
      // narrative without the client needing a second lookup.
      milestones: [
        { key: 'created', at: task.createdAt, by: publicUser(task.assigneeId)?.name ?? task.assigneeId },
        { key: 'started', at: task.startedAt, by: publicUser(task.workerId)?.name ?? task.workerId },
        { key: 'submitted', at: task.submittedAt, by: publicUser(task.workerId)?.name ?? task.workerId },
        { key: 'reviewed', at: task.reviewedAt, by: publicUser(task.assigneeId)?.name ?? task.assigneeId, note: task.reviewNote },
      ].filter((m) => typeof m.at === 'number'),
    };
  });

  /**
   * Create a problem/assignment on the land.
   * The moderator becomes the reviewer (assigneeId); a worker is required.
   */
  app.post(
    '/tasks',
    { preHandler: requireRole('moderator', 'owner') },
    async (request, reply) => {
      const b = (request.body ?? {}) as Record<string, unknown>;
      if (
        typeof b.title !== 'string' ||
        b.title.trim().length === 0 ||
        typeof b.workerId !== 'string' ||
        typeof b.lat !== 'number' ||
        typeof b.lng !== 'number' ||
        !Number.isFinite(b.lat) ||
        !Number.isFinite(b.lng) ||
        b.lat < -90 ||
        b.lat > 90 ||
        b.lng < -180 ||
        b.lng > 180
      ) {
        return reply.code(400).send({
          error: 'title, workerId and a valid lat/lng are required',
        });
      }
      const session = (request as any).session as Session;
      const farms = farmIdsFor(session.userId);

      // The farm is chosen by the server from the creator's memberships; a
      // caller-supplied farmId is honoured only if they belong to it.
      const requestedFarmId = typeof b.farmId === 'string' ? b.farmId : undefined;
      const farmId = requestedFarmId ?? [...farms][0];
      if (!farmId || !farms.has(farmId)) {
        return reply.code(403).send({ error: 'not a member of the target farm' });
      }

      // The assigned worker must belong to the same farm — otherwise a
      // moderator could push work into another tenant's roster.
      if (!farmIdsFor(b.workerId).has(farmId)) {
        return reply.code(400).send({ error: 'workerId is not a member of this farm' });
      }

      const task = insertTask({
        farmId,
        title: b.title.trim(),
        description: typeof b.description === 'string' ? b.description : '',
        lat: b.lat,
        lng: b.lng,
        status: 'assigned', // always start at the beginning of the machine
        assigneeId: session.userId,
        workerId: b.workerId,
      });
      return reply.code(201).send(task);
    }
  );

  /**
   * State-machine transitions.
   *   start   : assigned → in_progress            [worker, assigned worker only]
   *   submit  : in_progress → submitted           [worker, assigned worker only]
   *   approve : submitted → approved              [moderator|owner, same farm]
   *   reject  : submitted → rejected              [moderator|owner, same farm]
   */
  app.patch('/tasks/:id/status', { preHandler: requireRole() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { action, note } = (request.body ?? {}) as { action?: string; note?: string };
    const task = getTask(id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    const session = (request as any).session as Session;

    // Object-level check BEFORE any state reasoning, so an unauthorized caller
    // cannot learn the task's status from the error code.
    if (!canAccessTask(session, task, farmIdsFor(session.userId))) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    // Map each action to its allowed FROM-state(s), TO-state, and roles.
    const rules: Record<string, { from: TaskStatus[]; to: TaskStatus; roles: string[]; ts: keyof typeof task }> = {
      start: { from: ['assigned'], to: 'in_progress', roles: ['worker'], ts: 'startedAt' },
      submit: { from: ['in_progress'], to: 'submitted', roles: ['worker'], ts: 'submittedAt' },
      approve: { from: ['submitted'], to: 'approved', roles: ['moderator', 'owner'], ts: 'reviewedAt' },
      reject: { from: ['submitted'], to: 'rejected', roles: ['moderator', 'owner'], ts: 'reviewedAt' },
    };
    const rule = action ? rules[action] : undefined;
    if (!rule) return reply.code(400).send({ error: `action must be one of ${Object.keys(rules).join('|')}` });
    if (!rule.roles.includes(session.role)) {
      return reply.code(403).send({ error: `${session.role} cannot perform '${action}'` });
    }
    // A worker may only drive their own assignment forward.
    if (session.role === 'worker' && task.workerId !== session.userId) {
      return reply.code(403).send({ error: 'task is not assigned to you' });
    }
    // A reviewer must not approve their own work.
    if ((action === 'approve' || action === 'reject') && task.workerId === session.userId) {
      return reply.code(403).send({ error: 'cannot review your own work' });
    }
    if (!rule.from.includes(task.status)) {
      return reply.code(409).send({ error: `cannot '${action}' from status '${task.status}'` });
    }

    // Apply transition + its timestamp + optional review note.
    return updateTask(id, {
      status: rule.to,
      [rule.ts]: Date.now(),
      ...(note !== undefined && (action === 'approve' || action === 'reject')
        ? { reviewNote: String(note) }
        : {}),
    });
  });
}

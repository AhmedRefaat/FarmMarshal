/**
 * demoApi.ts — the entire backend, running inside the browser tab.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * GitHub Pages (and any static host) serves files, not processes: the Fastify
 * and Axum trails cannot run there. When the bundle is built with
 * `VITE_DEMO_MODE=1`, every call in api.ts is answered from here instead of
 * over HTTP, so the published link is a complete, self-contained product tour
 * with no server, no database and no network dependency.
 *
 * HOW IT WORKS
 * Reads are *recorded*, not re-implemented: scripts/record-demo-fixture.mjs
 * captures the real server's responses per persona into fixture.json, and this
 * module replays them. That keeps the demo honest — including the 403s a
 * worker gets on owner-only endpoints — and means no business rule is written
 * twice. Writes are applied to an in-memory copy of the snapshot so the demo
 * still *feels* live (add a comment, approve a task, book a cost).
 *
 * DELIBERATE LIMITS (do not report these as bugs)
 *   • Nothing persists: a page reload restores the recorded snapshot.
 *   • Derived aggregates are NOT recomputed after a write. Booking a new cost
 *     updates the ledger and its summary, but a report opened afterwards still
 *     shows the recorded totals.
 *   • "Login" is a lookup against the demo accounts printed on the sign-in
 *     screen. It is theatre, not authentication — never put anything in the
 *     fixture that is not already public demo data.
 *
 * See docs/STATIC_DEMO_DEPLOYMENT.md for the full picture and the refresh
 * procedure when the seed changes.
 */

import fixture from './fixture.json';
import type {
  ChatMessage,
  Comment,
  Consultation,
  ConsultationResponse,
  Rating,
  Task,
  TaskStatus,
  User,
} from '../types';

/**
 * On by default for production builds: there is no API to talk to on a static
 * host. Set VITE_DEMO_MODE=0 when building against a real deployed backend.
 */
export const DEMO_MODE =
  import.meta.env.VITE_DEMO_MODE === '1' ||
  (import.meta.env.PROD && import.meta.env.VITE_DEMO_MODE !== '0');

/** A captured HTTP response: the status matters as much as the body. */
export interface DemoResponse {
  status: number;
  body: any;
}

interface PersonaSnapshot {
  user: User;
  responses: Record<string, DemoResponse>;
}

const PERSONAS = (fixture as any).personas as Record<string, PersonaSnapshot>;

/**
 * The accounts listed on the login screen. These are demo passwords, already
 * printed in the UI and in the README — not secrets.
 */
const CREDENTIALS: Record<string, string> = {
  'owner@agri.com': 'pass123',
  'moderator@agri.com': 'pass123',
  'worker@agri.com': 'pass123',
  'worker2@agri.com': 'pass123',
  'expert1@agri.com': 'pass123',
  'expert2@agri.com': 'pass123',
  'admin@agri.com': 'admin123',
};

const TOKEN_PREFIX = 'demo:';

/** The working copy. Mutations land here and die with the tab. */
let session: { email: string; snap: PersonaSnapshot } | null = null;
let counter = 0;

const ok = (body: unknown): DemoResponse => ({ status: 200, body });
const fail = (status: number, error: string): DemoResponse => ({
  status,
  body: { error },
});

/** Deep copy so a second sign-in starts from the pristine recording. */
function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

/**
 * Rebuild the session from the stored token after a reload. The token is not
 * signed — in a static bundle there is nothing to sign it with, and nothing to
 * protect: every persona's data is already in the downloaded fixture.
 */
function current(): PersonaSnapshot | null {
  if (session) return session.snap;
  const token = localStorage.getItem('farmmarshal_token');
  if (!token?.startsWith(TOKEN_PREFIX)) return null;
  const email = token.slice(TOKEN_PREFIX.length);
  const snap = PERSONAS[email];
  if (!snap) return null;
  session = { email, snap: clone(snap) };
  return session.snap;
}

/** Recorded GET, or 404 for a path the recorder never visited. */
function replay(snap: PersonaSnapshot, path: string): DemoResponse {
  return (
    snap.responses[`GET ${path}`] ?? fail(404, `No recording for GET ${path}`)
  );
}

/** Append to a recorded list response, ignoring paths that were never captured. */
function push(snap: PersonaSnapshot, key: string, row: unknown): void {
  const entry = snap.responses[key];
  if (entry?.status === 200 && Array.isArray(entry.body)) entry.body.push(row);
}

function id(prefix: string): string {
  counter += 1;
  return `${prefix}-demo-${counter}`;
}

/** A short pause so loading states render the way they do against a real API. */
const pause = () => new Promise((r) => setTimeout(r, 90));

// ---------------------------------------------------------------------------
// Writes — small mirrors of the server rules, not a second implementation.
// ---------------------------------------------------------------------------

/** Mirrors the transition table in server-node/src/routes/tasks.ts. */
const TRANSITIONS: Record<
  string,
  { from: TaskStatus[]; to: TaskStatus; ts: keyof Task; roles: string[] }
> = {
  start: { from: ['assigned'], to: 'in_progress', ts: 'startedAt', roles: ['worker'] },
  submit: { from: ['in_progress'], to: 'submitted', ts: 'submittedAt', roles: ['worker'] },
  approve: { from: ['submitted'], to: 'approved', ts: 'reviewedAt', roles: ['moderator', 'owner'] },
  reject: { from: ['submitted'], to: 'rejected', ts: 'reviewedAt', roles: ['moderator', 'owner'] },
};

function transition(
  snap: PersonaSnapshot,
  taskId: string,
  action: string,
  note?: string
): DemoResponse {
  const rule = TRANSITIONS[action];
  if (!rule) return fail(400, `action must be one of ${Object.keys(TRANSITIONS).join('|')}`);
  if (!rule.roles.includes(snap.user.role)) {
    return fail(403, `${snap.user.role} cannot perform '${action}'`);
  }
  const list = snap.responses['GET /tasks']?.body as Task[] | undefined;
  const task = list?.find((t) => t.id === taskId);
  if (!task) return fail(404, 'Task not found');
  if (!rule.from.includes(task.status)) {
    return fail(409, `cannot '${action}' from status '${task.status}'`);
  }

  task.status = rule.to;
  (task as any)[rule.ts] = Date.now();
  if (note !== undefined && (action === 'approve' || action === 'reject')) {
    task.reviewNote = String(note);
  }
  // The same task is embedded in two other recordings; keep them in step.
  const single = snap.responses[`GET /tasks/${taskId}`];
  if (single?.status === 200) single.body = clone(task);
  const report = snap.responses[`GET /tasks/${taskId}/report`];
  if (report?.status === 200) report.body.task = clone(task);
  return ok(task);
}

function addComment(snap: PersonaSnapshot, taskId: string, fields: Partial<Comment>): Comment {
  const comment: Comment = {
    id: id('c'),
    taskId,
    authorId: snap.user.id,
    authorName: snap.user.name,
    authorRole: snap.user.role,
    createdAt: Date.now(),
    ...fields,
  };
  push(snap, `GET /tasks/${taskId}/comments`, comment);
  const report = snap.responses[`GET /tasks/${taskId}/report`];
  if (report?.status === 200) report.body.comments?.push(comment);
  return comment;
}

/** Recompute the KPI cards from the ledger rows we hold for that scope. */
function refreshFinanceSummary(snap: PersonaSnapshot, farmId?: string): void {
  const rowsKey = `GET /finances?farmId=${farmId ?? ''}`;
  const sumKey = `GET /finances/summary${farmId ? `?farmId=${farmId}` : ''}`;
  const rows = snap.responses[rowsKey]?.body as any[] | undefined;
  const summary = snap.responses[sumKey];
  if (!Array.isArray(rows) || summary?.status !== 200) return;
  let totalExpense = 0;
  let totalIncome = 0;
  const byCategory: Record<string, number> = {};
  for (const e of rows) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    if (e.type === 'expense') totalExpense += e.amount;
    else totalIncome += e.amount;
  }
  summary.body = { totalExpense, totalIncome, net: totalIncome - totalExpense, byCategory };
}

function mutate(
  snap: PersonaSnapshot,
  method: string,
  path: string,
  body: any
): DemoResponse {
  let m: RegExpMatchArray | null;

  if (method === 'POST' && (m = path.match(/^\/tasks\/([^/]+)\/comments$/))) {
    return ok(addComment(snap, m[1], { text: String(body?.text ?? '') }));
  }

  if (method === 'PATCH' && (m = path.match(/^\/tasks\/([^/]+)\/status$/))) {
    return transition(snap, m[1], String(body?.action ?? ''), body?.note);
  }

  if (method === 'POST' && path === '/tasks') {
    const task: Task = {
      id: id('t'),
      farmId: (snap.responses['GET /farms']?.body?.[0]?.id as string) ?? 'f-1',
      title: String(body?.title ?? ''),
      description: String(body?.description ?? ''),
      lat: Number(body?.lat ?? 0),
      lng: Number(body?.lng ?? 0),
      status: 'assigned',
      assigneeId: snap.user.id,
      workerId: String(body?.workerId ?? ''),
      createdAt: Date.now(),
    };
    push(snap, 'GET /tasks', task);
    snap.responses[`GET /tasks/${task.id}`] = ok(clone(task));
    snap.responses[`GET /tasks/${task.id}/comments`] = ok([]);
    return ok(task);
  }

  if (method === 'POST' && path === '/ratings') {
    const rating: Rating = {
      id: id('r'),
      raterId: snap.user.id,
      rateeId: String(body?.rateeId ?? ''),
      stars: Number(body?.stars ?? 0),
      comment: body?.comment ? String(body.comment) : undefined,
      createdAt: Date.now(),
    };
    push(snap, `GET /ratings?rateeId=${rating.rateeId}`, rating);
    return ok(rating);
  }

  if (method === 'POST' && path === '/finances') {
    const row = {
      id: id('fe'),
      farmId: String(body?.farmId ?? ''),
      type: body?.type === 'income' ? 'income' : 'expense',
      category: String(body?.category ?? 'other'),
      amount: Number(body?.amount ?? 0),
      currency: String(body?.currency ?? 'SAR'),
      note: body?.note ? String(body.note) : undefined,
      taskId: body?.taskId ? String(body.taskId) : undefined,
      createdById: snap.user.id,
      createdAt: Date.now(),
    };
    push(snap, 'GET /finances?farmId=', row);
    push(snap, `GET /finances?farmId=${row.farmId}`, row);
    refreshFinanceSummary(snap);
    refreshFinanceSummary(snap, row.farmId);
    return ok(row);
  }

  if (method === 'POST' && path === '/v2/consultations') {
    const consultation: Consultation = {
      id: id('con'),
      requesterId: snap.user.id,
      requesterName: snap.user.name,
      question: String(body?.question ?? ''),
      bountyEgp: Number(body?.bountyEgp ?? 0),
      platformCommissionPct: 15,
      scope: body?.scope === 'targeted' ? 'targeted' : 'public',
      status: 'open',
      language: String(body?.language ?? 'ar'),
      createdAt: Date.now(),
      responseCount: 0,
      mine: true,
    };
    push(snap, 'GET /v2/consultations', consultation);
    snap.responses[`GET /v2/consultations/${consultation.id}`] = ok({
      consultation,
      responses: [],
      isRequester: true,
      canRespond: false,
    });
    return ok(consultation);
  }

  if (method === 'POST' && (m = path.match(/^\/v2\/consultations\/([^/]+)\/responses$/))) {
    const detail = snap.responses[`GET /v2/consultations/${m[1]}`];
    if (detail?.status !== 200) return fail(404, 'Consultation not found');
    const response: ConsultationResponse = {
      id: id('res'),
      consultationId: m[1],
      responderId: snap.user.id,
      responderName: snap.user.name,
      answer: String(body?.answer ?? ''),
      payoutStatus: 'none',
      createdAt: Date.now(),
    };
    detail.body.responses.push(response);
    detail.body.canRespond = false;
    const listed = (snap.responses['GET /v2/consultations']?.body as Consultation[])?.find(
      (c) => c.id === m![1]
    );
    if (listed) {
      listed.responseCount = (listed.responseCount ?? 0) + 1;
      listed.answered = true;
    }
    return ok({ ok: true, id: response.id });
  }

  if (method === 'PATCH' && (m = path.match(/^\/v2\/consultations\/([^/]+)\/choose$/))) {
    const detail = snap.responses[`GET /v2/consultations/${m[1]}`];
    if (detail?.status !== 200) return fail(404, 'Consultation not found');
    const chosen = detail.body.responses.find(
      (r: ConsultationResponse) => r.id === body?.responseId
    );
    if (!chosen) return fail(404, 'Response not found');
    const consultation = detail.body.consultation as Consultation;
    const commission =
      Math.round(consultation.bountyEgp * (consultation.platformCommissionPct / 100) * 100) / 100;
    const net = Math.round((consultation.bountyEgp - commission) * 100) / 100;
    consultation.status = 'chosen';
    consultation.chosenResponseId = chosen.id;
    chosen.commissionAmount = commission;
    chosen.netPayoutEgp = net;
    chosen.payoutStatus = 'pending';
    chosen.conversationId = chosen.conversationId ?? id('cv');
    return ok({ consultation, conversationId: chosen.conversationId, netPayoutEgp: net });
  }

  if (method === 'POST' && (m = path.match(/^\/v2\/consultations\/([^/]+)\/rate$/))) {
    const detail = snap.responses[`GET /v2/consultations/${m[1]}`];
    if (detail?.status !== 200) return fail(404, 'Consultation not found');
    const stars = Number(body?.stars ?? 0);
    const chosen = detail.body.responses.find(
      (r: ConsultationResponse) => r.id === detail.body.consultation.chosenResponseId
    );
    if (chosen) chosen.ratingStars = stars;
    detail.body.consultation.status = 'settled';
    return ok({ avgStars: stars });
  }

  if (method === 'POST' && (m = path.match(/^\/v2\/chat\/([^/]+)\/messages$/))) {
    const message: ChatMessage = {
      id: id('msg'),
      conversationId: m[1],
      senderId: snap.user.id,
      senderName: snap.user.name,
      type: 'text',
      originalText: String(body?.text ?? ''),
      pinned: false,
      createdAt: Date.now(),
    };
    push(snap, `GET /v2/chat/${m[1]}/messages`, message);
    return ok(message);
  }

  return fail(501, `${method} ${path} is not available in the offline demo`);
}

// ---------------------------------------------------------------------------
// Entry points used by api.ts
// ---------------------------------------------------------------------------

/** Stands in for `fetch` when the bundle was built in demo mode. */
export async function demoRequest(
  path: string,
  opts: RequestInit
): Promise<DemoResponse> {
  await pause();
  const method = (opts.method ?? 'GET').toUpperCase();
  const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined;

  if (method === 'POST' && path === '/auth/login') {
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (!CREDENTIALS[email] || CREDENTIALS[email] !== body?.password) {
      return fail(401, 'Invalid credentials');
    }
    session = { email, snap: clone(PERSONAS[email]) };
    return ok({ token: TOKEN_PREFIX + email, user: session.snap.user });
  }

  const snap = current();
  if (!snap) return fail(401, 'Not signed in');
  return method === 'GET' ? replay(snap, path) : mutate(snap, method, path, body);
}

/**
 * Voice notes stay entirely local: the blob is kept as an object URL, so
 * playback works in this tab and nowhere else.
 */
export async function demoAudioComment(taskId: string, blob: Blob): Promise<Comment> {
  await pause();
  const snap = current();
  if (!snap) throw new Error('Not signed in');
  return addComment(snap, taskId, { audioUrl: URL.createObjectURL(blob) });
}

/** Drop the working copy on logout so the next persona starts clean. */
export function demoEndSession(): void {
  session = null;
}

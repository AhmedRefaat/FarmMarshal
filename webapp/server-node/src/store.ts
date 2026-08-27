/**
 * store.ts — PERSISTENCE LAYER (repository)
 * ===========================================================================
 * In-memory data store + seed data. ALL data access flows through THIS file —
 * swapping to PostgreSQL (db/schema.sql, ADR-004) re-implements only these
 * functions; no handler or domain-module changes.
 *
 * STRUCTURE FOR NEW TEAM MEMBERS
 * ------------------------------
 *   db  → original collections (users/tasks/comments/ratings)
 *   db2 → P0–P7 collections (farms/issues/chat/water/solar/trees/market/academy)
 *   Seed functions run once at import: demo farm, accounts, plans, devices,
 *   48h telemetry WITH an intentional night-flow leak fixture, dusty panel-B
 *   fixture, two trees (GPS vs relative-code identity cases).
 *
 * CONCURRENCY: single-process Fastify mutates synchronously around awaits;
 * plain Maps are safe at this scale. Postgres swap removes the caveat.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - ARCHITECTURE_EVOLUTION_PLAN.md §2 (DDL mirror of these shapes) · ADR-004
 *   - IMPLEMENTATION_PLAN_AND_TESTS.md fixtures referenced inline below
 *
 * Concurrency: Node is single-threaded per process; Fastify handlers run
 * synchronously around mutations, so plain Maps are safe here.
 */

import type {
  AuditEntry,
  Comment,
  Farm,
  FarmMember,
  FeatureKey,
  Issue,
  IssueEvent,
  Payment,
  Plan,
  PlanFeature,
  Rating,
  Role,
  Subscription,
  Task,
  User,
  UserPersona,
} from './types.js';
import {
  hashPasswordSync,
  verifyPassword as verifyPasswordHash,
} from './security/passwords.js';
import { allowDemoSeed } from './security/config.js';

/** Simple auto-incrementing ID factory (dev only; use UUIDs in production). */
let seq = 100;
const nextId = () => `id-${++seq}`;

/** The entire database. Each collection is a Map keyed by entity id. */
const db = {
  users: new Map<string, User>(),
  tasks: new Map<string, Task>(),
  comments: new Map<string, Comment>(),
  ratings: new Map<string, Rating>(),
  // --- P0 collections (ADR-004: swap to Postgres via schema.sql) ---
  farms: new Map<string, Farm>(),
  farmMembers: new Map<string, FarmMember>(),
  userPersonas: new Map<string, UserPersona>(),
  issues: new Map<string, Issue>(),
  issueEvents: new Map<string, IssueEvent>(),
  plans: new Map<string, Plan>(),
  planFeatures: new Map<string, PlanFeature>(), // key: `${planId}:${featureKey}`
  subscriptions: new Map<string, Subscription>(),
  payments: new Map<string, Payment>(),
  auditLog: new Map<string, AuditEntry>(),
};

/**
 * Credential store — email → encoded scrypt hash. Never holds plaintext.
 *
 * SEC-C3: this map previously held plaintext passwords and was the entire
 * authentication database. Demo fixtures are seeded only when
 * allowDemoSeed() permits it, so a production-like NODE_ENV starts with no
 * accounts rather than with published credentials.
 */
const credentials = new Map<string, string>();

/** Fixed development logins. Values are hashed at load; they never persist as plaintext. */
const DEMO_CREDENTIALS: ReadonlyArray<readonly [string, string]> = [
  ['owner@agri.com', 'pass123'],
  ['moderator@agri.com', 'pass123'],
  ['worker@agri.com', 'pass123'],
  ['admin@agri.com', 'admin123'],
];

function seedDemoCredentials(): void {
  if (!allowDemoSeed()) return;
  for (const [email, plain] of DEMO_CREDENTIALS) {
    credentials.set(email.toLowerCase(), hashPasswordSync(plain));
  }
}
seedDemoCredentials();

/** Store or replace a credential. `hash` must already be an encoded scrypt hash. */
export function setPasswordHash(email: string, hash: string): void {
  credentials.set(email.toLowerCase(), hash);
}

/** True when the address has a credential on file. Used by tests and admin flows. */
export function hasCredential(email: string): boolean {
  return credentials.has(email.toLowerCase());
}

function seed() {
  const owner: User = { id: 'u-owner', name: 'Land Owner', email: 'owner@agri.com', role: 'owner', createdAt: Date.now() };
  const moderator: User = { id: 'u-mod', name: 'Field Moderator', email: 'moderator@agri.com', role: 'moderator', createdAt: Date.now() };
  const worker: User = { id: 'u-worker', name: 'Field Worker', email: 'worker@agri.com', role: 'worker', createdAt: Date.now() };
  const admin: User = { id: 'u-admin', name: 'Platform Admin', email: 'admin@agri.com', role: 'admin', createdAt: Date.now() };
  [owner, moderator, worker, admin].forEach((u) => db.users.set(u.id, u));

  // Demo farm binding the three accounts together (tenancy root).
  db.farms.set('f-1', {
    id: 'f-1',
    ownerId: owner.id,
    name: 'Demo Nile Delta Farm',
    centerLat: 30.05,
    centerLng: 31.23,
    createdAt: Date.now(),
  });
  const member = (id: string, userId: string, roleInFarm: FarmMember['roleInFarm']): FarmMember => ({
    id,
    farmId: 'f-1',
    userId,
    roleInFarm,
    createdAt: Date.now(),
  });
  db.farmMembers.set('fm-owner', member('fm-owner', owner.id, 'owner'));
  db.farmMembers.set('fm-mod', member('fm-mod', moderator.id, 'moderator'));
  db.farmMembers.set('fm-worker', member('fm-worker', worker.id, 'worker'));

  // Persona rows mirror primary roles (G0.1b union source of truth).
  const personaRow = (userId: string, persona: UserPersona['persona'], status: UserPersona['status'] = 'active'): UserPersona => ({
    id: `p-${userId}-${persona}`,
    userId,
    persona,
    status,
    createdAt: Date.now(),
  });
  for (const u of [owner, moderator, worker, admin]) db.userPersonas.set(personaRow(u.id, u.role).id, personaRow(u.id, u.role));

  // Plans + features (SUBSCRIPTION_AND_PAYMENTS_DESIGN §1 tiers).
  const planDefs: Array<[string, string, string, number, Array<[FeatureKey, boolean]>]> = [
    ['pl-basic', 'basic', 'Basic', 0, [['reports', false], ['water_iot', false], ['solar_iot', false], ['video_platform', false], ['marketplace', false], ['chat_translation', true], ['robot_integration', false]]],
    ['pl-standard', 'standard', 'Standard', 500, [['reports', true], ['water_iot', true], ['solar_iot', true], ['video_platform', true], ['marketplace', false], ['chat_translation', true], ['robot_integration', false]]],
    ['pl-premium', 'premium', 'Premium', 1200, [['reports', true], ['water_iot', true], ['solar_iot', true], ['video_platform', true], ['marketplace', true], ['chat_translation', true], ['robot_integration', true]]],
  ];
  for (const [id, code, name, price, feats] of planDefs) {
    db.plans.set(id, { id, code, name, monthlyEgp: price, createdAt: Date.now() });
    for (const [featureKey, enabled] of feats) {
      const pf: PlanFeature = { planId: id, featureKey, enabled };
      db.planFeatures.set(`${id}:${featureKey}`, pf);
    }
  }
  // Demo farm runs Standard so water/solar dashboards are alive.
  db.subscriptions.set('sub-1', {
    id: 'sub-1',
    farmId: 'f-1',
    planId: 'pl-standard',
    status: 'active',
    periodStart: Date.now() - 86400_000,
    periodEnd: Date.now() + 30 * 86400_000,
    autoRenew: true,
    createdAt: Date.now(),
  });

  // Two starter tasks covering different lifecycle stages for the dashboard.
  db.tasks.set('t-1', {
    id: 't-1', farmId: 'f-1', title: 'Irrigation leak sector C',
    description: 'Main drip line leaking near valve C2; replace connector.',
    lat: 30.05, lng: 31.23, status: 'submitted',
    assigneeId: moderator.id, workerId: worker.id,
    beforePhotoUrl: '', afterPhotoUrl: '',
    createdAt: Date.now() - 86400_000,
    startedAt: Date.now() - 82800_000,
    submittedAt: Date.now() - 7200_000,
  });
  db.tasks.set('t-2', {
    id: 't-2', farmId: 'f-1', title: 'Weed control north field',
    description: 'Manual weeding rows 1–14; remove and compost biomass.',
    lat: 30.06, lng: 31.24, status: 'assigned',
    assigneeId: moderator.id, workerId: worker.id,
    createdAt: Date.now() - 3600_000,
  });

  // Starter issue mid-workflow so the Issues board has content.
  db.issues.set('is-1', {
    id: 'is-1',
    farmId: 'f-1',
    kind: 'water_leak',
    stage: 'inspected',
    source: 'human_report',
    title: 'Suspected leak — main line sector C',
    severity: 'high',
    taskId: 't-1',
    createdBy: moderator.id,
    createdAt: Date.now() - 43200_000,
  });

  db.comments.set('c-1', {
    id: 'c-1', taskId: 't-1', authorId: owner.id, authorName: owner.name,
    authorRole: 'owner',
    text: 'Please double-check water pressure after the fix.',
    createdAt: Date.now() - 7000_000,
  });
}
seed();

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Find a user by email (login lookup). */
export function findUserByEmail(email: string): User | undefined {
  return [...db.users.values()].find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
}

/** Verify a password at THE single authentication seam. Constant-time. */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const stored = credentials.get(email.toLowerCase());
  if (!stored) return false;
  return verifyPasswordHash(password, stored);
}

/** All users — owners/moderators need directories for rating & assignment. */
export function listUsers(): User[] {
  return [...db.users.values()];
}

export function getUser(id: string): User | undefined {
  return db.users.get(id);
}

/** Persist a new user (used by /auth/register). */
export function insertUser(user: User): User {
  db.users.set(user.id, user);
  return user;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** List tasks with optional filters (status / worker) used by dashboards. */
export function listTasks(filter?: { status?: string; workerId?: string }): Task[] {
  let tasks = [...db.tasks.values()];
  if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
  if (filter?.workerId) tasks = tasks.filter((t) => t.workerId === filter.workerId);
  return tasks.sort((a, b) => b.createdAt - a.createdAt); // newest first
}

export function getTask(id: string): Task | undefined {
  return db.tasks.get(id);
}

export function insertTask(data: Omit<Task, 'id' | 'createdAt'>): Task {
  const task: Task = { ...data, id: nextId(), createdAt: Date.now() };
  db.tasks.set(task.id, task);
  return task;
}

/** Apply a partial update (status transitions, photo URLs…). */
export function updateTask(id: string, patch: Partial<Task>): Task | undefined {
  const task = db.tasks.get(id);
  if (!task) return undefined;
  const updated = { ...task, ...patch };
  db.tasks.set(id, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Comments (text + audio)
// ---------------------------------------------------------------------------

/** Comment thread for a task, oldest first (chat-style reading order). */
export function listComments(taskId: string): Comment[] {
  return [...db.comments.values()]
    .filter((c) => c.taskId === taskId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function insertComment(data: Omit<Comment, 'id' | 'createdAt'>): Comment {
  const comment: Comment = { ...data, id: nextId(), createdAt: Date.now() };
  db.comments.set(comment.id, comment);
  return comment;
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export function insertRating(data: Omit<Rating, 'id' | 'createdAt'>): Rating {
  const rating: Rating = { ...data, id: nextId(), createdAt: Date.now() };
  db.ratings.set(rating.id, rating);
  return rating;
}

/** All ratings for one ratee, newest first (profile page feed). */
export function listRatingsFor(rateeId: string): Rating[] {
  return [...db.ratings.values()]
    .filter((r) => r.rateeId === rateeId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Aggregate stats powering the Evaluations page stars. */
export function ratingStats(rateeId: string): { avgStars: number; count: number } {
  const all = listRatingsFor(rateeId);
  if (all.length === 0) return { avgStars: 0, count: 0 };
  const sum = all.reduce((acc, r) => acc + r.stars, 0);
  return { avgStars: Math.round((sum / all.length) * 10) / 10, count: all.length };
}

/** May `rater` rate `ratee`? Central rule table from ARCHITECTURE.md §1. */
export function canRate(raterRole: Role, rateeRole: Role): boolean {
  if (raterRole === 'owner') return rateeRole === 'moderator' || rateeRole === 'worker';
  if (raterRole === 'moderator') return rateeRole === 'worker';
  return false; // workers cannot rate anyone
}

// ---------------------------------------------------------------------------
// P0 accessors — farms / personas / issues / entitlements / audit
// ---------------------------------------------------------------------------

export function getFarm(id: string): Farm | undefined {
  return db.farms.get(id);
}
export function listFarms(): Farm[] {
  return [...db.farms.values()];
}
export function listFarmMembers(userId?: string): FarmMember[] {
  const all = [...db.farmMembers.values()];
  return userId ? all.filter((m) => m.userId === userId) : all;
}

export function listUserPersonas(userId: string): UserPersona[] {
  return [...db.userPersonas.values()].filter((p) => p.userId === userId);
}
export function insertPersona(p: UserPersona): UserPersona {
  db.userPersonas.set(p.id, p);
  return p;
}
export function updatePersonaStatus(userId: string, persona: UserPersona['persona'], status: UserPersona['status']): UserPersona | undefined {
  const row = [...db.userPersonas.values()].find((p) => p.userId === userId && p.persona === persona);
  if (!row) return undefined;
  row.status = status;
  return row;
}

// --- Issues + timeline ------------------------------------------------------

export function listIssues(filter?: { farmId?: string; kind?: string; stage?: string }): Issue[] {
  let items = [...db.issues.values()];
  if (filter?.farmId) items = items.filter((i) => i.farmId === filter.farmId);
  if (filter?.kind) items = items.filter((i) => i.kind === filter.kind);
  if (filter?.stage) items = items.filter((i) => i.stage === filter.stage);
  return items.sort((a, b) => b.createdAt - a.createdAt);
}
export function getIssueById(id: string): Issue | undefined {
  return db.issues.get(id);
}
export function insertIssue(data: Omit<Issue, 'id' | 'createdAt'>): Issue {
  const issue: Issue = { ...data, id: nextId(), createdAt: Date.now() };
  db.issues.set(issue.id, issue);
  return issue;
}
export function updateIssue(id: string, patch: Partial<Issue>): Issue | undefined {
  const cur = db.issues.get(id);
  if (!cur) return undefined;
  const updated = { ...cur, ...patch };
  db.issues.set(id, updated);
  return updated;
}
export function insertIssueEvent(data: Omit<IssueEvent, 'id' | 'at'>): IssueEvent {
  const e: IssueEvent = { ...data, id: nextId(), at: Date.now() };
  db.issueEvents.set(e.id, e);
  return e;
}
export function listIssueEvents(issueId: string): IssueEvent[] {
  return [...db.issueEvents.values()]
    .filter((e) => e.issueId === issueId)
    .sort((a, b) => a.at - b.at); // oldest first = reading order
}

// --- Entitlements ------------------------------------------------------------

export function listPlans(): Plan[] {
  return [...db.plans.values()];
}
export function getPlanFeature(planId: string, featureKey: FeatureKey): PlanFeature | undefined {
  return db.planFeatures.get(`${planId}:${featureKey}`);
}
export function getActiveSubscription(farmId: string): Subscription | undefined {
  return [...db.subscriptions.values()].find(
    (s) =>
      s.farmId === farmId &&
      (s.status === 'active' || s.status === 'trial') &&
      s.periodEnd > Date.now()
  );
}
export function assignSubscription(data: Omit<Subscription, 'id' | 'createdAt'>): Subscription {
  // One active subscription per farm — supersede any previous one.
  for (const [id, s] of db.subscriptions) if (s.farmId === data.farmId) db.subscriptions.delete(id);
  const sub: Subscription = { ...data, id: `sub-${nextId()}`, createdAt: Date.now() };
  db.subscriptions.set(sub.id, sub);
  return sub;
}
export function insertPayment(data: Omit<Payment, 'id' | 'createdAt'>): Payment {
  const p: Payment = { ...data, id: `pay-${nextId()}`, createdAt: Date.now() };
  db.payments.set(p.id, p);
  return p;
}
export function listPayments(): Payment[] {
  return [...db.payments.values()].sort((a, b) => b.createdAt - a.createdAt);
}

// --- Audit + flags ------------------------------------------------------------

export function insertAudit(e: AuditEntry): AuditEntry {
  db.auditLog.set(e.id, e);
  return e;
}
export function listAudit(limit = 200): AuditEntry[] {
  return [...db.auditLog.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}

const flags = new Map<string, { key: string; farmId: string | null; enabled: boolean }>();
export function getFlags(): Array<{ id: string; key: string; farmId: string | null; enabled: boolean }> {
  return [...flags.entries()].map(([id, f]) => ({ id, ...f }));
}
export function setFlag(f: { id: string; key: string; farmId: string | null; enabled: boolean }) {
  flags.set(`${f.key}:${f.farmId ?? 'global'}`, { key: f.key, farmId: f.farmId, enabled: f.enabled });
  return f;
}

// ===========================================================================
// P1–P7 collections + accessors. Same repository pattern as above — the
// Postgres swap re-implements ONLY this file (ADR-004 seam).
// ===========================================================================

import type {
  Consultation,
  ConsultationResponse,
  Conversation,
  DailyPanelReport,
  Device,
  ExpertProfile,
  ExpertVerification,
  LearningCase,
  Message,
  MessageReaction,
  Panel,
  Quiz,
  QuizAttempt,
  QuizQuestion,
  Schedule,
  SpeciesProfile,
  Telemetry,
  Tree,
  TreeEvent,
  ValveCommand,
  Video,
  VideoAnnotation,
  WaterTariff,
  WeatherSample,
} from './types.js';

const db2 = {
  conversations: new Map<string, Conversation>(),
  messages: new Map<string, Message>(),
  reactions: new Map<string, MessageReaction>(),
  devices: new Map<string, Device>(),
  telemetry: [] as Telemetry[],
  valveCommands: new Map<string, ValveCommand>(),
  tariffs: new Map<string, WaterTariff>(), // key farmId (latest wins)
  panels: new Map<string, Panel>(),
  panelReports: new Map<string, DailyPanelReport>(), // key `${panelId}:${date}`
  weather: new Map<string, WeatherSample>(), // key `${farmId}:${hourBucket}`
  videos: new Map<string, Video>(),
  annotations: new Map<string, VideoAnnotation>(),
  schedules: new Map<string, Schedule>(),
  trees: new Map<string, Tree>(),
  treeEvents: new Map<string, TreeEvent>(),
  species: new Map<string, SpeciesProfile>(),
  experts: new Map<string, ExpertProfile>(),
  verifications: new Map<string, ExpertVerification>(),
  consultations: new Map<string, Consultation>(),
  consultationResponses: new Map<string, ConsultationResponse>(),
  cases: new Map<string, LearningCase>(),
  quizzes: new Map<string, Quiz>(),
  quizQuestions: new Map<string, QuizQuestion>(),
  attempts: new Map<string, QuizAttempt>(),
};

/** Generic insert helper for id-keyed collections. */
function put<T extends { id: string }>(coll: Map<string, T>, item: T): T {
  coll.set(item.id, item);
  return item;
}
/** Keyed helpers for composite-key collections (panel reports, weather). */
function putKeyed<K, V>(coll: Map<K, V>, key: K, item: V): V {
  coll.set(key, item);
  return item;
}

// --- chat --------------------------------------------------------------------
export const chatStore = {
  conversations: db2.conversations,
  messages: db2.messages,
  reactions: db2.reactions,
};

// --- water / solar / weather ---------------------------------------------------
export function listDevices(farmId?: string): Device[] {
  const all = [...db2.devices.values()];
  return farmId ? all.filter((d) => d.farmId === farmId) : all;
}
export function getDevice(id: string): Device | undefined {
  return db2.devices.get(id);
}
export function upsertDevice(d: Device): Device {
  return put(db2.devices, d);
}
export function recordTelemetry(t: Telemetry): void {
  // Bounded buffer for dev (Timescale hypertable in production).
  db2.telemetry.push(t);
  if (db2.telemetry.length > 50_000) db2.telemetry.splice(0, 10_000);
  const dev = db2.devices.get(t.deviceId);
  if (dev) {
    dev.lastSeenAt = t.at;
    dev.status = 'online';
  }
}
export function listTelemetry(deviceId: string, sinceMs?: number): Telemetry[] {
  return db2.telemetry.filter((t) => t.deviceId === deviceId && (!sinceMs || t.at >= sinceMs));
}
export function allTelemetry(): Telemetry[] {
  return db2.telemetry;
}
export function insertValveCommand(c: Omit<ValveCommand, 'id' | 'issuedAt'>): ValveCommand {
  return put(db2.valveCommands, { ...c, id: `vc-${nextId()}`, issuedAt: Date.now() });
}
export function ackValveCommand(id: string, result: ValveCommand['result']): ValveCommand | undefined {
  const c = db2.valveCommands.get(id);
  if (!c) return undefined;
  c.ackedAt = Date.now();
  c.result = result;
  return c;
}
export function setTariff(t: WaterTariff): WaterTariff {
  db2.tariffs.set(t.farmId, t);
  return t;
}
export function getTariff(farmId: string): WaterTariff | undefined {
  return db2.tariffs.get(farmId);
}

export function listPanels(farmId?: string): Panel[] {
  const all = [...db2.panels.values()];
  return farmId ? all.filter((p) => p.farmId === farmId) : all;
}
export function upsertPanel(p: Panel): Panel {
  return put(db2.panels, p);
}
export function getPanelReport(panelId: string, date: string): DailyPanelReport | undefined {
  return db2.panelReports.get(`${panelId}:${date}`);
}
export function putPanelReport(r: DailyPanelReport): DailyPanelReport {
  return putKeyed(db2.panelReports, `${r.panelId}:${r.date}`, r);
}
export function listPanelReports(farmId: string, date?: string): DailyPanelReport[] {
  const ids = new Set(listPanels(farmId).map((p) => p.id));
  return [...db2.panelReports.values()].filter(
    (r) => ids.has(r.panelId) && (!date || r.date === date)
  );
}
export function putWeather(w: WeatherSample): WeatherSample {
  return putKeyed(db2.weather, `${w.farmId}:${Math.floor(w.at / 3600_000)}`, w);
}
export function getWeather(farmId: string, atMs: number): WeatherSample | undefined {
  return db2.weather.get(`${farmId}:${Math.floor(atMs / 3600_000)}`);
}

// --- video / schedules -----------------------------------------------------------
export const videoStore = {
  videos: db2.videos,
  annotations: db2.annotations,
  schedules: db2.schedules,
};
export function getVideo(id: string): Video | undefined {
  return db2.videos.get(id);
}

// --- trees -----------------------------------------------------------------------
export const treeStore = { trees: db2.trees, events: db2.treeEvents, species: db2.species };
export function getTreeByQr(qr: string): Tree | undefined {
  return [...db2.trees.values()].find((t) => t.qrCode === qr);
}

// --- marketplace ------------------------------------------------------------------
export const marketStore = {
  experts: db2.experts,
  verifications: db2.verifications,
  consultations: db2.consultations,
  responses: db2.consultationResponses,
};
export function getExpertByUser(userId: string): ExpertProfile | undefined {
  return [...db2.experts.values()].find((e) => e.userId === userId);
}

// --- academy ------------------------------------------------------------------------
export const academyStore = {
  cases: db2.cases,
  quizzes: db2.quizzes,
  questions: db2.quizQuestions,
  attempts: db2.attempts,
};


// --- P1–P5 demo seed (so dashboards/screens are alive on first run) ----------
;(function seedV2() {
  const now = Date.now();
  // P2 water devices on the demo farm.
  db2.devices.set('dev-meter-1', { id: 'dev-meter-1', farmId: 'f-1', type: 'water_meter', vendor: 'GenericPulse', label: 'Main line meter', status: 'online', lastSeenAt: now, createdAt: now });
  db2.devices.set('dev-valve-1', { id: 'dev-valve-1', farmId: 'f-1', type: 'valve', vendor: 'GenericRelay', label: 'Valve C2', status: 'online', lastSeenAt: now, metadata: { normallyOpen: true }, createdAt: now });
  db2.tariffs.set('f-1', { farmId: 'f-1', effectiveFrom: now - 86400_000, currency: 'EGP', tiers: [ { upToM3: 100, pricePerM3: 2.5 }, { upToM3: null, pricePerM3: 4.0 } ] });
  // 48h of hourly telemetry: steady day flow + suspicious NIGHT flow (leak fixture).
  for (let h = 47; h >= 0; h--) {
    const at = now - h * 3600_000;
    const hour = new Date(at).getHours();
    const nightIdle = hour >= 0 && hour < 5; // leak rule window
    recordTelemetry({ deviceId: 'dev-meter-1', at, metrics: {
      m3_cumulative: 1200 + (47 - h) * (nightIdle ? 0.8 : 6),
      flow_lpm: nightIdle ? 13 : 90,
    }});
  }
  // P3 solar: one string of three panels, panel B dusty (fixture).
  ['A', 'B', 'C'].forEach((sfx, i) => {
    upsertPanel({ id: `panel-${sfx}`, farmId: 'f-1', stringId: 'str-1', nameplateKwp: 0.55, installDate: now - 400 * 86400_000 });
  });
  putWeather({ farmId: 'f-1', at: now - 3600_000 * 12, tempC: 31, cloudPct: 10 });
  // P5 trees + species.
  db2.species.set('mango-zebda', { code: 'mango-zebda', name: 'Zebda Mango', expectedLifespanYears: 40 });
  db2.species.set('citrus-baladi', { code: 'citrus-baladi', name: 'Baladi Orange', expectedLifespanYears: 25 });
  db2.trees.set('tr-1', { id: 'tr-1', farmId: 'f-1', sector: 'A', qrCode: 'AGRI-TREE-0001', speciesCode: 'mango-zebda', plantedAt: now - 12 * 365.25 * 86400_000, gps: { lat: 30.051, lng: 31.231 }, gpsAccuracyM: 6, locationMethod: 'gps', status: 'productive', createdAt: now });
  db2.trees.set('tr-2', { id: 'tr-2', farmId: 'f-1', sector: 'A', qrCode: 'AGRI-TREE-0002', speciesCode: 'citrus-baladi', plantedAt: now - 24 * 365.25 * 86400_000, locationMethod: 'relative_code', relativeCode: 'row-3/pos-7', status: 'productive', createdAt: now });
})();

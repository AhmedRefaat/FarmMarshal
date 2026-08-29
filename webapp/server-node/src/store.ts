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
  db2.tariffs.set('f-1', { farmId: 'f-1', effectiveFrom: now - 86400_000, currency: 'SAR', tiers: [ { upToM3: 100, pricePerM3: 2.5 }, { upToM3: null, pricePerM3: 4.0 } ] });
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

// ---------------------------------------------------------------------------
// PORTFOLIO + EXPERT NETWORK DEMO SEED
// ---------------------------------------------------------------------------
// One farm and zero consultations are enough to prove the API but not enough to
// SHOW the product: an owner has a portfolio, a moderator carries several farms,
// and the marketplace only makes sense with a pool of real requests and answers.
// Gated on allowDemoSeed() — a production-like NODE_ENV starts empty.
// ---------------------------------------------------------------------------
;(function seedPortfolioAndMarketplace() {
  if (!allowDemoSeed()) return;
  const now = Date.now();
  const day = 86400_000;

  // --- extra people -------------------------------------------------------
  // The two experts are deliberately OUTSIDE every farm: a global expert must
  // reach the consultation pool without gaining any tenant data access.
  const extraUsers: User[] = [
    { id: 'u-worker2', name: 'Hassan Ali', email: 'worker2@agri.com', role: 'worker', createdAt: now - 60 * day },
    { id: 'u-exp-1', name: 'Dr. Amina Farouk', email: 'expert1@agri.com', role: 'worker', createdAt: now - 200 * day },
    { id: 'u-exp-2', name: 'Prof. Wei Chen', email: 'expert2@agri.com', role: 'worker', createdAt: now - 150 * day },
  ];
  for (const u of extraUsers) {
    db.users.set(u.id, u);
    credentials.set(u.email, hashPasswordSync('pass123'));
  }
  db.userPersonas.set('p-u-exp-1-crowd_expert', { id: 'p-u-exp-1-crowd_expert', userId: 'u-exp-1', persona: 'academic_expert', status: 'active', createdAt: now });
  db.userPersonas.set('p-u-exp-2-crowd_expert', { id: 'p-u-exp-2-crowd_expert', userId: 'u-exp-2', persona: 'crowd_expert', status: 'active', createdAt: now });
  db.userPersonas.set('p-u-worker2-worker', { id: 'p-u-worker2-worker', userId: 'u-worker2', persona: 'worker', status: 'active', createdAt: now });

  // --- the owner's portfolio ---------------------------------------------
  db.farms.set('f-2', { id: 'f-2', ownerId: 'u-owner', name: 'Fayoum Citrus Orchard', centerLat: 29.31, centerLng: 30.84, createdAt: now - 400 * day });
  db.farms.set('f-3', { id: 'f-3', ownerId: 'u-owner', name: 'Minya Desert Plot', centerLat: 28.11, centerLng: 30.75, createdAt: now - 120 * day });

  const member = (farmId: string, userId: string, roleInFarm: FarmMember['roleInFarm']) =>
    db.farmMembers.set(`fm-${farmId}-${userId}`, { id: `fm-${farmId}-${userId}`, farmId, userId, roleInFarm, createdAt: now });
  // The moderator is responsible for ALL THREE farms — that is the whole point
  // of the portfolio view for his persona.
  for (const farmId of ['f-2', 'f-3']) {
    member(farmId, 'u-owner', 'owner');
    member(farmId, 'u-mod', 'moderator');
  }
  member('f-2', 'u-worker', 'worker');
  member('f-3', 'u-worker2', 'worker');

  db.subscriptions.set('sub-2', { id: 'sub-2', farmId: 'f-2', planId: 'pl-premium', status: 'active', periodStart: now - 10 * day, periodEnd: now + 20 * day, autoRenew: true, createdAt: now });
  db.subscriptions.set('sub-3', { id: 'sub-3', farmId: 'f-3', planId: 'pl-basic', status: 'active', periodStart: now - 5 * day, periodEnd: now + 25 * day, autoRenew: false, createdAt: now });

  // --- work across the portfolio -----------------------------------------
  const task = (t: Task) => db.tasks.set(t.id, t);
  task({ id: 't-3', farmId: 'f-2', title: 'Citrus leaf-miner outbreak block 4', description: 'Silvery mines on young flush across ~40 trees; confirm species before spraying.', lat: 29.311, lng: 30.841, status: 'in_progress', assigneeId: 'u-mod', workerId: 'u-worker', createdAt: now - 2 * day, startedAt: now - 1.5 * day });
  task({ id: 't-4', farmId: 'f-2', title: 'Replace clogged drip emitters row 7-9', description: 'Emitters blocked by calcium scale; flush lines and swap 60 emitters.', lat: 29.313, lng: 30.845, status: 'approved', assigneeId: 'u-mod', workerId: 'u-worker', createdAt: now - 12 * day, startedAt: now - 11 * day, submittedAt: now - 10 * day, reviewedAt: now - 9 * day, reviewNote: 'Flow restored to 4 L/h per emitter. Good work.' });
  task({ id: 't-5', farmId: 'f-3', title: 'Windbreak netting torn — north edge', description: 'Sandstorm tore 30 m of netting; seedlings exposed.', lat: 28.112, lng: 30.752, status: 'rejected', assigneeId: 'u-mod', workerId: 'u-worker2', createdAt: now - 6 * day, startedAt: now - 5 * day, submittedAt: now - 4 * day, reviewedAt: now - 3 * day, reviewNote: 'Netting reattached but not tensioned; it will tear again. Redo with new posts.' });
  task({ id: 't-6', farmId: 'f-3', title: 'Soil salinity survey — plots A to D', description: 'Take EC readings at 0-30 cm and 30-60 cm on a 20 m grid.', lat: 28.114, lng: 30.757, status: 'assigned', assigneeId: 'u-mod', workerId: 'u-worker2', createdAt: now - 8 * 3600_000 });

  // --- issues spanning the 7-stage workflow -------------------------------
  const issue = (i: Issue) => db.issues.set(i.id, i);
  const event = (e: Omit<IssueEvent, 'id'>) => {
    const id = `ie-${nextId()}`;
    db.issueEvents.set(id, { ...e, id });
  };

  issue({ id: 'is-2', farmId: 'f-2', kind: 'pest', stage: 'implemented', source: 'human_report', title: 'Leaf-miner infestation — block 4', severity: 'high', taskId: 't-3', createdBy: 'u-worker', createdAt: now - 4 * day });
  event({ issueId: 'is-2', fromStage: 'detected', toStage: 'inspected', actorId: 'u-worker', actorRole: 'worker', note: 'Photographed 12 affected trees.', at: now - 3.5 * day });
  event({ issueId: 'is-2', fromStage: 'inspected', toStage: 'identified', actorId: 'u-mod', actorRole: 'moderator', note: 'Phyllocnistis citrella confirmed from mine pattern.', at: now - 3 * day });
  event({ issueId: 'is-2', fromStage: 'identified', toStage: 'recommended', actorId: 'u-mod', actorRole: 'moderator', note: 'Abamectin + horticultural oil on new flush only; consultation opened for resistance risk.', at: now - 2.5 * day });
  event({ issueId: 'is-2', fromStage: 'recommended', toStage: 'implemented', actorId: 'u-worker', actorRole: 'worker', note: 'Spray started block 4.', at: now - 1.5 * day });

  issue({ id: 'is-3', farmId: 'f-2', kind: 'water_leak', stage: 'closed', source: 'sensor_rule', title: 'Emitter blockage — rows 7 to 9', severity: 'medium', taskId: 't-4', createdBy: 'u-mod', createdAt: now - 14 * day, closedAt: now - 8 * day });
  event({ issueId: 'is-3', fromStage: 'detected', toStage: 'inspected', actorId: 'u-worker', actorRole: 'worker', note: 'Pressure normal, output low — blockage not a leak.', at: now - 13 * day });
  event({ issueId: 'is-3', fromStage: 'inspected', toStage: 'identified', actorId: 'u-mod', actorRole: 'moderator', note: 'Calcium scale build-up in emitters.', at: now - 12.5 * day });
  event({ issueId: 'is-3', fromStage: 'identified', toStage: 'recommended', actorId: 'u-mod', actorRole: 'moderator', note: 'Acid flush then replace the 60 worst emitters.', at: now - 12 * day });
  event({ issueId: 'is-3', fromStage: 'recommended', toStage: 'implemented', actorId: 'u-worker', actorRole: 'worker', note: 'Flush done, emitters replaced.', at: now - 10 * day });
  event({ issueId: 'is-3', fromStage: 'implemented', toStage: 'reviewed', actorId: 'u-mod', actorRole: 'moderator', note: 'Flow measured back at 4 L/h.', at: now - 9 * day });
  event({ issueId: 'is-3', fromStage: 'reviewed', toStage: 'closed', actorId: 'u-owner', actorRole: 'owner', note: 'Accepted. Add quarterly acid flush to the plan.', at: now - 8 * day });

  issue({ id: 'is-4', farmId: 'f-3', kind: 'equipment', stage: 'detected', source: 'human_report', title: 'Windbreak netting torn after sandstorm', severity: 'high', taskId: 't-5', createdBy: 'u-worker2', createdAt: now - 6 * day });
  issue({ id: 'is-5', farmId: 'f-3', kind: 'general', stage: 'inspected', source: 'human_report', title: 'Rising salinity in plots C and D', severity: 'medium', createdBy: 'u-mod', createdAt: now - 2 * day });
  event({ issueId: 'is-5', fromStage: 'detected', toStage: 'inspected', actorId: 'u-worker2', actorRole: 'worker', note: 'EC 6.1 dS/m at 30 cm in plot C.', at: now - 1 * day });

  // --- expert network ------------------------------------------------------
  const expert = (id: string, userId: string, p: Partial<ExpertProfile>): ExpertProfile => ({
    id, userId, status: 'verified', avgStars: 0, answersCount: 0, acceptanceRate: 0,
    totalEarnedEgp: 0, createdAt: now - 100 * day, ...p,
  });
  db2.experts.set('exp-1', expert('exp-1', 'u-exp-1', {
    country: 'Egypt', languages: ['ar', 'en'], specializations: ['citrus', 'entomology'],
    yearsExp: 18, institution: 'Cairo University', academicTitle: 'Associate Professor',
    avgStars: 4.8, answersCount: 34, acceptanceRate: 72, totalEarnedEgp: 21400,
  }));
  db2.experts.set('exp-2', expert('exp-2', 'u-exp-2', {
    country: 'China', languages: ['zh', 'en'], specializations: ['soil salinity', 'irrigation'],
    yearsExp: 11, avgStars: 4.4, answersCount: 21, acceptanceRate: 61, totalEarnedEgp: 12750,
  }));

  // OPEN request: two competing recommendations, nothing chosen yet — this is
  // the pool state the moderator sees when he needs outside help.
  db2.consultations.set('con-1', {
    id: 'con-1', requesterId: 'u-mod',
    question: 'Leaf-miner in Fayoum citrus block 4. Abamectin worked last season but pressure is back within three weeks. Is this resistance, and what rotation would you use on young flush?',
    bountyEgp: 750, platformCommissionPct: 15, scope: 'public', status: 'open',
    language: 'en', createdAt: now - 2 * day,
  });
  db2.consultationResponses.set('res-1', {
    id: 'res-1', consultationId: 'con-1', responderId: 'u-exp-1',
    answer: 'Three weeks of control is normal for abamectin under high pressure — that is degradation, not resistance. Confirm by checking whether mines stop at the treated flush. Rotate: abamectin + 0.5% oil on flush 1, spinetoram on flush 2, then a cyantraniliprole drench before flush 3. Never repeat the same IRAC group in one flush cycle, and stop spraying once the flush hardens off since the pest cannot mine mature leaves.',
    payoutStatus: 'none', createdAt: now - 1.6 * day,
  });
  db2.consultationResponses.set('res-2', {
    id: 'res-2', consultationId: 'con-1', responderId: 'u-exp-2',
    answer: 'Before rotating chemistry, cut the trigger: synchronise irrigation and nitrogen so the block pushes flush in one window instead of continuously. A continuous flush gives the miner continuous host tissue and no spray programme will hold. Combine that with a single well-timed application at 20-30% flush emergence.',
    payoutStatus: 'none', createdAt: now - 1.2 * day,
  });
  // Group thread while the request is open (F6b).
  db2.conversations.set('cv-con-1', {
    id: 'cv-con-1', kind: 'consultation', consultationId: 'con-1',
    memberIds: ['u-mod', 'u-exp-1', 'u-exp-2'], createdBy: 'u-mod',
    title: 'Leaf-miner rotation — Fayoum block 4', createdAt: now - 1.6 * day,
  });
  db2.consultations.get('con-1')!.groupConversationId = 'cv-con-1';

  // SETTLED request: chosen answer, bounty split, and the 1:1 thread the
  // requester and the chosen expert keep talking in.
  db2.consultations.set('con-2', {
    id: 'con-2', requesterId: 'u-owner',
    question: 'Minya desert plot: EC climbing to 6 dS/m at 30 cm after two seasons of drip. Leaching fraction or gypsum first, and how do I avoid wasting water?',
    bountyEgp: 1200, platformCommissionPct: 15, scope: 'public', status: 'chosen',
    chosenResponseId: 'res-3', language: 'en', createdAt: now - 9 * day,
  });
  const split = { commission: 180, net: 1020 }; // 15% of 1200
  db2.consultationResponses.set('res-3', {
    id: 'res-3', consultationId: 'con-2', responderId: 'u-exp-2',
    answer: 'Measure the irrigation water EC first — if it is above 2 dS/m the salt is arriving with every litre and gypsum will not help. Assuming sodic conditions (ESP > 15), apply gypsum at 2 t/ha banded under the emitters, then run a 15% leaching fraction on every third irrigation rather than a large periodic flush. Pulse irrigation keeps the wetting front moving down instead of evaporating at the surface, which is where your salt crust is forming.',
    conversationId: 'cv-con-2', ratingStars: 5,
    commissionAmount: split.commission, netPayoutEgp: split.net, payoutStatus: 'pending',
    createdAt: now - 8 * day,
  });
  db2.conversations.set('cv-con-2', {
    id: 'cv-con-2', kind: 'direct', consultationId: 'con-2',
    memberIds: ['u-owner', 'u-exp-2'], createdBy: 'u-owner',
    title: 'Salinity plan — Minya plot', createdAt: now - 7.5 * day,
  });
  const msg = (id: string, senderId: string, senderName: string, text: string, ageHours: number) =>
    db2.messages.set(id, {
      id, conversationId: 'cv-con-2', senderId, senderName, type: 'text',
      originalText: text, originalLang: 'en', pinned: false, createdAt: now - ageHours * 3600_000,
    });
  msg('m-1', 'u-owner', 'Land Owner', 'Thanks — irrigation water tested at 1.4 dS/m, so it looks sodic rather than saline water.', 170);
  msg('m-2', 'u-exp-2', 'Prof. Wei Chen', 'Good, gypsum is the right first move then. Band it under the emitter line, not broadcast — you only need to reclaim the wetted bulb.', 166);
  msg('m-3', 'u-owner', 'Land Owner', 'Understood. Can we review the EC readings again after the first leaching cycle?', 100);
  msg('m-4', 'u-exp-2', 'Prof. Wei Chen', 'Yes. Send readings at 0-30 and 30-60 cm two weeks after the third irrigation and I will tell you whether to extend the leaching fraction.', 96);
})();

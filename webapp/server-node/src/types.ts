/**
 * types.ts — DOMAIN MODEL (webapp)
 * ---------------------------------------------------------------------------
 * Single source of truth for every entity crossing the REST boundary.
 * Field-for-field compatible with the mobile app's model (see
 * mobile-app/src/types.ts and ARCHITECTURE.md §5) so the mobile migration is
 * a transport swap, not a data remodel.
 *
 * ORGANISATION: base entities (User/Task/Comment/Rating/Session) → P0 block
 * (personas/farms/issues/plans) → P1–P7 blocks, each citing its requirement
 * section in docs/V2_REQUIREMENTS_ANALYSIS.md at the top of the block.
 * These interfaces ARE the wire contract — change here first, then clients.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/V2_REQUIREMENTS_ANALYSIS.md (per-block section refs)
 *   - docs/ARCHITECTURE_EVOLUTION_PLAN.md §2 (Postgres DDL mirrors these)
 */

/** The three system roles; permissions matrix in ARCHITECTURE.md §1. */
export type Role = 'owner' | 'moderator' | 'worker';

/**
 * Task lifecycle — IDENTICAL to the mobile app's state machine:
 * assigned → in_progress → submitted → approved | rejected(→in_progress).
 */
export type TaskStatus =
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected';

/** A person in the system (owner, moderator, or worker). */
export interface User {
  id: string;
  name: string;
  email: string;
  /** Primary persona; full set lives in user_personas (G0.1b). */
  role: Role | 'admin';
  createdAt: number;
}

/** One field job / land problem-solution cycle. */
export interface Task {
  id: string;
  /**
   * Owning farm — the tenancy root. Required so task reads and lifecycle
   * transitions can be scoped to the caller's farm memberships (SEC-C4:
   * every task was previously visible and mutable by every authenticated user).
   */
  farmId: string;
  /** Short problem statement, e.g. "Irrigation leak in sector C". */
  title: string;
  /** Full description of the problem + required solution. */
  description: string;
  /** GPS point of the work site on the owner's land. */
  lat: number;
  lng: number;
  status: TaskStatus;
  /** Moderator who created/reviews the task. */
  assigneeId: string;
  /** Worker executing the task. */
  workerId: string;
  beforePhotoUrl?: string;
  afterPhotoUrl?: string;
  /** R1 geo-evidence: device GPS at shutter time (mobile sends alongside upload). */
  beforePhotoLat?: number;
  beforePhotoLng?: number;
  afterPhotoLat?: number;
  afterPhotoLng?: number;
  reviewNote?: string;
  createdAt: number;
  startedAt?: number;
  submittedAt?: number;
  reviewedAt?: number;
}

/** A comment on a task — text, audio, or both. */
export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  authorRole: Role | 'admin';
  text?: string;
  /** URL of an uploaded voice note served from /uploads/*. */
  audioUrl?: string;
  createdAt: number;
}

/**
 * An evaluation. WHO may rate WHOM is enforced server-side:
 *   owner→moderator, owner→worker, moderator→worker (ARCHITECTURE.md §1).
 */
export interface Rating {
  id: string;
  raterId: string;
  rateeId: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  createdAt: number;
}

/** Auth payload attached to requests after token verification. */
export interface Session {
  userId: string;
  role: Role | 'admin';
}

// ---------------------------------------------------------------------------
// P0 additions — multi-persona identity (G0.1b), issues workflow (G0.2),
// entitlements (ADR-012), farms tenancy. See docs/ARCHITECTURE_EVOLUTION_PLAN.md.
// ---------------------------------------------------------------------------

/**
 * Every persona a person may hold. Farm-scoped personas are additionally
 * recorded in farm_members; permissions are the UNION of active personas.
 */
export type Persona =
  | Role // 'owner' | 'moderator' | 'worker'
  | 'admin'
  | 'agri_expert'
  | 'accountant'
  | 'learner'
  | 'crowd_expert'
  | 'academic_expert';

/** One held persona + its lifecycle (verification gates expert personas). */
export interface UserPersona {
  id: string;
  userId: string;
  persona: Persona;
  status: 'active' | 'pending_verification' | 'suspended';
  createdAt: number;
}

/** A farm = tenancy root; every scoped entity hangs off one. */
export interface Farm {
  id: string;
  ownerId: string;
  name: string;
  centerLat?: number;
  centerLng?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/** Membership of a user in a farm with their role inside THAT farm. */
export interface FarmMember {
  id: string;
  farmId: string;
  userId: string;
  roleInFarm: 'owner' | 'moderator' | 'worker' | 'accountant';
  createdAt: number;
}

/** Universal issue kinds — new kinds plug in without schema changes. */
export type IssueKind = 'water_leak' | 'panel_cleaning' | 'pest' | 'equipment' | 'general';

/**
 * G0.2 universal activity workflow:
 *   detected → inspected → identified → recommended → implemented → reviewed → closed
 * Each advance is gated (see modules/issues.ts) and appended to the timeline.
 */
export type IssueStage =
  | 'detected'
  | 'inspected'
  | 'identified'
  | 'recommended'
  | 'implemented'
  | 'reviewed'
  | 'closed';

export type IssueSource = 'sensor_rule' | 'human_report' | 'ai_detection';

/** A tracked problem/activity following the universal workflow. */
export interface Issue {
  id: string;
  farmId: string;
  kind: IssueKind;
  stage: IssueStage;
  source: IssueSource;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Optional link to a task executing the fix (IMPLEMENTED gate). */
  taskId?: string;
  createdBy: string;
  createdAt: number;
  closedAt?: number;
  metadata?: Record<string, unknown>;
}

/** Immutable timeline entry appended on EVERY stage transition. */
export interface IssueEvent {
  id: string;
  issueId: string;
  fromStage: IssueStage;
  toStage: IssueStage;
  actorId: string;
  actorRole: string;
  note?: string;
  evidence?: Record<string, unknown>;
  at: number;
}

// --- Entitlements (SUBSCRIPTION_AND_PAYMENTS_DESIGN.md §1–2) ----------------

export type FeatureKey =
  | 'water_iot'
  | 'solar_iot'
  | 'chat_translation'
  | 'video_platform'
  | 'robot_integration'
  | 'marketplace'
  | 'reports';

/** A purchasable plan; features gate endpoints via requireEntitlement(). */
export interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyEgp: number;
  createdAt: number;
}

/** Per-plan feature switch + limits (limits JSONB shape per feature key). */
export interface PlanFeature {
  planId: string;
  featureKey: FeatureKey;
  enabled: boolean;
  limits?: Record<string, unknown>;
}

/** The owner's subscription binding a farm to a plan. */
export interface Subscription {
  id: string;
  farmId: string;
  planId: string;
  status: 'trial' | 'active' | 'past_due' | 'cancelled';
  periodStart: number;
  periodEnd: number;
  autoRenew: boolean;
  createdAt: number;
}

/** Manual payment ledger entry (card rails arrive in P6). */
export interface Payment {
  id: string;
  payerUserId: string;
  subscriptionId?: string;
  amountEgp: number;
  method: 'manual' | 'visa' | 'mastercard';
  note?: string;
  confirmedAt?: number;
  createdAt: number;
}

/** Who did WHAT, when — admin-visible trail (READINESS_REVIEW §3). */
export interface AuditEntry {
  id: string;
  at: number;
  actorId: string;
  persona: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
}

// ===========================================================================
// P1 — Chat & translation (F3) · P2 Water (F1) · P3 Solar (F2)
// P4 Video (F4b) · P5 Trees (F5) · P6 Marketplace (F6) · P7 Academy (F7)
// Each block cites its requirement section in V2_REQUIREMENTS_ANALYSIS.md.
// ===========================================================================

// --- P1: chat (F3) ----------------------------------------------------------

export type ConversationKind = 'direct' | 'group' | 'consultation';

/** A chat thread. Consultation threads carry the marketplace linkage (F6b). */
export interface Conversation {
  id: string;
  kind: ConversationKind;
  title?: string;
  farmId?: string;
  /** F6b: consultation this thread belongs to (drives context header). */
  consultationId?: string;
  memberIds: string[];
  createdBy: string;
  createdAt: number;
}

export type MessageMediaType = 'text' | 'photo' | 'video' | 'voice' | 'system';

/**
 * One chat message. Translation model (F3): `originalText` is immutable;
 * translations are CACHED per language so provider costs stay bounded and
 * user-corrected translations can improve over time.
 */
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  type: MessageMediaType;
  originalText?: string;
  originalLang?: string; // ISO-639-1, auto-detected server-side (heuristic v1)
  /** lang → translated text cache. */
  translations?: Record<string, string>;
  mediaUrl?: string;
  durationS?: number; // voice notes
  pinned: boolean;
  replyToId?: string;
  /** Client-generated UUID → retry-safe offline outbox (ADR-011). */
  idempotencyKey?: string;
  createdAt: number;
}

/** Emoji reaction on a message (one per user per message). */
export interface MessageReaction {
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: number;
}

// --- P2: water IoT (F1) ------------------------------------------------------

export type DeviceType = 'water_meter' | 'valve' | 'inverter' | 'panel_sensor' | 'robot' | 'gateway';

/** Any field device. Vendor-neutral canonical shape (EVOLUTION_PLAN §10 HAL). */
export interface Device {
  id: string;
  farmId: string;
  type: DeviceType;
  vendor?: string;
  label: string;
  status: 'online' | 'stale' | 'offline';
  lastSeenAt?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/** One canonical telemetry reading (Timescale row shape). */
export interface Telemetry {
  deviceId: string;
  at: number;
  metrics: Record<string, number>; // e.g. { m3_cumulative, flow_lpm } | { kwh_total }
}

/** Audited valve command with ack lifecycle (safety interlock trail). */
export interface ValveCommand {
  id: string;
  deviceId: string;
  action: 'open' | 'close';
  requestedBy: string;
  reason: string; // MANDATORY — why a valve moved is compliance data
  issuedAt: number;
  ackedAt?: number;
  result?: 'ok' | 'timeout' | 'failed';
}

/** Tiered water tariff per farm (cost estimation input). */
export interface WaterTariff {
  farmId: string;
  effectiveFrom: number;
  currency: 'SAR';
  /** [{ upToM3: number|null, pricePerM3: number }] — null = infinity. */
  tiers: Array<{ upToM3: number | null; pricePerM3: number }>;
}

// --- P3: solar + weather (F2) -------------------------------------------------

export interface Panel {
  id: string;
  farmId: string;
  stringId: string;
  nameplateKwp: number;
  installDate?: number;
  metadata?: Record<string, unknown>;
}

/** Nightly computed per-panel report; dust_status drives cleaning requests. */
export interface DailyPanelReport {
  panelId: string;
  date: string; // YYYY-MM-DD
  energyKwh: number;
  expectedKwh: number; // weather-adjusted expectation
  siblingRatio: number; // energy vs median of same-string siblings
  cloudPct: number;
  dustStatus: 'ok' | 'suspect' | 'confirmed';
}

/** Cached weather per farm-hour (irradiance/cloud context for reports+rules). */
export interface WeatherSample {
  farmId: string;
  at: number;
  tempC: number;
  cloudPct: number;
}

// --- P4: video platform (F4b) --------------------------------------------------

export interface Video {
  id: string;
  farmId: string;
  areaTag?: string;
  sourceDeviceId?: string; // robot or human uploader
  hlsUrl?: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  recordedAt?: number;
  uploadedBy?: string;
  createdAt: number;
}

/**
 * Expert annotation anchored to playback time. Optional treeId links the
 * note into that tree's history timeline (owner review #3).
 */
export interface VideoAnnotation {
  id: string;
  videoId: string;
  authorId: string;
  authorName: string;
  tStartS: number;
  tEndS?: number;
  text: string;
  overlaySvg?: string; // SVG drawn on a paused frame
  treeId?: string;
  createdAt: number;
}

/** Farm schedules: robot missions, inspections, expert events. */
export interface Schedule {
  id: string;
  farmId: string;
  kind: 'robot_mission' | 'inspection' | 'event';
  title: string;
  cronOrAt: string; // cron expression OR ISO one-off timestamp
  payload?: Record<string, unknown>; // e.g. { areas: ['row-12'] }
  createdBy: string;
  createdAt: number;
}

// --- P5: trees (F5) --------------------------------------------------------------

export type TreeStatus = 'productive' | 'aging' | 'end_of_life_recommended' | 'removed_archived';

export interface Tree {
  id: string;
  farmId: string;
  sector?: string;
  /** PRIMARY identity: physical QR tag (GPS alone never identifies a tree). */
  qrCode: string;
  speciesCode: string;
  plantedAt: number;
  gps?: { lat: number; lng: number };
  gpsAccuracyM?: number;
  locationMethod: 'gps' | 'relative_code' | 'manual';
  /** Row/position code fallback when canopy GPS is weak ("row-12/pos-3"). */
  relativeCode?: string;
  status: TreeStatus;
  createdAt: number;
}

export interface TreeEvent {
  id: string;
  treeId: string;
  eventKind: string; // treatment | harvest | issue_link | annotation_link | removal_review
  note?: string;
  evidence?: Record<string, unknown>;
  at: number;
}

/** Species lifespan table feeding the end-of-life estimator. */
export interface SpeciesProfile {
  code: string;
  name: string;
  expectedLifespanYears: number;
}

// --- P6: marketplace (F6) ---------------------------------------------------------

export type ExpertStatus = 'pending' | 'verified' | 'rejected' | 'suspended';

/** Public reputation card of a crowdsourced/academic expert. */
export interface ExpertProfile {
  id: string;
  userId: string;
  country?: string;
  languages?: string[];
  specializations?: string[];
  yearsExp?: number;
  institution?: string; // academic_expert persona
  academicTitle?: string;
  status: ExpertStatus;
  avgStars: number;
  answersCount: number;
  acceptanceRate: number;
  totalEarnedEgp: number;
  createdAt: number;
}

/** Uploaded credential awaiting admin review (F6a funnel). */
export interface ExpertVerification {
  id: string;
  expertId: string;
  docType: string; // degree | license | certificate | staff_id
  docUrl: string;
  expiresAt?: number;
  reviewStatus: 'in_review' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: number;
}

export interface Consultation {
  id: string;
  requesterId: string;
  question: string;
  mediaUrls?: string[];
  bountyEgp: number;
  platformCommissionPct: number;
  scope: 'public' | 'targeted';
  status: 'escrow' | 'open' | 'finalists' | 'chosen' | 'settled' | 'disputed';
  chosenResponseId?: string;
  language: string;
  groupConversationId?: string;
  createdAt: number;
}

export interface ConsultationResponse {
  id: string;
  consultationId: string;
  responderId: string;
  answer: string;
  mediaUrls?: string[];
  conversationId?: string; // 1:1 thread created on acceptance (F6b)
  ratingStars?: number;
  commissionAmount?: number;
  netPayoutEgp?: number;
  payoutStatus: 'none' | 'pending' | 'paid';
  createdAt: number;
}

// --- P7: academy (F7) -----------------------------------------------------------------

/** A published learning case derived from closed issues / settled consultations. */
export interface LearningCase {
  id: string;
  sourceType: 'issue' | 'consultation';
  sourceId: string;
  publishedBy: string;
  /** Anonymization rules applied AT READ TIME: mask names/geo. */
  anonymized: boolean;
  cropTags: string[];
  learningObjectives?: string;
  status: 'draft' | 'published' | 'retired';
  /** Frozen snapshot of the source's 7-stage chain (no later leakage). */
  snapshot: Record<string, unknown>;
  createdAt: number;
}

export type QuizQuestionType = 'mcq' | 'true_false' | 'photo_diagnosis';

export interface QuizQuestion {
  id: string;
  quizId: string;
  type: QuizQuestionType;
  prompt: string;
  mediaUrl?: string;
  options?: string[]; // mcq
  /** SERVER-ONLY: never serialized to any client payload. */
  answerKey: string | number | boolean;
  points: number;
}

export interface Quiz {
  id: string;
  title: string;
  authorId: string;
  caseIds: string[];
  passThresholdPct: number;
  status: 'draft' | 'published';
  createdAt: number;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  userId: string;
  scorePct: number;
  passed: boolean;
  startedAt: number;
  completedAt: number;
}

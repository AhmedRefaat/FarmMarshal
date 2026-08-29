/**
 * types.ts — client-side mirror of the API domain model.
 * Kept identical to server-node/src/types.ts (ARCHITECTURE.md §5).
 */

export type Role = 'owner' | 'moderator' | 'worker' | 'admin';

export type TaskStatus =
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  status: TaskStatus;
  assigneeId: string;
  workerId: string;
  /** Owning farm — the tenancy root every scoped read is filtered by. */
  farmId: string;
  beforePhotoUrl?: string;
  afterPhotoUrl?: string;
  reviewNote?: string;
  createdAt: number;
  startedAt?: number;
  submittedAt?: number;
  reviewedAt?: number;
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  text?: string;
  audioUrl?: string;
  createdAt: number;
}

export interface Rating {
  id: string;
  raterId: string;
  rateeId: string;
  stars: number; // 1–5
  comment?: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Farm portfolio + universal issue workflow (server /v2 surface)
// ---------------------------------------------------------------------------

export interface Farm {
  id: string;
  ownerId?: string;
  name: string;
  centerLat?: number;
  centerLng?: number;
  createdAt?: number;
}

/** detected → inspected → identified → recommended → implemented → reviewed → closed */
export type IssueStage =
  | 'detected'
  | 'inspected'
  | 'identified'
  | 'recommended'
  | 'implemented'
  | 'reviewed'
  | 'closed';

export type IssueKind =
  | 'water_leak'
  | 'panel_cleaning'
  | 'pest'
  | 'equipment'
  | 'general';

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Issue {
  id: string;
  farmId: string;
  kind: IssueKind;
  stage: IssueStage;
  source: 'sensor_rule' | 'human_report' | 'ai_detection';
  title: string;
  severity: IssueSeverity;
  taskId?: string;
  createdBy: string;
  createdAt: number;
  closedAt?: number;
}

export interface IssueEvent {
  id: string;
  issueId: string;
  fromStage: IssueStage;
  toStage: IssueStage;
  actorId: string;
  actorRole: string;
  note?: string;
  at: number;
}

/** Minimal identity card returned by the report aggregate (never a password). */
export interface PublicUser {
  id: string;
  name: string;
  role: Role;
}

export type MilestoneKey = 'created' | 'started' | 'submitted' | 'reviewed';

export interface Milestone {
  key: MilestoneKey;
  at: number;
  by: string;
  note?: string;
}

/** GET /tasks/:id/report — everything needed to explain one task end to end. */
export interface TaskReport {
  task: Task;
  farm: Farm | null;
  reporter: PublicUser | null;
  assignee: PublicUser | null;
  worker: PublicUser | null;
  issue: Issue | null;
  issueEvents: IssueEvent[];
  comments: Comment[];
  milestones: Milestone[];
}

// ---------------------------------------------------------------------------
// Agriculture expert network (marketplace F6)
// ---------------------------------------------------------------------------

export type ConsultationStatus =
  | 'escrow'
  | 'open'
  | 'finalists'
  | 'chosen'
  | 'settled'
  | 'disputed';

export interface ExpertCard {
  avgStars: number;
  answersCount: number;
  country?: string;
  institution?: string;
  specializations?: string[];
  yearsExp?: number;
}

export interface ExpertProfile extends ExpertCard {
  id: string;
  userId: string;
  name?: string;
  languages?: string[];
  academicTitle?: string;
  status: 'pending' | 'verified' | 'rejected' | 'suspended';
  acceptanceRate: number;
  totalEarnedEgp: number;
  createdAt: number;
}

export interface Consultation {
  id: string;
  requesterId: string;
  requesterName?: string;
  question: string;
  bountyEgp: number;
  platformCommissionPct: number;
  scope: 'public' | 'targeted';
  status: ConsultationStatus;
  chosenResponseId?: string;
  language: string;
  groupConversationId?: string;
  createdAt: number;
  /** List-view decorations. */
  responseCount?: number;
  mine?: boolean;
  answered?: boolean;
}

export interface ConsultationResponse {
  id: string;
  consultationId: string;
  responderId: string;
  responderName: string;
  answer: string;
  conversationId?: string;
  ratingStars?: number;
  payoutStatus: 'none' | 'pending' | 'paid';
  /** Money is disclosed only to the requester and the owning responder. */
  commissionAmount?: number;
  netPayoutEgp?: number;
  createdAt: number;
  expert?: ExpertCard;
}

export interface ConsultationDetail {
  consultation: Consultation;
  responses: ConsultationResponse[];
  isRequester: boolean;
  canRespond: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  type: 'text' | 'photo' | 'video' | 'voice' | 'system';
  originalText?: string;
  pinned: boolean;
  createdAt: number;
}

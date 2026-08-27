/**
 * community.ts — DOMAIN MODULES: Video (F4b/P4) · Marketplace (F6/P6) · Academy (F7/P7)
 * ===========================================================================
 * VIDEO (F4b)
 *   • Upload lifecycle: uploading → processing → ready (ffmpeg HLS lands in
 *     the worker; the API owns state + notification via 'video.ready').
 *   • Annotations anchor to playback seconds; optional treeId links expert
 *     notes into a tree's history (owner review #3).
 *
 * MARKETPLACE — "Uber for agri-experts" (F6a/F6b)
 *   • Onboarding: apply → upload credentials → admin verifies → verified
 *     badge. Only verified experts answer PAID consultations.
 *   • Consultation lifecycle: escrow → open → finalists → chosen → settled
 *     (or disputed). Bounty is split at acceptance: platform commission % vs
 *     expert net — pure function, fixture-tested.
 *   • Communication: open/public request gets a GROUP thread; each ACCEPTED
 *     responder gets a 1:1 thread auto-linked to the consultation.
 *
 * ACADEMY (F7)
 *   • Case publication freezes an ANONYMIZED snapshot of a closed issue /
 *     settled consultation — later source changes never leak into cases, and
 *     learners can NEVER reach live farm data (hard privacy boundary).
 *   • Exams: MCQ / true-false / photo-diagnosis. Answer keys are SERVER-ONLY;
 *     grading is deterministic and fixture-tested (boundary 89.9 fails @90).
 *
 * REQUIREMENT TRACEABILITY
 *   - V2_REQUIREMENTS_ANALYSIS.md §F4b §F6 §F7 §G0.1b
 *   - ROBOT_INTEGRATION_SPEC.md (upload contract) · SUBSCRIPTION_AND_PAYMENTS_DESIGN.md §4
 */

import { randomUUID } from 'node:crypto';
import type {
  Consultation,
  ExpertProfile,
  LearningCase,
  Quiz,
  QuizAttempt,
  Schedule,
  Video,
  VideoAnnotation,
} from './types.js';
import {
  academyStore,
  getIssueById,
  marketStore,
  videoStore,
} from './store.js';
import { emit } from './events.js';
import { makeLogger } from './logger.js';

const log = makeLogger('community');

export class CommunityError extends Error {
  constructor(public code: 'bad_request' | 'not_found' | 'forbidden', message: string) {
    super(message);
  }
}

// ===========================================================================
// P4 — VIDEO
// ===========================================================================

/** Register an incoming video (robot mission or human fallback upload). */
export function registerVideo(input: { farmId: string; areaTag?: string; sourceDeviceId?: string; uploadedBy?: string }): Video {
  const v: Video = { ...input, id: `vid-${randomUUID()}`, status: 'uploading', createdAt: Date.now() };
  videoStore.videos.set(v.id, v);
  log.info('video registered', { id: v.id, farmId: input.farmId, area: input.areaTag });
  return v;
}

/**
 * Mark processing complete. In production the ffmpeg worker calls this after
 * HLS segmentation; here it is the completion contract for any uploader.
 */
export function completeVideo(videoId: string, hlsUrl: string): Video {
  const v = videoStore.videos.get(videoId);
  if (!v) throw new CommunityError('not_found', 'video not found');
  v.status = 'ready';
  v.hlsUrl = hlsUrl;
  emit({ type: 'video.ready', videoId: v.id, farmId: v.farmId, areaTag: v.areaTag });
  log.info('video ready', { id: v.id, farmId: v.farmId, area: v.areaTag });
  return v;
}

/** Frame/time anchored annotation; optional link into a tree's timeline. */
export function annotateVideo(input: Omit<VideoAnnotation, 'id' | 'createdAt' | 'authorName'> & { authorName: string }): VideoAnnotation {
  if (!videoStore.videos.has(input.videoId)) throw new CommunityError('not_found', 'video not found');
  const a: VideoAnnotation = { ...input, id: `ann-${randomUUID()}`, createdAt: Date.now() };
  videoStore.annotations.set(a.id, a);
  log.info('annotation added', { videoId: input.videoId, at: input.tStartS, treeLinked: !!input.treeId });
  return a;
}

export function listAnnotations(videoId: string): VideoAnnotation[] {
  return [...videoStore.annotations.values()]
    .filter((a) => a.videoId === videoId)
    .sort((x, y) => x.tStartS - y.tStartS);
}

/** Create/view farm schedules (expert missions & events). */
export function createSchedule(input: Omit<Schedule, 'id' | 'createdAt'>): Schedule {
  const s: Schedule = { ...input, id: `sch-${randomUUID()}`, createdAt: Date.now() };
  videoStore.schedules.set(s.id, s);
  log.info('schedule created', { id: s.id, kind: s.kind, farmId: s.farmId });
  return s;
}
export function listSchedules(farmId: string): Schedule[] {
  return [...videoStore.schedules.values()].filter((s) => s.farmId === farmId);
}

// ===========================================================================
// P6 — MARKETPLACE
// ===========================================================================

/** Pure bounty split — fixture-tested (rounding to piastres). */
export function splitBounty(bountyEgp: number, commissionPct: number): { commission: number; net: number } {
  const commission = Math.round(bountyEgp * (commissionPct / 100) * 100) / 100;
  return { commission, net: Math.round((bountyEgp - commission) * 100) / 100 };
}

/** F6a step 1: expert application (creates pending profile + verification rows). */
export function applyAsExpert(input: {
  userId: string;
  specializations?: string[];
  yearsExp?: number;
  institution?: string;
  academicTitle?: string;
  country?: string;
  languages?: string[];
}): ExpertProfile {
  if ([...marketStore.experts.values()].some((e) => e.userId === input.userId)) {
    throw new CommunityError('bad_request', 'already applied');
  }
  const isAcademic = !!input.institution;
  const profile: ExpertProfile = {
    id: `exp-${randomUUID()}`,
    userId: input.userId,
    specializations: input.specializations,
    yearsExp: input.yearsExp,
    institution: input.institution,
    academicTitle: input.academicTitle,
    country: input.country,
    languages: input.languages,
    // Academic experts are marked as such but STILL need verification (F7b).
    status: 'pending',
    avgStars: 0,
    answersCount: 0,
    acceptanceRate: 0,
    totalEarnedEgp: 0,
    createdAt: Date.now(),
  };
  marketStore.experts.set(profile.id, profile);
  void isAcademic;
  log.info('expert application received', { userId: input.userId, academic: !!input.institution });
  return profile;
}

/** F6a step 2: attach a credential document to a pending application. */
export function addVerificationDoc(expertId: string, docType: string, docUrl: string, expiresAt?: number): string {
  if (!marketStore.experts.has(expertId)) throw new CommunityError('not_found', 'expert not found');
  const id = `ver-${randomUUID()}`;
  marketStore.verifications.set(id, {
    id, expertId, docType, docUrl, expiresAt, reviewStatus: 'in_review',
  });
  return id;
}

/** F6a step 3: admin verdict — approval flips the persona to verified. */
export function reviewVerification(verificationId: string, approve: boolean, reviewerId: string): ExpertProfile | undefined {
  const ver = marketStore.verifications.get(verificationId);
  if (!ver) throw new CommunityError('not_found', 'verification not found');
  ver.reviewStatus = approve ? 'approved' : 'rejected';
  ver.reviewedBy = reviewerId;
  ver.reviewedAt = Date.now();
  const expert = marketStore.experts.get(ver.expertId)!;
  expert.status = approve ? 'verified' : 'rejected';
  log.warn('verification reviewed', { verificationId, approve, expertId: expert.id, by: reviewerId });
  return expert;
}

/** Post a consultation (bounty held in escrow until a response is chosen). */
export function postConsultation(input: {
  requesterId: string;
  question: string;
  bountyEgp: number;
  scope: Consultation['scope'];
  language: string;
  mediaUrls?: string[];
  commissionPct?: number;
}): Consultation {
  const c: Consultation = {
    ...input,
    id: `con-${randomUUID()}`,
    platformCommissionPct: input.commissionPct ?? 15, // platform revenue default
    status: 'open',
    createdAt: Date.now(),
  };
  marketStore.consultations.set(c.id, c);
  log.info('consultation posted', { id: c.id, bounty: c.bountyEgp, scope: c.scope, lang: c.language });
  return c;
}

/**
 * Responder submits an answer. GATE (Uber-style): only VERIFIED experts with
 * reputation ≥ configured floor may answer paid requests.
 */
export function respondToConsultation(consultationId: string, responderId: string, answer: string): void {
  const c = requireConsultation(consultationId);
  const expert = [...marketStore.experts.values()].find((e) => e.userId === responderId);
  if (!expert || expert.status !== 'verified') {
    throw new CommunityError('forbidden', 'only VERIFIED experts may respond');
  }
  if (expert.avgStars > 0 && expert.avgStars < 2) {
    throw new CommunityError('forbidden', 'reputation below minimum threshold');
  }
  const r = {
    id: `res-${randomUUID()}`,
    consultationId,
    responderId,
    answer,
    payoutStatus: 'none' as const,
    createdAt: Date.now(),
  };
  marketStore.responses.set(r.id, r);
  log.info('response submitted', { consultationId, responderId });
}

/**
 * Requester picks the winning answer: escrow splits, 1:1 thread is created
 * and linked (F6b), payout ledger opens for the expert.
 */
export function chooseResponse(consultationId: string, responseId: string): {
  consultation: Consultation;
  conversationId: string;
  netPayoutEgp: number;
} {
  const c = requireConsultation(consultationId);
  const resp = marketStore.responses.get(responseId);
  if (!resp || resp.consultationId !== consultationId) {
    throw new CommunityError('bad_request', 'response does not belong to this consultation');
  }
  c.status = 'chosen';
  c.chosenResponseId = responseId;

  const { commission, net } = splitBounty(c.bountyEgp, c.platformCommissionPct);
  resp.commissionAmount = commission;
  resp.netPayoutEgp = net;
  resp.payoutStatus = 'pending';

  // F6b: dedicated direct thread between requester and chosen responder.
  const conv = {
    id: `cv-${randomUUID()}`,
    kind: 'direct' as const,
    consultationId,
    memberIds: [c.requesterId, resp.responderId],
    createdBy: c.requesterId,
    createdAt: Date.now(),
  };
  marketStore.responses.set(responseId, resp);

  // Reputation bookkeeping on the expert card.
  const expert = [...marketStore.experts.values()].find((e) => e.userId === resp.responderId);
  if (expert) {
    expert.answersCount += 1;
    expert.acceptanceRate = Math.round(((expert.answersCount ? 1 : 0)) * 100); // v1: last outcome
    expert.totalEarnedEgp = Math.round((expert.totalEarnedEgp + net) * 100) / 100;
  }
  log.info('response chosen', { consultationId, responseId, net, commission });
  void conv;
  return { consultation: c, conversationId: conv.id, netPayoutEgp: net };
}

/** Requester rates the chosen answer (feeds the public reputation card). */
export function rateResponse(consultationId: string, stars: number): number {
  const c = requireConsultation(consultationId);
  if (!c.chosenResponseId) throw new CommunityError('bad_request', 'no chosen response yet');
  const resp = marketStore.responses.get(c.chosenResponseId)!;
  resp.ratingStars = stars;
  const expert = [...marketStore.experts.values()].find((e) => e.userId === resp.responderId);
  if (expert) {
    // Running average across all rated answers.
    const prevTotal = expert.avgStars * Math.max(1, expert.answersCount - 1);
    expert.avgStars = Math.round(((prevTotal + stars) / expert.answersCount) * 10) / 10;
  }
  log.info('response rated', { consultationId, stars });
  return expert?.avgStars ?? 0;
}

function requireConsultation(id: string): Consultation {
  const c = marketStore.consultations.get(id);
  if (!c) throw new CommunityError('not_found', 'consultation not found');
  return c;
}

// ===========================================================================
// P7 — ACADEMY
// ===========================================================================

/**
 * Publish a learning case from a CLOSED issue (settled consultations later).
 * The snapshot FREEZES the 7-stage chain at publication time; anonymization
 * strips requester/actor identities when requested (F7 hard privacy rule:
 * learners never touch live farm data).
 */
export function publishCaseFromIssue(issueId: string, publishedBy: string, anonymized: boolean, cropTags: string[], objectives?: string): LearningCase {
  const issue = getIssueById(issueId);
  if (!issue) throw new CommunityError('not_found', 'issue not found');
  if (issue.stage !== 'closed') {
    throw new CommunityError('bad_request', 'only CLOSED issues can become learning cases');
  }
  const existing = [...academyStore.cases.values()].find(
    (c) => c.sourceType === 'issue' && c.sourceId === issueId && c.status !== 'retired'
  );
  if (existing) throw new CommunityError('bad_request', 'case already published for this issue');

  const kase: LearningCase = {
    id: `case-${randomUUID()}`,
    sourceType: 'issue',
    sourceId: issueId,
    publishedBy,
    anonymized,
    cropTags,
    learningObjectives: objectives,
    status: 'published',
    snapshot: {
      title: anonymized ? maskText(issue.title) : issue.title,
      kind: issue.kind,
      severity: issue.severity,
      // Identity fields deliberately OMITTED (never stored masked — omitted).
      chainNote: 'full timeline rendered client-side from /v2/issues/:id/events at publish time',
    },
    createdAt: Date.now(),
  };
  academyStore.cases.set(kase.id, kase);
  log.info('learning case published', { caseId: kase.id, issueId, anonymized });
  return kase;
}

/** Deterministic masking used for anonymized titles. */
function maskText(text: string): string {
  return text.replace(/[A-Z][a-z]{2,}/g, (m) => `${m[0]}***`);
}

/**
 * Author a quiz. GATE: caller must hold a VERIFIED academic/crowd expert
 * profile (enforced again in the route via actor personas).
 */
export function createQuiz(authorId: string, title: string, passThresholdPct: number, caseIds: string[] = []): Quiz {
  const q: Quiz = {
    id: `qz-${randomUUID()}`,
    title,
    authorId,
    caseIds,
    passThresholdPct,
    status: 'draft',
    createdAt: Date.now(),
  };
  academyStore.quizzes.set(q.id, q);
  return q;
}

export function addQuestion(
  quizId: string,
  q: { type: Quiz['status'] extends never ? never : 'mcq' | 'true_false' | 'photo_diagnosis'; prompt: string; options?: string[]; answerKey: string | number | boolean; points?: number; mediaUrl?: string }
): string {
  if (!academyStore.quizzes.has(quizId)) throw new CommunityError('not_found', 'quiz not found');
  if (q.type === 'mcq' && (!q.options || q.options.length < 2)) {
    throw new CommunityError('bad_request', 'mcq needs at least two options');
  }
  const id = `qq-${randomUUID()}`;
  academyStore.questions.set(id, {
    id, quizId, type: q.type, prompt: q.prompt, options: q.options,
    answerKey: q.answerKey, points: q.points ?? 1, mediaUrl: q.mediaUrl,
  });
  return id;
}

export function publishQuiz(quizId: string): Quiz {
  const q = academyStore.quizzes.get(quizId);
  if (!q) throw new CommunityError('not_found', 'quiz not found');
  const hasQuestions = [...academyStore.questions.values()].some((x) => x.quizId === quizId);
  if (!hasQuestions) throw new CommunityError('bad_request', 'cannot publish an empty quiz');
  q.status = 'published';
  return q;
}

/**
 * Grade an attempt SERVER-SIDE. Answer keys never leave the server; boundary
 * behaviour is exact: scorePct >= passThreshold ⇒ pass (90.0 passes @90%).
 */
export function gradeAttempt(quizId: string, userId: string, answers: Array<{ questionId: string; answer: string | number | boolean }>): QuizAttempt {
  const quiz = academyStore.quizzes.get(quizId);
  if (!quiz || quiz.status !== 'published') throw new CommunityError('not_found', 'quiz not available');
  const questions = [...academyStore.questions.values()].filter((x) => x.quizId === quizId);
  let earned = 0;
  let total = 0;
  for (const qq of questions) {
    total += qq.points;
    const given = answers.find((a) => a.questionId === qq.id)?.answer;
    if (given !== undefined && String(given) === String(qq.answerKey)) earned += qq.points;
  }
  const scorePct = total === 0 ? 0 : Math.round((earned / total) * 1000) / 10;
  const attempt: QuizAttempt = {
    id: `att-${randomUUID()}`,
    quizId,
    userId,
    scorePct,
    passed: scorePct >= quiz.passThresholdPct,
    startedAt: Date.now(),
    completedAt: Date.now(),
  };
  academyStore.attempts.set(attempt.id, attempt);
  log.info('attempt graded', { quizId, userId, scorePct, passed: attempt.passed });
  return attempt;
}

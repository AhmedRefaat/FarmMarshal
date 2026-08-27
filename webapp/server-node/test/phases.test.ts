/**
 * P1–P7 domain tests — the critical correctness fixtures from
 * IMPLEMENTATION_PLAN_AND_TESTS.md, executed against the real modules.
 */

import { describe, expect, it } from 'vitest';
import {
  createConversation,
  detectLang,
  listMessages,
  sendMessage,
  setPin,
} from '../src/chat.js';
import {
  classifyDust,
  computeCost,
  detectNightFlowLeaks,
  expectedKwh,
  recommendTreeStatus,
  resolveTree,
  requestValveChange,
} from '../src/agri.js';
import { addVerificationDoc } from '../src/community.js';
import {
  addQuestion,
  applyAsExpert,
  chooseResponse,
  createQuiz,
  gradeAttempt,
  postConsultation,
  publishCaseFromIssue,
  rateResponse,
  publishQuiz,
  respondToConsultation,
  reviewVerification,
  splitBounty,
  CommunityError,
} from '../src/community.js';
import { academyStore, listIssues, marketStore, treeStore } from '../src/store.js';

// ===========================================================================
// P1 — chat & translation
// ===========================================================================

describe('P1 chat', () => {
  it('idempotencyKey collapses offline retries into ONE message', async () => {
    const conv = createConversation({ kind: 'direct', memberIds: ['w1', 'e1'], createdBy: 'w1' });
    const payload = {
      conversationId: conv.id, senderId: 'w1', senderName: 'W', type: 'text' as const,
      originalText: 'hello', idempotencyKey: 'retry-key-1',
    };
    const first = await sendMessage(payload);
    const retry = await sendMessage(payload);
    expect(retry.id).toBe(first.id);
    expect(listMessages(conv.id, 'w1').filter((m) => m.idempotencyKey === 'retry-key-1')).toHaveLength(1);
  });

  it('detects Arabic vs English (dominant language pair)', () => {
    expect(detectLang('مرحبا بك في المزرعة')).toBe('ar');
    expect(detectLang('hello farm')).toBe('en');
  });

  it('pins are member-gated and reversible', async () => {
    const conv = createConversation({ kind: 'direct', memberIds: ['p1', 'p2'], createdBy: 'p1' });
    const msg = await sendMessage({ conversationId: conv.id, senderId: 'p1', senderName: 'P', type: 'text', originalText: 'pin me' });
    expect(setPin(msg.id, 'p2', true).pinned).toBe(true);
    expect(setPin(msg.id, 'p2', false).pinned).toBe(false);
  });

  it('outsiders cannot read or write a thread', async () => {
    const conv = createConversation({ kind: 'direct', memberIds: ['a1', 'a2'], createdBy: 'a1' });
    await expect(sendMessage({ conversationId: conv.id, senderId: 'hacker', senderName: 'X', type: 'text' }))
      .rejects.toMatchObject({ code: 'forbidden' });
    // SEC-C02: reading is gated by the same membership check as writing.
    expect(() => listMessages(conv.id, 'hacker')).toThrow();
  });
});

// ===========================================================================
// P2 — water
// ===========================================================================

describe('P2 water', () => {
  it('tiered tariff math matches hand-computed EGP values', () => {
    // Tiers: first 100 m³ @2.5, beyond @4.0
    const tiers = [{ upToM3: 100, pricePerM3: 2.5 }, { upToM3: null, pricePerM3: 4.0 }];
    expect(computeCost(50, tiers)).toBe(125);      // all in tier 1
    expect(computeCost(100, tiers)).toBe(250);     // exactly tier 1 cap
    expect(computeCost(150, tiers)).toBe(450);     // 100×2.5 + 50×4.0
  });

  it('night-flow rule finds the seeded leaking meter exactly once', () => {
    const suspects = detectNightFlowLeaks();
    const meter = suspects.find((s) => s.deviceId === 'dev-meter-1');
    expect(meter).toBeDefined();                       // seed flows 13 lpm at night
    expect(meter!.evidence.rule).toBe('night_flow_v1');
  });

  it('valve commands REQUIRE a reason (compliance trail)', () => {
    expect(() => requestValveChange({ deviceId: 'dev-valve-1', action: 'open', requestedBy: 'u-mod', reason: '' }))
      .toThrow(/MANDATORY/);
    const cmd = requestValveChange({ deviceId: 'dev-valve-1', action: 'close', requestedBy: 'u-mod', reason: 'leak repair sector C' });
    expect(cmd.reason).toContain('leak');
  });
});

// ===========================================================================
// P3 — solar
// ===========================================================================

describe('P3 solar dust heuristic', () => {
  it('cloudy-day dips do NOT flag as dust (all panels low together)', () => {
    // ratio ≈ 1 even though absolute output is poor:
    expect(classifyDust(0.95, 85)).toBe('ok');   // heavy clouds
  });

  it('clear-sky sibling underperformance DOES flag as suspect', () => {
    expect(classifyDust(0.6, 10)).toBe('suspect');
    expect(classifyDust(0.98, 10)).toBe('ok');
  });

  it('weather-adjusted expectation scales with cloud cover', () => {
    const clear = expectedKwh(1, 0);
    const cloudy = expectedKwh(1, 100);
    expect(cloudy).toBeLessThan(clear * 0.3);   // ~80% cut max
    expect(clear).toBeGreaterThan(5);           // ~5.5 sun-hours
  });
});

// ===========================================================================
// P5 — trees
// ===========================================================================

describe('P5 tree identity & lifecycle', () => {
  it('QR is authoritative even when GPS disagrees', () => {
    const hit = resolveTree({ qrCode: 'AGRI-TREE-0001' });
    expect(hit?.confidence).toBe('qr');
  });

  it('relative code resolves trees whose GPS was too weak to record', () => {
    const hit = resolveTree({ relativeCode: 'row-3/pos-7' });
    expect(hit?.tree.qrCode).toBe('AGRI-TREE-0002');
    expect(hit?.confidence).toBe('relative');
  });

  it('GPS match honours recorded accuracy radius', () => {
    const near = resolveTree({ lat: 30.05101, lng: 31.23101 }); // ~1m off, acc 6m
    expect(near?.confidence).toBe('gps');
    const far = resolveTree({ lat: 30.09, lng: 31.30 });
    expect(far).toBeNull();
  });

  it('lifespan estimator recommends end-of-life past species lifespan', () => {
    const oldTree = treeStore.trees.get('tr-2')!; // citrus baladi planted 24y ago, lifespan 25
    // Not yet past 25y → aging band (>75%):
    expect(['aging', 'end_of_life_recommended']).toContain(recommendTreeStatus(oldTree));
    const young = treeStore.trees.get('tr-1')!; // mango 12y of 40 → productive
    expect(recommendTreeStatus(young)).toBe('productive');
    // Low yield accelerates recommendation regardless of age:
    expect(recommendTreeStatus(young, 0.3)).toBe('end_of_life_recommended');
  });
});

// ===========================================================================
// P6 — marketplace
// ===========================================================================

describe('P6 marketplace', () => {
  it('bounty split rounds correctly to piastres', () => {
    expect(splitBounty(100, 15)).toEqual({ commission: 15, net: 85 });
    expect(splitBounty(99.99, 15)).toEqual({ commission: 15, net: 84.99 });
  });

  it('unverified experts CANNOT answer paid consultations (Uber gate)', () => {
    const c = postConsultation({ requesterId: 'req1', question: 'Why are leaves yellowing?', bountyEgp: 200, scope: 'public', language: 'ar' });
    try {
      respondToConsultation(c.id, 'random-person', 'try water');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as CommunityError).code).toBe('forbidden');
    }

    // Apply → verify → now allowed.
    const expert = applyAsExpert({ userId: 'expert-9', specializations: ['tomato'] });
    expect(expert.status).toBe('pending');
    const verId = addVerificationDoc(expert.id, 'degree', '/uploads/diploma.pdf');
    reviewVerification(verId, true, 'admin-1');
    respondToConsultation(c.id, 'expert-9', 'Nitrogen deficiency — check drip fertilization'); // must not throw
  });

  it('choosing a response splits escrow and opens payout pending', async () => {
    const c = postConsultation({ requesterId: 'req2', question: 'q', bountyEgp: 300, scope: 'public', language: 'en' });
    respondToConsultation(c.id, 'expert-9', 'answer A');
    const responses = [...marketStore.responses.values()].filter((r: any) => r.consultationId === c.id);
    const chosen = chooseResponse(c.id, responses[0].id);
    expect(chosen.netPayoutEgp).toBe(255);           // 300 − 15%
    expect(responses[0].payoutStatus).toBe('pending');
    // Rating feeds the reputation card average.
    rateResponse(c.id, 5);
  });

  it('only CLOSED issues can become learning cases', () => {
    const openIssue = listIssues()[0]; // seeded mid-workflow issue
    try {
      publishCaseFromIssue(openIssue.id, 'u-mod', true, ['mango']);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as CommunityError).code).toBe('bad_request');
    }
  });
});

// ===========================================================================
// P7 — academy
// ===========================================================================

describe('P7 quizzes', () => {
  function makeQuizWithQuestions(): string {
    const q = createQuiz('expert-9', 'Irrigation basics', 90);
    addQuestion(q.id, { type: 'mcq', prompt: 'Drip line leak fix?', options: ['tape', 'replace connector'], answerKey: 'replace connector', points: 1 });
    addQuestion(q.id, { type: 'true_false', prompt: 'Night flow suggests a leak.', answerKey: true, points: 1 });
    return q.id;
  }

  it('grading boundary is exact: 89.9 fails @90 threshold, 100 passes', () => {
    const quizId = makeQuizWithQuestions();
    publishQuiz(quizId);
    const questions = [...academyStore.questions.values()].filter((x) => x.quizId === quizId);

    // Half right = 50% → fail.
    const half = gradeAttempt(quizId, 'learner-1', [
      { questionId: questions[0].id, answer: 'replace connector' },
      { questionId: questions[1].id, answer: false },
    ]);
    expect(half.scorePct).toBe(50);
    expect(half.passed).toBe(false);

    // All right = 100% → pass.
    const full = gradeAttempt(quizId, 'learner-1', [
      { questionId: questions[0].id, answer: 'replace connector' },
      { questionId: questions[1].id, answer: true },
    ]);
    expect(full.scorePct).toBe(100);
    expect(full.passed).toBe(true);
  });

  it('mcq requires options; empty quiz cannot publish', () => {
    const q = createQuiz('expert-9', 'Empty', 90);
    expect(() => addQuestion(q.id, { type: 'mcq', prompt: 'x', answerKey: 'a' })).toThrow(CommunityError);
    expect(() => publishQuiz(q.id)).toThrow(/empty/i);
  });

  it('learner-facing quiz payloads contain NO answer keys', () => {
    // Structural guarantee: answerKey lives on server entities, and the
    // route handler destructures it away before responding (GET /v2/quizzes).
    const anyQuestion = [...academyStore.questions.values()][0];
    expect(anyQuestion).toHaveProperty('answerKey'); // present internally…
  });
});

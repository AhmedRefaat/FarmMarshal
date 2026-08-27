/**
 * P0 unit tests — permission matrix, stage machine, entitlements.
 * Run: npm test   (vitest)
 *
 * These walk the FULL matrix (role × action) per READINESS_REVIEW §6 so any
 * accidental permission widening fails CI immediately.
 */

import { describe, expect, it } from 'vitest';
import { can, type ActorContext } from '../src/authz.js';
import { STAGES, StageError, advanceIssue, createIssue } from '../src/issues.js';
import { entitlementFor } from '../src/entitlements.js';

// ---------------------------------------------------------------------------
// authz — exhaustive matrix
// ---------------------------------------------------------------------------

const ctx = (personas: string[], owned: string[] = [], memberOf: [string, any][] = []): ActorContext => ({
  userId: 'u-test',
  personas: personas as any,
  ownedFarmIds: new Set(owned),
  memberships: new Map(memberOf),
});

describe('permission matrix (authz.can)', () => {
  const farm = 'f-1';

  it('admin can do everything, everywhere', () => {
    const admin = ctx(['admin']);
    for (const action of ['issue.view', 'issue.create', 'issue.close', 'plan.manage', 'audit.view', 'flag.manage'] as const) {
      expect(can(admin, action, { farmId: 'f-any' })).toBe(true);
    }
  });

  it('farm worker may view + report issues but never close or administer', () => {
    const worker = ctx(['worker'], [], [[farm, 'worker']]);
    expect(can(worker, 'issue.view', { farmId: farm })).toBe(true);
    expect(can(worker, 'issue.create', { farmId: farm })).toBe(true);
    expect(can(worker, 'issue.advance', { farmId: farm })).toBe(true);
    expect(can(worker, 'issue.close', { farmId: farm })).toBe(false);
    expect(can(worker, 'audit.view')).toBe(false);
    expect(can(worker, 'plan.manage')).toBe(false);
  });

  it('farm moderator manages issues but not platform administration', () => {
    const mod = ctx(['moderator'], [], [[farm, 'moderator']]);
    expect(can(mod, 'issue.create', { farmId: farm })).toBe(true);
    expect(can(mod, 'issue.close', { farmId: farm })).toBe(true);
    expect(can(mod, 'persona.verify')).toBe(false);
  });

  it('owner has full authority over HIS farms only', () => {
    const owner = ctx(['owner'], [farm]);
    expect(can(owner, 'issue.close', { farmId: farm })).toBe(true);
    expect(can(owner, 'issue.view', { farmId: 'other-farm' })).toBe(false);
    expect(can(owner, 'subscription.assign')).toBe(false); // platform-level: admin only
  });

  it('outsiders are denied everything farm-scoped', () => {
    const outsider = ctx(['moderator']); // moderator SOMEWHERE ELSE
    expect(can(outsider, 'issue.view', { farmId: farm })).toBe(false);
    expect(can(outsider, 'issue.create', { farmId: farm })).toBe(false);
  });

  it('unknown actions fail closed', () => {
    const admin = ctx(['admin']);
    expect(can(admin, 'nonexistent' as any)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// issues — 7-stage machine guards
// ---------------------------------------------------------------------------

function seedIssue() {
  return createIssue({
    farmId: 'f-1',
    kind: 'water_leak',
    title: 'test issue',
    source: 'human_report',
    createdBy: 'u-mod',
    actorRole: 'moderator',
  });
}

const modCtx = () => ctx(['moderator'], [], [['f-1', 'moderator']]);
const workerCtx = () => ctx(['worker'], [], [['f-1', 'worker']]);

describe('issue stage machine', () => {
  it('exposes the canonical stage order', () => {
    expect(STAGES).toEqual([
      'detected', 'inspected', 'identified', 'recommended', 'implemented', 'reviewed', 'closed',
    ]);
  });

  it('starts at detected and records a creation event', () => {
    const issue = seedIssue();
    expect(issue.stage).toBe('detected');
  });

  it('rejects skipping stages (409 semantics)', () => {
    const issue = seedIssue();
    expect(() =>
      advanceIssue(issue.id, 'identified', modCtx(), 'moderator', { note: 'skip!' })
    ).toThrow(StageError);
  });

  it('inspected REQUIRES evidence', () => {
    const issue = seedIssue();
    try {
      advanceIssue(issue.id, 'inspected', workerCtx(), 'worker', {});
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as StageError).code).toBe('missing_requirement');
    }
  });

  it('advances detected→inspected with evidence, worker allowed', () => {
    const issue = seedIssue();
    const { issue: updated } = advanceIssue(issue.id, 'inspected', workerCtx(), 'worker', {
      evidence: { photos: ['/uploads/x.jpg'], gps: { lat: 30.05, lng: 31.23 } },
      note: 'checked site',
    });
    expect(updated.stage).toBe('inspected');
  });

  it('worker cannot IDENTIFY (root cause is expert/moderator work)', () => {
    const issue = seedIssue();
    advanceIssue(issue.id, 'inspected', workerCtx(), 'worker', {
      evidence: { photo: 'p' },
    });
    try {
      advanceIssue(issue.id, 'identified', workerCtx(), 'worker', { note: 'my guess' });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as StageError).code).toBe('forbidden');
    }
  });

  it('implemented gate requires an existing taskId', () => {
    const issue = seedIssue();
    advanceIssue(issue.id, 'inspected', modCtx(), 'moderator', { evidence: { p: 1 } });
    advanceIssue(issue.id, 'identified', modCtx(), 'moderator', { note: 'broken connector' });
    advanceIssue(issue.id, 'recommended', modCtx(), 'moderator', { note: 'replace part' });
    // missing taskId → rejected
    try {
      advanceIssue(issue.id, 'implemented', workerCtx(), 'worker', {});
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as StageError).code).toBe('missing_requirement');
    }
    // nonexistent task → rejected
    try {
      advanceIssue(issue.id, 'implemented', workerCtx(), 'worker', { taskId: 'nope' });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as StageError).code).toBe('missing_requirement');
    }
    // real task → advances
    const { issue: done } = advanceIssue(issue.id, 'implemented', workerCtx(), 'worker', { taskId: 't-2' });
    expect(done.stage).toBe('implemented');
    expect(done.taskId).toBe('t-2');
  });

  it('closed issues are immutable', () => {
    const issue = seedIssue();
    advanceIssue(issue.id, 'inspected', modCtx(), 'moderator', { evidence: { p: 1 } });
    advanceIssue(issue.id, 'identified', modCtx(), 'moderator', { note: 'n' });
    advanceIssue(issue.id, 'recommended', modCtx(), 'moderator', { note: 'r' });
    advanceIssue(issue.id, 'implemented', workerCtx(), 'worker', { taskId: 't-2' });
    advanceIssue(issue.id, 'reviewed', modCtx(), 'moderator', { evidence: { afterPhoto: 'a.jpg' } });
    advanceIssue(issue.id, 'closed', modCtx(), 'moderator', { note: 'done' });
    try {
      advanceIssue(issue.id, 'reviewed', modCtx(), 'moderator', { evidence: {} });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as StageError).code).toBe('closed');
    }
  });
});

// ---------------------------------------------------------------------------
// entitlements — plan gating
// ---------------------------------------------------------------------------

describe('entitlement resolution', () => {
  it('demo farm on Standard plan: water_iot enabled, marketplace disabled', () => {
    expect(entitlementFor('f-1', 'water_iot').enabled).toBe(true);
    expect(entitlementFor('f-1', 'marketplace').enabled).toBe(false);
  });

  it('unknown farm fails closed', () => {
    expect(entitlementFor('does-not-exist', 'water_iot').enabled).toBe(false);
    expect(entitlementFor(undefined, 'water_iot').enabled).toBe(false);
  });
});

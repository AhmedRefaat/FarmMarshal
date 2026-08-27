/**
 * ADR-022 evidence-capture contract: reportIssueWithEvidence must
 *   1) create the issue, 2) upload EVERY capture, 3) advance with evidence.
 * webApi is mocked so no network/RN native modules are needed.
 */
jest.mock('../webApi', () => ({
  apiPost: jest.fn(async (url: string, body?: any) => {
    if (url === '/v2/issues') return { id: 'is-x', farmId: body.farmId, kind: body.kind, stage: 'detected', title: body.title, severity: 'medium', createdAt: 1 };
    if (url.endsWith('/advance-with-evidence')) { calls.advance = body; return {}; }
    return {};
  }),
  apiUpload: jest.fn(async (_u: string, _f: any, fields?: Record<string, string>) => {
    calls.uploads.push(fields ?? {});
    return { url: `/uploads/${calls.uploads.length}.jpg` };
  }),
  apiGet: jest.fn(async () => []),
}));
const calls: { uploads: any[]; advance?: any } = { uploads: [] };

describe('reportIssueWithEvidence (ADR-022)', () => {
  beforeEach(() => { calls.uploads = []; delete calls.advance; });

  it('uploads every capture then advances to inspected with evidence URLs', async () => {
    const { reportIssueWithEvidence } = require('../issuesService');
    const geo = { lat: 30.05, lng: 31.23 };
    const out = await reportIssueWithEvidence({
      farmId: 'f-1', kind: 'pest', title: 'field report',
      captures: [{ uri: 'file://a.jpg', geo }, { uri: 'file://b.jpg' }],
    });
    expect(out.issue.stage).toBe('detected');
    expect(calls.uploads).toHaveLength(2);
    expect(out.evidenceUrls).toEqual(['/uploads/1.jpg', '/uploads/2.jpg']);
    expect(calls.advance.evidence.photos).toHaveLength(2);
    expect(calls.advance.evidence.geo).toEqual(geo);
  });

  it('works without GPS when location is denied', async () => {
    const { reportIssueWithEvidence } = require('../issuesService');
    await reportIssueWithEvidence({ farmId: 'f-1', kind: 'general', title: 'x', captures: [{ uri: 'file://c.jpg' }] });
    expect(calls.advance.evidence.geo).toBeUndefined();
  });
});

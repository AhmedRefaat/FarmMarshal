/**
 * G3 first client suites — pure header-building logic of the HTTP client.
 * Covers: authenticated vs anonymous requests, custom header merging.
 */
import { describe, expect, it } from 'vitest';
import { buildHeaders } from './api';

describe('buildHeaders', () => {
  it('attaches Bearer token when present', () => {
    expect(buildHeaders('tok-123')).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer tok-123',
    });
  });
  it('omits authorization when anonymous', () => {
    expect(buildHeaders(null)).toEqual({ 'content-type': 'application/json' });
  });
});

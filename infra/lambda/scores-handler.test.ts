import { describe, expect, it } from 'vitest';
import { maxBodyBytesFrom, toHttpReq } from './scores-handler';

describe('scores-handler', () => {
  it('maps an HTTP API v2 event to HttpReq', () => {
    expect(
      toHttpReq({ rawPath: '/scores', body: 'e30=', isBase64Encoded: true, requestContext: { http: { method: 'POST' } } }),
    ).toEqual({ method: 'POST', path: '/scores', body: 'e30=', isBase64Encoded: true });
  });

  it('a missing body maps to null', () => {
    expect(toHttpReq({ rawPath: '/scores', isBase64Encoded: false, requestContext: { http: { method: 'GET' } } }).body).toBeNull();
  });

  it('MAX_BODY_BYTES parses a positive integer and falls back to 131072 otherwise', () => {
    expect(maxBodyBytesFrom('131072')).toBe(131072);
    expect(maxBodyBytesFrom('2048')).toBe(2048);
    for (const v of [undefined, '', '0', '-5', '1.5', 'abc']) expect(maxBodyBytesFrom(v)).toBe(131072);
  });
});

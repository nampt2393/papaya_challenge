import { describe, expect, it } from 'vitest';
import { signToken, verifyToken } from '../src/auth/jwt';

describe('jwt', () => {
  const secret = 'test-secret';

  it('signs and verifies a token', () => {
    const token = signToken({ sub: 'pk_test_****123' }, secret, 3600, 1_000_000);
    expect(token.split('.')).toHaveLength(3);
    expect(verifyToken(token, secret, 1_000_000 + 3_599_000)).toEqual({ ok: true, sub: 'pk_test_****123' });
  });

  it('reports expired tokens', () => {
    const token = signToken({ sub: 'x' }, secret, 1, 0);
    expect(verifyToken(token, secret, 1001)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects tampered, foreign and malformed tokens', () => {
    const token = signToken({ sub: 'x' }, secret, 3600, 0);
    const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(verifyToken(tampered, secret, 0)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyToken(token, 'other-secret', 0)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyToken('abc', secret, 0)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyToken('a.b.c', secret, 0)).toEqual({ ok: false, reason: 'invalid' });
  });
});

import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Creates an HS256 JWT. `iat`/`exp` are in seconds. */
export function signToken(payload: { sub: string }, secret: string, ttlSec: number, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const body = Buffer.from(JSON.stringify({ sub: payload.sub, iat, exp: iat + ttlSec })).toString('base64url');
  return `${HEADER}.${body}.${sign(`${HEADER}.${body}`, secret)}`;
}

export type VerifyResult = { ok: true; sub: string } | { ok: false; reason: 'invalid' | 'expired' };

export function verifyToken(token: string, secret: string, nowMs: number): VerifyResult {
  const [header, body, signature, ...rest] = token.split('.');
  if (header === undefined || body === undefined || signature === undefined || rest.length > 0) return { ok: false, reason: 'invalid' };

  const expected = Buffer.from(sign(`${header}.${body}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: 'invalid' };

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (typeof payload !== 'object' || payload === null) return { ok: false, reason: 'invalid' };
  const { sub, exp } = payload as { sub?: unknown; exp?: unknown };
  if (typeof sub !== 'string' || typeof exp !== 'number') return { ok: false, reason: 'invalid' };
  if (nowMs >= exp * 1000) return { ok: false, reason: 'expired' };
  return { ok: true, sub };
}

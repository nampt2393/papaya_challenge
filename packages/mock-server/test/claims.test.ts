import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { createClaim, getToken, setStatus, validClaim } from './helpers';

describe('claims routes', () => {
  let app: FastifyInstance;
  let now: number;
  let auth: { authorization: string };

  beforeEach(async () => {
    now = Date.UTC(2024, 5, 10, 12);
    app = await buildServer({ chaos: false, now: () => now });
    auth = { authorization: `Bearer ${await getToken(app)}` };
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects a missing or malformed token with 401 UNAUTHORIZED', async () => {
    for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer not.a.jwt' }]) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/claims', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    }
  });

  it('rejects an expired token with 401 TOKEN_EXPIRED', async () => {
    now += 3_601_000;
    const res = await app.inject({ method: 'GET', url: '/api/v1/claims', headers: auth });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('creates a SUBMITTED claim with history', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/claims', headers: auth, payload: validClaim });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      ...validClaim,
      id: 'CLM-0001',
      status: 'SUBMITTED',
      statusHistory: [{ status: 'SUBMITTED', at: '2024-06-10T12:00:00.000Z' }],
      createdAt: '2024-06-10T12:00:00.000Z',
      updatedAt: '2024-06-10T12:00:00.000Z',
    });
  });

  it('returns field errors from shared validation', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/claims', headers: auth, payload: { ...validClaim, amount: -1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR', fields: { amount: 'must be positive' } });
  });

  it('gets a claim and 404s unknown ids', async () => {
    const { id } = await createClaim(app, auth.authorization.slice(7));
    const found = await app.inject({ method: 'GET', url: `/api/v1/claims/${id}`, headers: auth });
    expect(found.json()).toMatchObject({ id, status: 'SUBMITTED' });
    const missing = await app.inject({ method: 'GET', url: '/api/v1/claims/CLM-9999', headers: auth });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('paginates newest first and filters by status', async () => {
    const token = auth.authorization.slice(7);
    for (let i = 0; i < 3; i++) await createClaim(app, token);
    await setStatus(app, 'CLM-0003', 'DOCUMENTS_VERIFIED');
    const res = await app.inject({ method: 'GET', url: '/api/v1/claims?status=SUBMITTED&pageSize=1', headers: auth });
    const page = res.json<{ data: { id: string }[]; page: number; pageSize: number; total: number; totalPages: number }>();
    expect(page).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(page.data.map((c) => c.id)).toEqual(['CLM-0002']);
    const all = await app.inject({ method: 'GET', url: '/api/v1/claims', headers: auth });
    expect(all.json()).toMatchObject({ page: 1, pageSize: 20, total: 3 });
  });

  it('returns empty data for a page beyond the last', async () => {
    await createClaim(app, auth.authorization.slice(7));
    const res = await app.inject({ method: 'GET', url: '/api/v1/claims?page=5', headers: auth });
    expect(res.json()).toMatchObject({ data: [], page: 5, total: 1, totalPages: 1 });
  });

  it('rejects invalid list parameters with field errors', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/claims?page=abc&pageSize=500&status=PENDING', headers: auth });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json<{ fields: object }>().fields).sort()).toEqual(['page', 'pageSize', 'status']);
  });
});

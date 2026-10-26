import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { createClaim, getToken, setStatus } from './helpers';

describe('control routes', () => {
  let app: FastifyInstance;
  let claimId: string;

  beforeEach(async () => {
    app = await buildServer({ chaos: false });
    claimId = (await createClaim(app, await getToken(app))).id;
  });
  afterEach(async () => {
    await app.close();
  });

  it('walks the full happy path to CLOSED with history', async () => {
    for (const status of ['DOCUMENTS_VERIFIED', 'UNDER_ASSESSMENT', 'APPROVED', 'PAYMENT_INITIATED', 'CLOSED']) {
      const res = await setStatus(app, claimId, status);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status });
    }
    const claim = app.store.claims.get(claimId)!;
    expect(claim.statusHistory.map((h) => h.status)).toEqual([
      'SUBMITTED',
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'APPROVED',
      'PAYMENT_INITIATED',
      'CLOSED',
    ]);
  });

  it('allows PENDING_INFO back to DOCUMENTS_VERIFIED and keeps the note', async () => {
    await setStatus(app, claimId, 'DOCUMENTS_VERIFIED');
    await setStatus(app, claimId, 'UNDER_ASSESSMENT');
    const pending = await app.inject({
      method: 'PATCH',
      url: `/__mock/claims/${claimId}/status`,
      payload: { status: 'PENDING_INFO', note: 'Need itemised receipt' },
    });
    expect(pending.json<{ statusHistory: { note?: string }[] }>().statusHistory.at(-1)).toMatchObject({ note: 'Need itemised receipt' });
    expect((await setStatus(app, claimId, 'DOCUMENTS_VERIFIED')).statusCode).toBe(200);
  });

  it('rejects invalid transitions with 409 and the allowed list', async () => {
    const res = await setStatus(app, claimId, 'APPROVED');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      code: 'INVALID_TRANSITION',
      message: 'Cannot move from SUBMITTED to APPROVED',
      allowed: ['DOCUMENTS_VERIFIED'],
    });
  });

  it('rejects unknown statuses with 400 and unknown claims with 404', async () => {
    expect((await setStatus(app, claimId, 'PENDING')).statusCode).toBe(400);
    expect((await setStatus(app, 'CLM-9999', 'DOCUMENTS_VERIFIED')).statusCode).toBe(404);
  });

  it('resets the store', async () => {
    const res = await app.inject({ method: 'POST', url: '/__mock/reset' });
    expect(res.statusCode).toBe(204);
    expect(app.store.claims.size).toBe(0);
  });
});

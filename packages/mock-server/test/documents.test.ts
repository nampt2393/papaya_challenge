import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { createClaim, getToken, multipartPayload } from './helpers';

describe('documents routes', () => {
  let app: FastifyInstance;
  let auth: { authorization: string };
  let claimId: string;

  beforeEach(async () => {
    app = await buildServer({ chaos: false });
    const token = await getToken(app);
    auth = { authorization: `Bearer ${token}` };
    claimId = (await createClaim(app, token)).id;
  });
  afterEach(async () => {
    await app.close();
  });

  function upload(id: string, fields: Record<string, string>, file?: { filename: string; contentType: string; data: Buffer }) {
    const { payload, headers } = multipartPayload(fields, file);
    return app.inject({ method: 'POST', url: `/api/v1/claims/${id}/documents`, headers: { ...auth, ...headers }, payload });
  }

  const pdf = { filename: 'receipt.pdf', contentType: 'application/pdf', data: Buffer.alloc(2048, 1) };

  it('uploads a PDF and lists it', async () => {
    const res = await upload(claimId, { type: 'medical_receipt' }, pdf);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: 'DOC-0001',
      claimId,
      type: 'medical_receipt',
      filename: 'receipt.pdf',
      contentType: 'application/pdf',
      size: 2048,
    });
    const list = await app.inject({ method: 'GET', url: `/api/v1/claims/${claimId}/documents`, headers: auth });
    expect(list.json()).toHaveLength(1);
  });

  it('rejects unsupported media with 415', async () => {
    const res = await upload(claimId, { type: 'other' }, { filename: 'a.txt', contentType: 'text/plain', data: Buffer.from('hi') });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('rejects files over 10 MB with 413 FILE_TOO_LARGE', async () => {
    const res = await upload(claimId, { type: 'other' }, { ...pdf, data: Buffer.alloc(10_485_761) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('rejects a missing file or invalid type with 400 field errors', async () => {
    const noFile = await upload(claimId, { type: 'other' });
    expect(noFile.statusCode).toBe(400);
    expect(noFile.json()).toMatchObject({ fields: { file: 'required' } });
    const badType = await upload(claimId, { type: 'selfie' }, pdf);
    expect(badType.statusCode).toBe(400);
    expect(badType.json<{ fields: Record<string, string> }>().fields.type).toMatch(/^must be one of/);
    const json = await app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/documents`, headers: auth, payload: {} });
    expect(json.statusCode).toBe(400);
  });

  it('404s uploads and listings for unknown claims', async () => {
    expect((await upload('CLM-9999', { type: 'other' }, pdf)).statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/v1/claims/CLM-9999/documents', headers: auth });
    expect(list.statusCode).toBe(404);
  });
});

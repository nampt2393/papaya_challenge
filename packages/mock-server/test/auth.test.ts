import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('POST /api/v1/auth/token', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ chaos: false, apiKeys: ['pk_test_dev_123'] });
  });
  afterEach(async () => {
    await app.close();
  });

  it('issues a token for a known key', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: { apiKey: 'pk_test_dev_123' } });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ accessToken: string; tokenType: string; expiresIn: number }>();
    expect(body).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600 });
    expect(body.accessToken.split('.')).toHaveLength(3);
  });

  it('rejects an unknown key with 401 INVALID_API_KEY', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: { apiKey: 'pk_test_nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'INVALID_API_KEY' });
  });

  it('rejects a missing apiKey with 400 field errors', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR', fields: { apiKey: 'required' } });
  });

  it('answers malformed JSON with a 400 in the API error format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('sets x-request-id on responses, including unknown routes', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: {} });
    const second = await app.inject({ method: 'GET', url: '/nope' });
    expect(first.headers['x-request-id']).toMatch(/^req-\d+$/);
    expect(second.headers['x-request-id']).not.toBe(first.headers['x-request-id']);
    expect(second.statusCode).toBe(404);
    expect(second.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});

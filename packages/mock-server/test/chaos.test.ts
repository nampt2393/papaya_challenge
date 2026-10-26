import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

const tokenRequest = { method: 'POST' as const, url: '/api/v1/auth/token', payload: { apiKey: 'pk_test_dev_123' } };

describe('chaos', () => {
  it('returns 503 SERVICE_UNAVAILABLE when failureRate is 1', async () => {
    const app = await buildServer({ chaos: true, failureRate: 1, delayMinMs: 0, delayMaxMs: 0 });
    const res = await app.inject(tokenRequest);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' });
    await app.close();
  });

  it('never applies chaos to /__mock routes', async () => {
    const app = await buildServer({ chaos: true, failureRate: 1, delayMinMs: 0, delayMaxMs: 0 });
    app.get('/__mock/ping', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/__mock/ping' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('delays /api/v1 responses within the configured range', async () => {
    const app = await buildServer({ chaos: true, failureRate: 0, delayMinMs: 50, delayMaxMs: 60 });
    const started = Date.now();
    await app.inject(tokenRequest);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    await app.close();
  });

  it('is deterministic with a seed', async () => {
    const statuses = async () => {
      const app = await buildServer({ chaos: true, failureRate: 0.5, delayMinMs: 0, delayMaxMs: 0, seed: 42 });
      const result: number[] = [];
      for (let i = 0; i < 20; i++) result.push((await app.inject(tokenRequest)).statusCode);
      await app.close();
      return result;
    };
    const first = await statuses();
    expect(first).toEqual(await statuses());
    expect(first).toContain(503);
    expect(first).toContain(200);
  });

  it('is off when chaos is false', async () => {
    const app = await buildServer({ chaos: false, failureRate: 1 });
    expect((await app.inject(tokenRequest)).statusCode).toBe(200);
    await app.close();
  });
});

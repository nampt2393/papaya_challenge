import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  ApiError,
  AuthError,
  type ClaimStatus,
  type CreateClaimInput,
  InsuranceSDK,
  NodeTransport,
  type Transport,
  ValidationError,
} from '@insurance/partner-sdk';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../packages/mock-server/src/server';
import type { MockConfig } from '../../packages/mock-server/src/config';

const samplePdf = fileURLToPath(new URL('../../examples/fixtures/sample-receipt.pdf', import.meta.url));

const input: CreateClaimInput = {
  policyId: 'POL-123',
  claimType: 'OUTPATIENT',
  diagnosisCode: 'J06.9',
  treatmentDate: '2024-03-15',
  amount: 15000,
  currency: 'THB',
};

async function start(overrides: Partial<MockConfig>): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = await buildServer({ apiKeys: ['pk_test_e2e'], ...overrides });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, baseUrl: address };
}

/** Wraps the real transport to count token requests. */
function countingTransport(): Transport & { tokenRequests: () => number } {
  const inner = new NodeTransport();
  let tokens = 0;
  return {
    tokenRequests: () => tokens,
    send(req) {
      if (req.url.endsWith('/auth/token')) tokens += 1;
      return inner.send(req);
    },
  };
}

describe('SDK against the mock server', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let sdk: InsuranceSDK;

  beforeAll(async () => {
    ({ app, baseUrl } = await start({ chaos: false }));
    sdk = new InsuranceSDK({ apiKey: 'pk_test_e2e', environment: 'sandbox', baseUrl });
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates, fetches and lists a claim', async () => {
    const created = await sdk.claims.create(input);
    expect(created).toMatchObject({ ...input, status: 'SUBMITTED' });
    await expect(sdk.claims.get(created.id)).resolves.toEqual(created);
    const page = await sdk.claims.list({ status: 'SUBMITTED', pageSize: 100 });
    expect(page.data.map((c) => c.id)).toContain(created.id);
  });

  it('rejects an unknown API key with AuthError INVALID_API_KEY', async () => {
    const wrong = new InsuranceSDK({ apiKey: 'pk_test_wrong', environment: 'sandbox', baseUrl });
    const error = await wrong.claims.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: 'INVALID_API_KEY' });
  });

  it('get of an unknown claim throws ApiError NOT_FOUND with requestId', async () => {
    const error = await sdk.claims.get('CLM-9999').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: expect.stringMatching(/^req-\d+$/) });
  });

  it('uploads a real file from disk with progress reaching 100', async () => {
    const { id } = await sdk.claims.create(input);
    const progress: number[] = [];
    const document = await sdk.documents.upload(id, samplePdf, { type: 'medical_receipt', onProgress: (p) => progress.push(p) });
    expect(document).toMatchObject({ claimId: id, filename: 'sample-receipt.pdf', contentType: 'application/pdf' });
    expect(progress.at(-1)).toBe(100);
    await expect(sdk.documents.list(id)).resolves.toHaveLength(1);
  });

  it('a stream with a wrong declared size fails with ValidationError and stores nothing', async () => {
    const { id } = await sdk.claims.create(input);
    const pdf = Buffer.from(`%PDF-1.4 ${'x'.repeat(991)}`);
    for (const size of [500, 2000]) {
      const error = await sdk.documents
        .upload(id, Readable.from([pdf]), { type: 'medical_receipt', filename: 'r.pdf', size })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ fields: { size: expect.stringContaining(`declared ${size} bytes`) } });
    }
    await expect(sdk.documents.list(id)).resolves.toHaveLength(0);
  });

  it('onStatusChange observes a transition made through the control endpoint', async () => {
    const { id } = await sdk.claims.create(input);
    const callback = vi.fn<(status: ClaimStatus) => void>();
    const unsubscribe = sdk.claims.onStatusChange(id, callback, { intervalMs: 1000 });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200)); // at least one poll after the baseline
      expect(callback).not.toHaveBeenCalled();
      const res = await fetch(`${baseUrl}/__mock/claims/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'DOCUMENTS_VERIFIED' }),
      });
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(callback).toHaveBeenCalledWith('DOCUMENTS_VERIFIED', expect.objectContaining({ id })), {
        timeout: 3000,
      });
    } finally {
      unsubscribe();
    }
  });
});

describe('SDK resilience against the mock server', () => {
  it('recovers from seeded transient 503s via retries', async () => {
    const { app, baseUrl } = await start({ chaos: true, failureRate: 0.5, seed: 7, delayMinMs: 0, delayMaxMs: 0 });
    try {
      const sdk = new InsuranceSDK({ apiKey: 'pk_test_e2e', environment: 'sandbox', baseUrl, maxRetries: 5 });
      const { id } = await sdk.claims.create(input);
      for (let i = 0; i < 10; i++) await expect(sdk.claims.get(id)).resolves.toMatchObject({ id });
    } finally {
      await app.close();
    }
  }, 30_000);

  it('refreshes an expired token transparently', async () => {
    let now = Date.now();
    const { app, baseUrl } = await start({ chaos: false, jwtTtlSec: 61, now: () => now });
    try {
      const transport = countingTransport();
      const sdk = new InsuranceSDK({ apiKey: 'pk_test_e2e', environment: 'sandbox', baseUrl, transport });
      await sdk.claims.list();
      now += 62_000; // the server now considers the cached token expired
      await expect(sdk.claims.list()).resolves.toMatchObject({ page: 1 });
      expect(transport.tokenRequests()).toBe(2);
    } finally {
      await app.close();
    }
  });
});

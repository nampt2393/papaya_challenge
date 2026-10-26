import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ApiError, AuthError, NetworkError, ValidationError } from '../src/errors';
import { HttpClient } from '../src/http/HttpClient';
import { buildMultipart } from '../src/http/multipart';
import { RetryPolicy } from '../src/http/RetryPolicy';
import type { TransportRequest } from '../src/http/Transport';
import { fakeTransport, isTokenRequest, json, withTokenEndpoint, type FakeReply } from './helpers/fakeTransport';

function setup(handler: (req: TransportRequest, apiCallIndex: number) => FakeReply | Promise<FakeReply>, maxRetries = 3) {
  const transport = fakeTransport(withTokenEndpoint(handler));
  const client = new HttpClient({
    baseUrl: 'http://api.test',
    apiKey: 'pk_test_dev_123',
    timeoutMs: 1000,
    transport,
    retry: new RetryPolicy({ maxRetries, random: () => 0 }),
    sleep: async () => {},
  });
  return {
    client,
    transport,
    apiCalls: () => transport.calls.filter((c) => !isTokenRequest(c)).length,
    tokenCalls: () => transport.calls.filter(isTokenRequest).length,
  };
}

describe('HttpClient', () => {
  it('fetches a token once and sends it as Bearer', async () => {
    const { client, transport, tokenCalls } = setup(() => json(200, { ok: true }));
    await client.request({ method: 'GET', path: '/claims' });
    await client.request({ method: 'GET', path: '/claims' });
    expect(tokenCalls()).toBe(1);
    const tokenRequest = transport.calls[0]!;
    expect(tokenRequest).toMatchObject({ method: 'POST', body: JSON.stringify({ apiKey: 'pk_test_dev_123' }) });
    expect(tokenRequest.headers.authorization).toBeUndefined();
    expect(transport.calls[1]!.headers.authorization).toBe('Bearer tok-1');
  });

  it('builds URL with query and skips undefined params', async () => {
    const { client, transport } = setup(() => json(200, {}));
    await client.request({ method: 'GET', path: '/claims', query: { status: 'APPROVED', page: 2, pageSize: undefined } });
    expect(transport.calls[1]!.url).toBe('http://api.test/api/v1/claims?status=APPROVED&page=2');
  });

  it('sends JSON bodies with a content-type header', async () => {
    const { client, transport } = setup(() => json(201, {}));
    await client.request({ method: 'POST', path: '/claims', json: { a: 1 } });
    expect(transport.calls[1]).toMatchObject({ body: '{"a":1}', headers: { 'content-type': 'application/json' } });
  });

  it('retries 503 → 503 → 200 and succeeds', async () => {
    const { client, apiCalls } = setup((_req, i) => (i < 2 ? json(503, { code: 'SERVICE_UNAVAILABLE' }) : json(200, { id: 'CLM-0001' })));
    await expect(client.request({ method: 'GET', path: '/claims/CLM-0001' })).resolves.toEqual({ id: 'CLM-0001' });
    expect(apiCalls()).toBe(3);
  });

  it('throws ApiError 503 after retries are exhausted', async () => {
    const { client, apiCalls } = setup(() => json(503, { code: 'SERVICE_UNAVAILABLE', message: 'down' }));
    const error = await client.request({ method: 'GET', path: '/claims' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(apiCalls()).toBe(4);
  });

  it('retries a network error then succeeds', async () => {
    const { client, apiCalls } = setup((_req, i) => (i === 0 ? new NetworkError('reset') : json(200, { ok: true })));
    await expect(client.request({ method: 'GET', path: '/claims' })).resolves.toEqual({ ok: true });
    expect(apiCalls()).toBe(2);
  });

  it('throws NetworkError when the network keeps failing', async () => {
    const { client, apiCalls } = setup(() => new NetworkError('down'));
    await expect(client.request({ method: 'GET', path: '/claims' })).rejects.toBeInstanceOf(NetworkError);
    expect(apiCalls()).toBe(4);
  });

  it('on 401 refreshes once and retries without using a retry attempt', async () => {
    const { client, tokenCalls, transport } = setup(
      (_req, i) => (i === 0 ? json(401, { code: 'TOKEN_EXPIRED' }) : json(200, { ok: true })),
      0,
    );
    await expect(client.request({ method: 'GET', path: '/claims' })).resolves.toEqual({ ok: true });
    expect(tokenCalls()).toBe(2);
    expect(transport.calls.at(-1)!.headers.authorization).toBe('Bearer tok-2');
  });

  it('throws AuthError when the retried request is also 401', async () => {
    const { client, tokenCalls } = setup(() => json(401, { code: 'TOKEN_EXPIRED', message: 'expired' }));
    const error = await client.request({ method: 'GET', path: '/claims' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(tokenCalls()).toBe(2);
  });

  it('maps an invalid API key on the token endpoint to AuthError INVALID_API_KEY', async () => {
    const transport = fakeTransport(() => json(401, { code: 'INVALID_API_KEY', message: 'Unknown API key' }));
    const client = new HttpClient({
      baseUrl: 'http://api.test',
      apiKey: 'pk_test_wrong',
      timeoutMs: 1000,
      transport,
      retry: new RetryPolicy(),
      sleep: async () => {},
    });
    const error = await client.request({ method: 'GET', path: '/claims' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: 'INVALID_API_KEY' });
    expect(transport.calls).toHaveLength(1);
  });

  it('maps 400 to ValidationError with server fields and requestId', async () => {
    const { client } = setup(() =>
      json(400, { code: 'VALIDATION_ERROR', message: 'Invalid', fields: { amount: 'must be positive' } }, { 'x-request-id': 'req-1' }),
    );
    const error = await client.request({ method: 'POST', path: '/claims', json: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ fields: { amount: 'must be positive' }, requestId: 'req-1' });
  });

  it.each([
    [404, 'NOT_FOUND'],
    [409, 'INVALID_TRANSITION'],
  ])('maps %i to ApiError %s', async (status, code) => {
    const { client, apiCalls } = setup(() => json(status, { code, message: 'nope' }));
    const error = await client.request({ method: 'GET', path: '/claims/x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code, message: 'nope' });
    expect(apiCalls()).toBe(1);
  });

  it('maps a non-JSON 502 body to ApiError HTTP_502', async () => {
    const { client } = setup(() => ({ status: 502, headers: { 'content-type': 'text/html' }, body: '<h1>Bad Gateway</h1>' }));
    const error = await client.request({ method: 'GET', path: '/claims' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'HTTP_502', message: 'Request failed with status 502', body: '<h1>Bad Gateway</h1>' });
  });

  it('does not retry a non-replayable multipart body', async () => {
    const { client, apiCalls } = setup(() => json(503, { code: 'SERVICE_UNAVAILABLE' }));
    const multipart = buildMultipart(
      { type: 'other' },
      { fieldName: 'file', filename: 'a.pdf', contentType: 'application/pdf', size: 1, open: () => Readable.from([Buffer.from('x')]) },
      false,
    );
    await expect(client.request({ method: 'POST', path: '/claims/CLM-1/documents', multipart })).rejects.toMatchObject({ status: 503 });
    expect(apiCalls()).toBe(1);
  });

  it('3 concurrent requests that all get 401 cause exactly 1 refresh', async () => {
    const { client, tokenCalls } = setup((_req, i) => (i < 3 ? json(401, { code: 'TOKEN_EXPIRED' }) : json(200, { ok: true })));
    const results = await Promise.all([1, 2, 3].map(() => client.request({ method: 'GET', path: '/claims' })));
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(tokenCalls()).toBe(2);
  });

  describe('non-idempotent POST and network errors', () => {
    it('does not retry a POST whose request may have reached the server', async () => {
      const { client, apiCalls } = setup(() => new NetworkError('timed out', { code: 'TIMEOUT', requestSent: true }));
      await expect(client.request({ method: 'POST', path: '/claims', json: {} })).rejects.toMatchObject({ code: 'TIMEOUT' });
      expect(apiCalls()).toBe(1);
    });

    it('retries a POST when the connection was never established', async () => {
      const { client, apiCalls } = setup((_req, i) => (i === 0 ? new NetworkError('refused') : json(201, { id: 'CLM-0001' })));
      await expect(client.request({ method: 'POST', path: '/claims', json: {} })).resolves.toEqual({ id: 'CLM-0001' });
      expect(apiCalls()).toBe(2);
    });

    it('still retries a GET after the request was sent', async () => {
      const { client, apiCalls } = setup((_req, i) =>
        i === 0 ? new NetworkError('reset', { requestSent: true }) : json(200, { ok: true }),
      );
      await expect(client.request({ method: 'GET', path: '/claims' })).resolves.toEqual({ ok: true });
      expect(apiCalls()).toBe(2);
    });

    it('still retries the token request after it was sent', async () => {
      let tokenAttempts = 0;
      const transport = fakeTransport((req) => {
        if (isTokenRequest(req) && tokenAttempts++ === 0) return new NetworkError('reset', { requestSent: true });
        return isTokenRequest(req) ? json(200, { accessToken: 'tok', expiresIn: 3600 }) : json(200, { ok: true });
      });
      const client = new HttpClient({
        baseUrl: 'http://api.test',
        apiKey: 'pk_test_1',
        timeoutMs: 1000,
        transport,
        retry: new RetryPolicy(),
        sleep: async () => {},
      });
      await expect(client.request({ method: 'GET', path: '/claims' })).resolves.toEqual({ ok: true });
      expect(tokenAttempts).toBe(2);
    });
  });
});

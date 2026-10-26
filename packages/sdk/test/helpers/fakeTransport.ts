import type { Transport, TransportRequest, TransportResponse } from '../../src/http/Transport';

export type FakeReply = TransportResponse | Error;

/** A Transport that records every request and answers with `handler`. Errors are thrown. */
export function fakeTransport(
  handler: (req: TransportRequest, callIndex: number) => FakeReply | Promise<FakeReply>,
): Transport & { calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  return {
    calls,
    async send(req) {
      calls.push(req);
      await Promise.resolve();
      const reply = await handler(req, calls.length - 1);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

export function json(status: number, body?: unknown, headers: Record<string, string> = {}): TransportResponse {
  return { status, headers: { 'content-type': 'application/json', ...headers }, body };
}

export function isTokenRequest(req: TransportRequest): boolean {
  return req.url.endsWith('/api/v1/auth/token');
}

/** Answers token requests with `tok-1`, `tok-2`, …; forwards every other request with its own 0-based index. */
export function withTokenEndpoint(
  handler: (req: TransportRequest, apiCallIndex: number) => FakeReply | Promise<FakeReply>,
): (req: TransportRequest) => Promise<FakeReply> {
  let tokens = 0;
  let apiCalls = 0;
  return async (req) => {
    if (isTokenRequest(req)) {
      tokens += 1;
      return json(200, { accessToken: `tok-${tokens}`, tokenType: 'Bearer', expiresIn: 3600 });
    }
    return handler(req, apiCalls++);
  };
}

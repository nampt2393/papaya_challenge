import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMultipart } from '../src/http/multipart';
import { NodeTransport } from '../src/http/Transport';

let server: Server;
let base: string;
const transport = new NodeTransport();

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/early') {
      res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
      res.end('{"code":"NOT_FOUND"}');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      switch (req.url) {
        case '/json':
          res.writeHead(201, { 'content-type': 'application/json', 'x-request-id': 'req-1' });
          res.end(JSON.stringify({ method: req.method, headers: req.headers, body: raw.toString() }));
          return;
        case '/html':
          res.writeHead(502, { 'content-type': 'text/html' });
          res.end('<h1>Bad Gateway</h1>');
          return;
        case '/bad-json':
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end('{not json');
          return;
        case '/empty':
          res.writeHead(500);
          res.end();
          return;
        case '/hang':
          return;
        case '/early':
          return;
        case '/upload':
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ length: raw.length, contentType: req.headers['content-type'], raw: raw.toString('latin1') }));
          return;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('NodeTransport', () => {
  it('sends JSON and parses JSON responses with lowercased headers', async () => {
    const res = await transport.send({
      method: 'POST',
      url: `${base}/json`,
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
      timeoutMs: 1000,
    });
    expect(res.status).toBe(201);
    expect(res.headers['x-request-id']).toBe('req-1');
    expect(res.body).toMatchObject({ method: 'POST', body: '{"a":1}', headers: { 'content-length': '7' } });
  });

  it('returns non-JSON bodies as raw strings without throwing', async () => {
    const res = await transport.send({ method: 'GET', url: `${base}/html`, headers: {}, timeoutMs: 1000 });
    expect(res).toMatchObject({ status: 502, body: '<h1>Bad Gateway</h1>' });
  });

  it('returns malformed JSON as a raw string', async () => {
    const res = await transport.send({ method: 'GET', url: `${base}/bad-json`, headers: {}, timeoutMs: 1000 });
    expect(res).toMatchObject({ status: 500, body: '{not json' });
  });

  it('returns undefined body for empty responses', async () => {
    const res = await transport.send({ method: 'GET', url: `${base}/empty`, headers: {}, timeoutMs: 1000 });
    expect(res.status).toBe(500);
    expect(res.body).toBeUndefined();
  });

  it('maps connection refused to retryable NetworkError', async () => {
    await expect(transport.send({ method: 'GET', url: 'http://127.0.0.1:1', headers: {}, timeoutMs: 1000 })).rejects.toMatchObject({
      name: 'NetworkError',
      code: 'NETWORK_ERROR',
      retryable: true,
      requestSent: false,
    });
  });

  it('times out with NetworkError TIMEOUT', async () => {
    await expect(transport.send({ method: 'GET', url: `${base}/hang`, headers: {}, timeoutMs: 100 })).rejects.toMatchObject({
      name: 'NetworkError',
      code: 'TIMEOUT',
      requestSent: true,
    });
  });

  it('streams multipart with exact content-length and progress ending at total', async () => {
    const data = Buffer.alloc(200_000, 7);
    const body = buildMultipart(
      { type: 'medical_receipt' },
      { fieldName: 'file', filename: 'r.pdf', contentType: 'application/pdf', size: data.length, open: () => Readable.from([data]) },
      true,
    );
    const progress: number[] = [];
    const res = await transport.send({
      method: 'POST',
      url: `${base}/upload`,
      headers: {},
      body,
      timeoutMs: 2000,
      onUploadProgress: (sent, total) => {
        expect(total).toBe(body.contentLength);
        progress.push(sent);
      },
    });
    const echoed = res.body as { length: number; contentType: string; raw: string };
    expect(echoed.length).toBe(body.contentLength);
    expect(echoed.contentType).toBe(`multipart/form-data; boundary=${body.boundary}`);
    expect(echoed.raw).toContain('name="type"\r\n\r\nmedical_receipt');
    expect(echoed.raw).toContain('name="file"; filename="r.pdf"\r\nContent-Type: application/pdf');
    expect(echoed.raw.endsWith(`--${body.boundary}--\r\n`)).toBe(true);
    expect(progress.at(-1)).toBe(body.contentLength);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('destroys the upload source when the server answers before reading the body', async () => {
    const size = 50 * 1024 * 1024;
    let source: Readable | undefined;
    const body = buildMultipart(
      { type: 'other' },
      {
        fieldName: 'file',
        filename: 'big.pdf',
        contentType: 'application/pdf',
        size,
        open: () => {
          let sent = 0;
          source = new Readable({
            read() {
              if (sent >= size) return this.push(null);
              sent += 64 * 1024;
              this.push(Buffer.alloc(64 * 1024));
            },
          });
          return source;
        },
      },
      true,
    );
    const res = await transport.send({ method: 'POST', url: `${base}/early`, headers: {}, body, timeoutMs: 2000 });
    expect(res.status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(source?.destroyed).toBe(true);
  });

  it('rejects a stream shorter than its declared size with ValidationError instead of timing out', async () => {
    const body = buildMultipart(
      { type: 'other' },
      { fieldName: 'file', filename: 'r.pdf', contentType: 'application/pdf', size: 2000, open: () => Readable.from([Buffer.alloc(1000)]) },
      false,
    );
    const started = Date.now();
    await expect(transport.send({ method: 'POST', url: `${base}/upload`, headers: {}, body, timeoutMs: 2000 })).rejects.toMatchObject({
      name: 'ValidationError',
      fields: { size: 'declared 2000 bytes, but the stream provided 1000' },
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

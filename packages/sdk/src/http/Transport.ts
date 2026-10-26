import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { type Readable, Transform } from 'node:stream';
import { NetworkError } from '../errors';
import type { MultipartBody } from './multipart';

export type HttpMethod = 'GET' | 'POST' | 'PATCH';

export interface TransportRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string | MultipartBody;
  /** Covers the whole exchange: connect, upload and download. */
  timeoutMs: number;
  onUploadProgress?: (sentBytes: number, totalBytes: number) => void;
}

export interface TransportResponse {
  status: number;
  /** Lowercased header names. */
  headers: Record<string, string>;
  /** Parsed JSON, the raw text when it is not JSON, or `undefined` when empty. */
  body: unknown;
}

/**
 * Sends one HTTP request. Resolves for every HTTP status; rejects only with
 * `NetworkError` when no response arrives. Implement it to customise networking or for tests.
 */
export interface Transport {
  send(req: TransportRequest): Promise<TransportResponse>;
}

function parseBody(text: string, contentType: string | undefined): unknown {
  if (text.length === 0) return undefined;
  if (contentType?.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function normaliseHeaders(res: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.headers)) {
    if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

/** Default transport built on `node:http` / `node:https`. */
export class NodeTransport implements Transport {
  send(req: TransportRequest): Promise<TransportResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(req.url);
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const headers: Record<string, string> = { ...req.headers };
      const body = req.body;
      if (typeof body === 'string') {
        headers['content-length'] = String(Buffer.byteLength(body));
      } else if (body) {
        headers['content-type'] = `multipart/form-data; boundary=${body.boundary}`;
        headers['content-length'] = String(body.contentLength);
      }

      let settled = false;
      let responded = false;
      // The multipart source (lazy until piped); destroyed once the exchange is over so file handles never leak.
      const source: Readable | undefined = body !== undefined && typeof body !== 'string' ? body.createStream() : undefined;
      const stopUpload = () => {
        if (source && !source.destroyed) source.destroy();
      };
      const fail = (error: NetworkError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stopUpload();
        reject(error);
      };

      const clientRequest = request(url, { method: req.method, headers }, (res) => {
        // The server answered (possibly before reading the whole body): stop uploading.
        responded = true;
        stopUpload();
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', (error) => fail(new NetworkError(`Network request failed: ${error.message}`, { cause: error })));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const responseHeaders = normaliseHeaders(res);
          resolve({
            status: res.statusCode ?? 0,
            headers: responseHeaders,
            body: parseBody(Buffer.concat(chunks).toString('utf8'), responseHeaders['content-type']),
          });
        });
      });

      const timer = setTimeout(() => {
        fail(new NetworkError(`Request timed out after ${req.timeoutMs}ms`, { code: 'TIMEOUT' }));
        clientRequest.destroy();
      }, req.timeoutMs);

      clientRequest.on('error', (error) => {
        // After an early response, write errors (EPIPE, ECONNRESET) are expected: the response wins.
        if (responded) return;
        fail(new NetworkError(`Network request failed: ${error.message}`, { cause: error }));
      });

      if (source === undefined || body === undefined || typeof body === 'string') {
        clientRequest.end(body);
        return;
      }

      let sent = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sent += chunk.length;
          req.onUploadProgress?.(sent, body.contentLength);
          callback(null, chunk);
        },
      });
      source.on('error', (error) => {
        fail(new NetworkError(`Failed to read upload body: ${error.message}`, { cause: error, retryable: false }));
        clientRequest.destroy();
      });
      source.pipe(counter).pipe(clientRequest);
    });
  }
}

import { NetworkError, SDKError } from '../errors';
import { AuthManager, type TokenResponse } from './AuthManager';
import { invalidResponseError, mapResponseError } from './mapResponseError';
import type { MultipartBody } from './multipart';
import type { RetryPolicy } from './RetryPolicy';
import type { HttpMethod, Transport, TransportRequest, TransportResponse } from './Transport';

export interface RequestOptions {
  method: HttpMethod;
  /** Relative to `/api/v1`, e.g. `/claims`. */
  path: string;
  /** `undefined` values are omitted. */
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  multipart?: MultipartBody;
  onUploadProgress?: (sentBytes: number, totalBytes: number) => void;
  /** Attach a bearer token. Default true. */
  auth?: boolean;
  /**
   * Safe to repeat after the server may have processed it. Default: every method except POST.
   * Non-idempotent requests are retried after a network error only if the connection was never made.
   */
  idempotent?: boolean;
}

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  transport: Transport;
  retry: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends API requests with authentication, retries and typed errors. */
export class HttpClient {
  private readonly options: HttpClientOptions;
  private readonly auth: AuthManager;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HttpClientOptions) {
    this.options = options;
    this.sleep = options.sleep ?? defaultSleep;
    this.auth = new AuthManager({
      fetchToken: () =>
        this.request<TokenResponse>({
          method: 'POST',
          path: '/auth/token',
          json: { apiKey: options.apiKey },
          auth: false,
          idempotent: true,
        }),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const { retry, transport } = this.options;
    const replayable = options.multipart?.replayable ?? true;
    const idempotent = options.idempotent ?? options.method !== 'POST';
    let attempt = 0;
    let reauthenticated = false;

    for (;;) {
      // A stream upload cannot re-authenticate after a 401, so it starts with a newly issued token.
      const token = options.auth === false ? undefined : await this.auth.getToken({ forceRefresh: !replayable });
      let res: TransportResponse;
      try {
        res = await transport.send(this.buildRequest(options, token));
      } catch (error) {
        const mayHaveBeenProcessed = error instanceof NetworkError && error.requestSent && !idempotent;
        if (replayable && !mayHaveBeenProcessed && retry.shouldRetry(error, attempt)) {
          await this.sleep(retry.delayFor(attempt++));
          continue;
        }
        throw error instanceof SDKError ? error : new NetworkError('Network request failed', { cause: error });
      }

      if (res.status >= 200 && res.status < 300) {
        if (typeof res.body === 'object' && res.body !== null) return res.body as T;
        throw invalidResponseError(res);
      }

      // One re-authentication per request, not counted as a retry.
      if (res.status === 401 && token !== undefined && !reauthenticated && replayable) {
        reauthenticated = true;
        this.auth.invalidate(token);
        continue;
      }
      if (replayable && retry.shouldRetry(res.status, attempt)) {
        await this.sleep(retry.delayFor(attempt++));
        continue;
      }
      throw mapResponseError(res);
    }
  }

  private buildRequest(options: RequestOptions, token: string | undefined): TransportRequest {
    const url = new URL(`${this.options.baseUrl}/api/v1${options.path}`);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const headers: Record<string, string> = { accept: 'application/json' };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;

    const request: TransportRequest = { method: options.method, url: url.toString(), headers, timeoutMs: this.options.timeoutMs };
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      request.body = JSON.stringify(options.json);
    } else if (options.multipart) {
      request.body = options.multipart;
    }
    if (options.onUploadProgress) request.onUploadProgress = options.onUploadProgress;
    return request;
  }
}

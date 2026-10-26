/** Base class for every error thrown by the SDK. */
export class SDKError extends Error {
  readonly code: string;
  readonly requestId?: string;

  constructor(message: string, options: { code: string; requestId?: string | undefined; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Input failed validation, client-side or server-side (HTTP 400). */
export class ValidationError extends SDKError {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>, options: { message?: string; requestId?: string | undefined } = {}) {
    super(options.message ?? `Validation failed: ${Object.keys(fields).join(', ')}`, {
      code: 'VALIDATION_ERROR',
      requestId: options.requestId,
    });
    this.fields = fields;
  }
}

export type AuthErrorCode = 'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'INVALID_API_KEY';

/** Authentication failed: invalid API key, or the token was rejected even after a refresh. */
export class AuthError extends SDKError {
  declare readonly code: AuthErrorCode;

  constructor(message: string, options: { code?: AuthErrorCode; requestId?: string | undefined } = {}) {
    super(message, { code: options.code ?? 'UNAUTHORIZED', requestId: options.requestId });
  }
}

export type NetworkErrorCode = 'NETWORK_ERROR' | 'TIMEOUT';

/** The request never got an HTTP response (connection failure or timeout). */
export class NetworkError extends SDKError {
  declare readonly code: NetworkErrorCode;
  readonly retryable: boolean;
  /**
   * `true` when the connection was established, so the server may have received and processed
   * the request. The SDK does not retry claim creation or uploads in that case, to avoid duplicates.
   */
  readonly requestSent: boolean;

  constructor(
    message: string,
    options: { code?: NetworkErrorCode; cause?: unknown; retryable?: boolean; requestSent?: boolean } = {},
  ) {
    super(message, { code: options.code ?? 'NETWORK_ERROR', cause: options.cause });
    this.retryable = options.retryable ?? true;
    this.requestSent = options.requestSent ?? false;
  }
}

/** The API returned an error response not covered by the other error types. */
export class ApiError extends SDKError {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, options: { status: number; code: string; body?: unknown; requestId?: string | undefined }) {
    super(message, { code: options.code, requestId: options.requestId });
    this.status = options.status;
    if (options.body !== undefined) this.body = options.body;
  }
}

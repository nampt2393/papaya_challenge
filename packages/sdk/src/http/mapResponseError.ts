import { ApiError, AuthError, type AuthErrorCode, type SDKError, ValidationError } from '../errors';
import type { TransportResponse } from './Transport';

const AUTH_CODES: readonly string[] = ['UNAUTHORIZED', 'TOKEN_EXPIRED', 'INVALID_API_KEY'] satisfies AuthErrorCode[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringFields(value: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [name, message] of Object.entries(value)) {
      if (typeof message === 'string') fields[name] = message;
    }
  }
  return fields;
}

/**
 * For a 2xx response whose body is not parsed JSON, e.g. a website or proxy page answering instead of the API.
 * Never retried: the server answered, and may have acted on the request.
 */
export function invalidResponseError(res: TransportResponse, description?: string): ApiError {
  const contentType = res.headers['content-type']?.split(';')[0]?.trim();
  const got =
    description ??
    (res.body === undefined
      ? 'an empty body'
      : typeof res.body !== 'string'
        ? 'a JSON value that is not an object or array'
        : contentType?.includes('json')
          ? 'malformed JSON'
          : (contentType ?? 'a body without a content type'));
  return new ApiError(`Expected a JSON response but got ${got} (status ${res.status})`, {
    status: res.status,
    code: 'INVALID_RESPONSE',
    body: res.body,
    requestId: res.headers['x-request-id'],
  });
}

/** Turns a non-2xx response into the matching typed error. Tolerates non-JSON bodies. */
export function mapResponseError(res: TransportResponse): SDKError {
  const body = isRecord(res.body) ? res.body : undefined;
  const code = typeof body?.code === 'string' ? body.code : `HTTP_${res.status}`;
  const message = typeof body?.message === 'string' ? body.message : `Request failed with status ${res.status}`;
  const requestId = res.headers['x-request-id'];

  if (res.status === 400) {
    return new ValidationError(stringFields(body?.fields), { message, requestId });
  }
  if (res.status === 401 || res.status === 403) {
    return new AuthError(message, { code: AUTH_CODES.includes(code) ? (code as AuthErrorCode) : 'UNAUTHORIZED', requestId });
  }
  return new ApiError(message, { status: res.status, code, body: res.body, requestId });
}

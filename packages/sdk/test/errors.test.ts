import { describe, expect, it } from 'vitest';
import { ApiError, AuthError, NetworkError, SDKError, ValidationError } from '../src/errors';

describe('errors', () => {
  it.each([
    ['ValidationError', () => new ValidationError({ amount: 'must be positive' })],
    ['AuthError', () => new AuthError('nope', { code: 'TOKEN_EXPIRED' })],
    ['NetworkError', () => new NetworkError('down')],
    ['ApiError', () => new ApiError('gone', { status: 404, code: 'NOT_FOUND' })],
  ])('%s is an SDKError and Error with correct name', (name, make) => {
    const error = make();
    expect(error).toBeInstanceOf(SDKError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
  });

  it('ValidationError exposes fields and default message', () => {
    const error = new ValidationError({ policyId: 'required', amount: 'must be positive' });
    expect(error.fields).toEqual({ policyId: 'required', amount: 'must be positive' });
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Validation failed: policyId, amount');
  });

  it('AuthError defaults to UNAUTHORIZED', () => {
    expect(new AuthError('nope').code).toBe('UNAUTHORIZED');
  });

  it('NetworkError defaults to retryable NETWORK_ERROR and keeps cause', () => {
    const cause = new Error('ECONNREFUSED');
    const error = new NetworkError('down', { cause });
    expect(error.retryable).toBe(true);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.cause).toBe(cause);
  });

  it('ApiError keeps status, code, body and requestId', () => {
    const error = new ApiError('conflict', { status: 409, code: 'INVALID_TRANSITION', body: { allowed: [] }, requestId: 'req-7' });
    expect(error).toMatchObject({ status: 409, code: 'INVALID_TRANSITION', body: { allowed: [] }, requestId: 'req-7' });
  });
});

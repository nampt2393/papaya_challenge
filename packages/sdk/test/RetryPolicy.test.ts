import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../src/errors';
import { RetryPolicy } from '../src/http/RetryPolicy';

describe('RetryPolicy', () => {
  const policy = new RetryPolicy({ random: () => 0 });

  it('backs off exponentially and caps at maxDelayMs', () => {
    expect([0, 1, 2, 3, 4, 5].map((attempt) => policy.delayFor(attempt))).toEqual([200, 400, 800, 1600, 3200, 5000]);
  });

  it('adds jitter below baseDelayMs', () => {
    expect(new RetryPolicy({ random: () => 0.999 }).delayFor(0)).toBe(399);
  });

  it('retries 503 and retryable NetworkError', () => {
    expect(policy.shouldRetry(503, 0)).toBe(true);
    expect(policy.shouldRetry(new NetworkError('x'), 0)).toBe(true);
    expect(policy.shouldRetry(new NetworkError('x', { retryable: false }), 0)).toBe(false);
    expect(policy.shouldRetry(new ApiError('x', { status: 503, code: 'X' }), 0)).toBe(false);
  });

  it.each([400, 401, 403, 404, 409, 500, 502])('never retries %i', (status) => {
    expect(policy.shouldRetry(status, 0)).toBe(false);
  });

  it('stops after maxRetries', () => {
    expect(policy.shouldRetry(503, 2)).toBe(true);
    expect(policy.shouldRetry(503, 3)).toBe(false);
    expect(new RetryPolicy({ maxRetries: 0 }).shouldRetry(503, 0)).toBe(false);
  });

  it('defaults to 3 retries', () => {
    expect(new RetryPolicy().maxRetries).toBe(3);
  });
});

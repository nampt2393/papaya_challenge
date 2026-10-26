import { NetworkError } from '../errors';

export interface RetryPolicyOptions {
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number;
  /** Default 200 ms. */
  baseDelayMs?: number;
  /** Default 5000 ms. */
  maxDelayMs?: number;
  /** Source of jitter, `[0, 1)`. Default `Math.random`. */
  random?: () => number;
}

/** Decides whether a failed attempt is retried, and how long to wait first. */
export class RetryPolicy {
  readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.maxDelayMs = options.maxDelayMs ?? 5000;
    this.random = options.random ?? Math.random;
  }

  /**
   * @param failure an HTTP status, or a thrown error
   * @param attempt 0-based index of the attempt that just failed
   */
  shouldRetry(failure: number | unknown, attempt: number): boolean {
    if (attempt >= this.maxRetries) return false;
    if (typeof failure === 'number') return failure === 503;
    return failure instanceof NetworkError && failure.retryable;
  }

  delayFor(attempt: number): number {
    const backoff = Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs);
    return backoff + Math.floor(this.random() * this.baseDelayMs);
  }
}

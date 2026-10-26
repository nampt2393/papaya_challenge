import { ApiError, AuthError, SDKError, ValidationError } from '../errors';
import type { Claim, ClaimStatus } from '../types';
import { isPresent } from '../validation/checks';

/** Stops watching. Safe to call more than once. */
export type Unsubscribe = () => void;

export type StatusChangeCallback = (newStatus: ClaimStatus, claim: Claim) => void;

export interface StatusChangeOptions {
  /** Poll interval in ms. Default 5000, minimum 1000. */
  intervalMs?: number;
  /**
   * Errors that survive the SDK's own retries, and errors thrown by your callback.
   * Polling continues, except after `AuthError` or a 404 `ApiError`.
   */
  onError?: (error: SDKError) => void;
}

const DEFAULT_INTERVAL_MS = 5000;
const MIN_INTERVAL_MS = 1000;

function toSDKError(error: unknown, code: string, message: string): SDKError {
  return error instanceof SDKError ? error : new SDKError(message, { code, cause: error });
}

function isFatal(error: SDKError): boolean {
  return error instanceof AuthError || (error instanceof ApiError && error.status === 404);
}

/** Polls a claim and reports status changes. Requests never overlap. */
export class StatusPoller {
  constructor(private readonly fetchClaim: (id: string) => Promise<Claim>) {}

  subscribe(claimId: string, callback: StatusChangeCallback, options: StatusChangeOptions = {}): Unsubscribe {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const fields: Record<string, string> = {};
    if (!isPresent(claimId)) fields.claimId = 'required';
    if (!Number.isInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS) fields.intervalMs = `must be an integer >= ${MIN_INTERVAL_MS}`;
    if (Object.keys(fields).length > 0) throw new ValidationError(fields);

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastStatus: ClaimStatus | undefined;

    const report = (error: SDKError) => {
      try {
        options.onError?.(error);
      } catch {
        // A throwing error handler must not break polling.
      }
    };

    const schedule = () => {
      if (!stopped) timer = setTimeout(() => void poll(), intervalMs);
    };

    const poll = async () => {
      timer = undefined;
      let claim: Claim;
      try {
        claim = await this.fetchClaim(claimId);
      } catch (error) {
        if (stopped) return;
        const sdkError = toSDKError(error, 'UNKNOWN_ERROR', 'Polling failed');
        report(sdkError);
        if (isFatal(sdkError)) stopped = true;
        schedule();
        return;
      }
      if (stopped) return;

      const previous = lastStatus;
      lastStatus = claim.status;
      if (previous !== undefined && previous !== claim.status) {
        try {
          callback(claim.status, claim);
        } catch (error) {
          report(toSDKError(error, 'CALLBACK_ERROR', 'Status change callback threw'));
        }
      }
      schedule();
    };

    void poll();

    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
  }
}

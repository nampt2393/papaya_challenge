import { ValidationError } from '../errors';
import type { HttpClient } from '../http/HttpClient';
import type { Claim, CreateClaimInput, ListClaimsParams, Page } from '../types';
import { validateClaim } from '../validation/validateClaim';
import { validateListParams } from '../validation/validateListParams';
import { StatusPoller, type StatusChangeCallback, type StatusChangeOptions, type Unsubscribe } from './StatusPoller';

/** Create, fetch and list claims. */
export class ClaimsResource {
  private readonly poller: StatusPoller;

  constructor(private readonly http: HttpClient) {
    this.poller = new StatusPoller((id) => this.get(id));
  }

  /**
   * Submits a new claim. Input is validated first; invalid input throws
   * `ValidationError` without a network call.
   */
  async create(input: CreateClaimInput): Promise<Claim> {
    const result = validateClaim(input);
    if (!result.ok) throw new ValidationError(result.fields);
    return this.http.request<Claim>({ method: 'POST', path: '/claims', json: input });
  }

  /** Fetches a claim with its current status and history. Unknown ids throw `ApiError` (404, `NOT_FOUND`). */
  async get(id: string): Promise<Claim> {
    if (typeof id !== 'string' || id.length === 0) throw new ValidationError({ id: 'required' });
    return this.http.request<Claim>({ method: 'GET', path: `/claims/${encodeURIComponent(id)}` });
  }

  /** Lists claims, newest first, optionally filtered by status. */
  async list(params: ListClaimsParams = {}): Promise<Page<Claim>> {
    const result = validateListParams(params);
    if (!result.ok) throw new ValidationError(result.fields);
    return this.http.request<Page<Claim>>({
      method: 'GET',
      path: '/claims',
      query: { status: params.status, page: params.page, pageSize: params.pageSize },
    });
  }

  /**
   * Polls a claim and calls `callback` whenever its status changes. The first poll only records the
   * current status. Polling keeps the process alive until you call the returned function.
   *
   * @throws ValidationError synchronously for an empty `claimId` or an `intervalMs` below 1000.
   */
  onStatusChange(claimId: string, callback: StatusChangeCallback, options?: StatusChangeOptions): Unsubscribe {
    return this.poller.subscribe(claimId, callback, options);
  }
}

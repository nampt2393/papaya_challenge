import { ValidationError } from '../errors';
import type { HttpClient } from '../http/HttpClient';
import type { Claim, CreateClaimInput, ListClaimsParams, Page } from '../types';
import { validateClaim } from '../validation/validateClaim';
import { validateListParams } from '../validation/validateListParams';

/** Create, fetch and list claims. */
export class ClaimsResource {
  constructor(protected readonly http: HttpClient) {}

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
}

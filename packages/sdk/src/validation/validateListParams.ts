import type { ValidationResult } from '../types';
import { toResult } from './checks';
import { CLAIM_STATUSES, MAX_PAGE_SIZE } from './rules';

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Validates list filters. Shared with the mock server, which converts query strings to numbers first. */
export function validateListParams(params: { page?: unknown; pageSize?: unknown; status?: unknown }): ValidationResult {
  const { page, pageSize, status } = params;
  return toResult({
    page: page === undefined || isIntegerInRange(page, 1, Number.MAX_SAFE_INTEGER) ? undefined : 'must be an integer >= 1',
    pageSize:
      pageSize === undefined || isIntegerInRange(pageSize, 1, MAX_PAGE_SIZE) ? undefined : `must be an integer between 1 and ${MAX_PAGE_SIZE}`,
    status:
      status === undefined || (CLAIM_STATUSES as readonly unknown[]).includes(status)
        ? undefined
        : `must be one of ${CLAIM_STATUSES.join(', ')}`,
  });
}

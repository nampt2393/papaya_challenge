import { describe, expect, it } from 'vitest';
import { CLAIM_STATUSES, CLAIM_TRANSITIONS, TERMINAL_STATUSES } from '../src/validation/rules';

describe('rules', () => {
  it('CLAIM_TRANSITIONS matches the lifecycle graph', () => {
    expect(CLAIM_TRANSITIONS).toEqual({
      SUBMITTED: ['DOCUMENTS_VERIFIED'],
      DOCUMENTS_VERIFIED: ['UNDER_ASSESSMENT'],
      UNDER_ASSESSMENT: ['PENDING_INFO', 'APPROVED', 'REJECTED'],
      PENDING_INFO: ['DOCUMENTS_VERIFIED'],
      APPROVED: ['PAYMENT_INITIATED'],
      PAYMENT_INITIATED: ['CLOSED'],
      REJECTED: ['CLOSED'],
      CLOSED: [],
    });
    expect(TERMINAL_STATUSES).toEqual(['CLOSED']);
  });

  it('every status has a transition entry', () => {
    expect(Object.keys(CLAIM_TRANSITIONS).sort()).toEqual([...CLAIM_STATUSES].sort());
  });
});

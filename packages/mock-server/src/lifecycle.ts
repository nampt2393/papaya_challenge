import { CLAIM_TRANSITIONS, type ClaimStatus } from '@insurance/partner-sdk';

export function allowedNext(from: ClaimStatus): readonly ClaimStatus[] {
  return CLAIM_TRANSITIONS[from];
}

export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return allowedNext(from).includes(to);
}

import type { Claim, ClaimDocument } from '@insurance/partner-sdk';

/** In-memory data. Everything is lost on restart. */
export class Store {
  readonly claims = new Map<string, Claim>();
  readonly documents = new Map<string, ClaimDocument[]>();
  private claimCounter = 0;
  private documentCounter = 0;

  nextClaimId(): string {
    return `CLM-${String(++this.claimCounter).padStart(4, '0')}`;
  }

  nextDocumentId(): string {
    return `DOC-${String(++this.documentCounter).padStart(4, '0')}`;
  }

  reset(): void {
    this.claims.clear();
    this.documents.clear();
    this.claimCounter = 0;
    this.documentCounter = 0;
  }
}

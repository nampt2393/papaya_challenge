/**
 * Validation rules and claim lifecycle shared by the SDK (client-side checks)
 * and the mock server (server-side checks), so both always agree.
 */

export const CLAIM_TYPES = ['OUTPATIENT', 'INPATIENT', 'DENTAL', 'MATERNITY', 'EMERGENCY'] as const;

export const CURRENCIES = ['THB', 'USD', 'VND', 'SGD'] as const;

export const DOCUMENT_TYPES = ['medical_receipt', 'medical_report', 'prescription', 'id_card', 'other'] as const;

export const CLAIM_STATUSES = [
  'SUBMITTED',
  'DOCUMENTS_VERIFIED',
  'UNDER_ASSESSMENT',
  'PENDING_INFO',
  'APPROVED',
  'REJECTED',
  'PAYMENT_INITIATED',
  'CLOSED',
] as const;

type Status = (typeof CLAIM_STATUSES)[number];

/** Allowed next statuses for each status. */
export const CLAIM_TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  SUBMITTED: ['DOCUMENTS_VERIFIED'],
  DOCUMENTS_VERIFIED: ['UNDER_ASSESSMENT'],
  UNDER_ASSESSMENT: ['PENDING_INFO', 'APPROVED', 'REJECTED'],
  PENDING_INFO: ['DOCUMENTS_VERIFIED'],
  APPROVED: ['PAYMENT_INITIATED'],
  PAYMENT_INITIATED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
};

export const TERMINAL_STATUSES = ['CLOSED'] as const;

export const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/** 10 MB. */
export const MAX_DOCUMENT_BYTES = 10_485_760;

export const MAX_PAGE_SIZE = 100;

export const POLICY_ID_PATTERN = /^POL-\d+$/;

export const ICD10_PATTERN = /^[A-Z]\d{2}(\.\d{1,4})?$/;

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

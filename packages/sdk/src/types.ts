import type { Readable } from 'node:stream';
import type { CLAIM_STATUSES, CLAIM_TYPES, CURRENCIES, DOCUMENT_TYPES } from './validation/rules';

export type ClaimType = (typeof CLAIM_TYPES)[number];
export type Currency = (typeof CURRENCIES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export interface CreateClaimInput {
  policyId: string;
  claimType: ClaimType;
  /** ICD-10 code, e.g. `J06.9`. */
  diagnosisCode: string;
  /** `YYYY-MM-DD`, not in the future. */
  treatmentDate: string;
  /** Positive, at most 2 decimal places. */
  amount: number;
  currency: Currency;
}

export interface StatusHistoryEntry {
  status: ClaimStatus;
  /** ISO 8601 timestamp. */
  at: string;
  note?: string;
}

export interface Claim extends CreateClaimInput {
  /** e.g. `CLM-0001`. */
  id: string;
  status: ClaimStatus;
  statusHistory: StatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ListClaimsParams {
  status?: ClaimStatus | undefined;
  /** 1-based, default 1. */
  page?: number | undefined;
  /** 1–100, default 20. */
  pageSize?: number | undefined;
}

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ClaimDocument {
  id: string;
  claimId: string;
  type: DocumentType;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

/** A file path, a Buffer, or a readable stream. */
export type UploadSource = Buffer | Readable | string;

export interface UploadOptions {
  type: DocumentType;
  /** Required when the source is a Buffer or stream. */
  filename?: string | undefined;
  /** Inferred from the filename extension when omitted. */
  contentType?: string | undefined;
  /** Required when the source is a stream. */
  size?: number | undefined;
  /** Called with integer percentages (0–100), increasing, ending at 100. */
  onProgress?: ((percent: number) => void) | undefined;
}

export type ValidationResult = { ok: true } | { ok: false; fields: Record<string, string> };

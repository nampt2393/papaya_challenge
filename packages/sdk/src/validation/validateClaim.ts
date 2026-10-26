import type { ValidationResult } from '../types';
import { checkOneOf, isPresent, toResult } from './checks';
import { CLAIM_TYPES, CURRENCIES, DATE_PATTERN, ICD10_PATTERN, POLICY_ID_PATTERN } from './rules';

function localDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function checkTreatmentDate(value: unknown, today: Date): string | undefined {
  if (!isPresent(value)) return 'required';
  if (!DATE_PATTERN.test(value) || !isRealCalendarDate(value)) return 'must be YYYY-MM-DD';
  // ISO dates compare correctly as strings.
  if (value > localDateString(today)) return 'must not be in the future';
  return undefined;
}

function checkAmount(value: unknown): string | undefined {
  if (value === undefined || value === null) return 'required';
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'must be positive';
  if (Math.abs(value * 100 - Math.round(value * 100)) >= 1e-9) return 'must have at most 2 decimals';
  return undefined;
}

function checkPattern(value: unknown, pattern: RegExp, message: string): string | undefined {
  if (!isPresent(value)) return 'required';
  if (!pattern.test(value)) return message;
  return undefined;
}

/**
 * Validates a claim before it is sent. Returns one message per invalid field.
 * `today` is compared as a local calendar date, so a claim dated today is accepted.
 */
export function validateClaim(input: unknown, today: Date = new Date()): ValidationResult {
  const claim: Record<string, unknown> = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const checks: Record<string, string | undefined> = {
    policyId: checkPattern(claim.policyId, POLICY_ID_PATTERN, 'must match POL-<digits>'),
    claimType: checkOneOf(claim.claimType, CLAIM_TYPES),
    diagnosisCode: checkPattern(claim.diagnosisCode, ICD10_PATTERN, 'must be a valid ICD-10 code'),
    treatmentDate: checkTreatmentDate(claim.treatmentDate, today),
    amount: checkAmount(claim.amount),
    currency: checkOneOf(claim.currency, CURRENCIES),
  };
  return toResult(checks);
}

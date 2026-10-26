import type { ValidationResult } from '../types';

/** `true` for a non-empty string. */
export function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Returns a message unless `value` is one of `allowed`. */
export function checkOneOf(value: unknown, allowed: readonly string[]): string | undefined {
  if (!isPresent(value)) return 'required';
  if (!allowed.includes(value)) return `must be one of ${allowed.join(', ')}`;
  return undefined;
}

/** Collects the defined messages into a `ValidationResult`. */
export function toResult(checks: Record<string, string | undefined>): ValidationResult {
  const fields: Record<string, string> = {};
  for (const [field, message] of Object.entries(checks)) {
    if (message !== undefined) fields[field] = message;
  }
  return Object.keys(fields).length === 0 ? { ok: true } : { ok: false, fields };
}

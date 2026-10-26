import { describe, expect, it } from 'vitest';
import { validateClaim } from '../src/validation/validateClaim';
import { inferContentType, validateDocument } from '../src/validation/validateDocument';

const valid = {
  policyId: 'POL-123',
  claimType: 'OUTPATIENT',
  diagnosisCode: 'J06.9',
  treatmentDate: '2024-03-15',
  amount: 15000,
  currency: 'THB',
};
const today = new Date(2024, 5, 10); // local 2024-06-10

describe('validateClaim', () => {
  it('accepts a valid claim', () => {
    expect(validateClaim(valid, today)).toEqual({ ok: true });
  });

  it('reports every missing field as required', () => {
    expect(validateClaim({}, today)).toEqual({
      ok: false,
      fields: {
        policyId: 'required',
        claimType: 'required',
        diagnosisCode: 'required',
        treatmentDate: 'required',
        amount: 'required',
        currency: 'required',
      },
    });
  });

  it('treats a non-object input as all fields missing', () => {
    const result = validateClaim(null, today);
    expect(result.ok).toBe(false);
    expect(result.ok === false && Object.keys(result.fields)).toHaveLength(6);
  });

  it.each([
    ['policyId', 'ABC-1', 'must match POL-<digits>'],
    ['policyId', '', 'required'],
    ['claimType', 'SPA', 'must be one of OUTPATIENT, INPATIENT, DENTAL, MATERNITY, EMERGENCY'],
    ['diagnosisCode', 'j06.9', 'must be a valid ICD-10 code'],
    ['treatmentDate', '15/03/2024', 'must be YYYY-MM-DD'],
    ['treatmentDate', '2024-02-30', 'must be YYYY-MM-DD'],
    ['treatmentDate', '2024-06-11', 'must not be in the future'],
    ['amount', -5, 'must be positive'],
    ['amount', 0, 'must be positive'],
    ['amount', 10.005, 'must have at most 2 decimals'],
    ['amount', Number.NaN, 'must be positive'],
    ['amount', '100', 'must be positive'],
    ['currency', 'EUR', 'must be one of THB, USD, VND, SGD'],
  ])('%s=%s → %s', (field, value, message) => {
    expect(validateClaim({ ...valid, [field]: value }, today)).toEqual({ ok: false, fields: { [field]: message } });
  });

  it('accepts treatmentDate equal to today (local date)', () => {
    expect(validateClaim({ ...valid, treatmentDate: '2024-06-10' }, today)).toEqual({ ok: true });
  });

  it('accepts a leap day in a leap year', () => {
    expect(validateClaim({ ...valid, treatmentDate: '2024-02-29' }, today)).toEqual({ ok: true });
  });

  it('accepts amounts with 2 decimals', () => {
    expect(validateClaim({ ...valid, amount: 150.25 }, today).ok).toBe(true);
    expect(validateClaim({ ...valid, amount: 0.1 + 0.2 }, today).ok).toBe(true);
  });
});

describe('validateDocument', () => {
  it('accepts a valid document', () => {
    expect(validateDocument({ type: 'medical_receipt', contentType: 'application/pdf', size: 1 })).toEqual({ ok: true });
  });

  it('rejects bad type, MIME and oversize files', () => {
    expect(validateDocument({ type: 'selfie', contentType: 'text/plain', size: 10_485_761 })).toEqual({
      ok: false,
      fields: {
        type: 'must be one of medical_receipt, medical_report, prescription, id_card, other',
        contentType: 'must be one of application/pdf, image/jpeg, image/png',
        size: 'must be at most 10 MB',
      },
    });
  });

  it('accepts exactly 10 MB', () => {
    expect(validateDocument({ type: 'other', contentType: 'image/png', size: 10_485_760 })).toEqual({ ok: true });
  });

  it('rejects empty files and missing content type', () => {
    expect(validateDocument({ type: 'other', contentType: undefined, size: 0 })).toEqual({
      ok: false,
      fields: { contentType: 'required', size: 'must be greater than 0' },
    });
  });
});

describe('inferContentType', () => {
  it('infers content type from extension, case-insensitively', () => {
    expect(inferContentType('a.PDF')).toBe('application/pdf');
    expect(inferContentType('b.jpeg')).toBe('image/jpeg');
    expect(inferContentType('b.jpg')).toBe('image/jpeg');
    expect(inferContentType('c.png')).toBe('image/png');
    expect(inferContentType('c.txt')).toBeUndefined();
    expect(inferContentType('noext')).toBeUndefined();
  });
});

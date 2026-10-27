/**
 * Helpers shared by the example scripts. Run the examples with `npm run example:<n>`,
 * which loads `.env` (see `.env.example`).
 */
import {
  ApiError,
  AuthError,
  type Claim,
  type CreateClaimInput,
  InsuranceSDK,
  type InsuranceSDKOptions,
  maskApiKey,
  NetworkError,
  ValidationError,
} from '@insurance/partner-sdk';

/** `overrides` replace the values from `.env`; example 1 uses them to demonstrate failures. */
export function createSdk(overrides: Partial<Pick<InsuranceSDKOptions, 'apiKey' | 'baseUrl'>> = {}): InsuranceSDK {
  const apiKey = overrides.apiKey ?? process.env.INSURANCE_API_KEY;
  if (!apiKey) {
    console.error('Set INSURANCE_API_KEY in .env (see .env.example)');
    process.exit(1);
  }
  // The SDK never reads environment variables itself: pass the key explicitly.
  return new InsuranceSDK({
    apiKey,
    environment: 'sandbox',
    baseUrl: overrides.baseUrl ?? process.env.INSURANCE_BASE_URL ?? 'http://localhost:4000',
  });
}

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function sampleClaim(): CreateClaimInput {
  return {
    policyId: 'POL-123',
    claimType: 'OUTPATIENT',
    diagnosisCode: 'J06.9',
    treatmentDate: today(),
    amount: 15000,
    currency: 'THB',
  };
}

export function describeClaim(claim: Claim): string {
  return `${claim.id} | ${claim.status} | ${claim.claimType} ${claim.amount.toLocaleString()} ${claim.currency} | policy ${claim.policyId}`;
}

export function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

/** The recommended way to branch on SDK errors. `apiKey` is the key the failing SDK used. */
export function reportError(error: unknown, apiKey = process.env.INSURANCE_API_KEY): void {
  const requestId = error instanceof Error && 'requestId' in error && error.requestId ? ` (requestId ${String(error.requestId)})` : '';
  if (error instanceof ValidationError) {
    console.error(`Validation failed${requestId}:`);
    for (const [field, message] of Object.entries(error.fields)) console.error(`  - ${field}: ${message}`);
  } else if (error instanceof AuthError) {
    console.error(`Authentication failed [${error.code}]${requestId}: ${error.message}`);
    if (apiKey) console.error(`  Check the API key (${maskApiKey(apiKey)}) and that the mock server accepts it (MOCK_API_KEYS).`);
  } else if (error instanceof NetworkError) {
    console.error(`Network problem [${error.code}]: ${error.message}. Is the mock server running? (npm run mock)`);
  } else if (error instanceof ApiError) {
    console.error(`API error ${error.status} [${error.code}]${requestId}: ${error.message}`);
  } else {
    console.error('Unexpected error:', error);
  }
}

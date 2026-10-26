/**
 * Example 1: submit a claim, then see how client-side validation reports bad input.
 *
 *   npm run example:1
 */
import { ValidationError } from '@insurance/partner-sdk';
import { createSdk, describeClaim, reportError, sampleClaim } from './shared';

const sdk = createSdk();

try {
  console.log('Submitting a claim...');
  const claim = await sdk.claims.create(sampleClaim());
  console.log(`Created: ${describeClaim(claim)}`);

  const fetched = await sdk.claims.get(claim.id);
  console.log(`Fetched: ${fetched.id} is ${fetched.status} (submitted ${fetched.createdAt})`);
} catch (error) {
  reportError(error);
  process.exit(1);
}

console.log('\nSubmitting an invalid claim (no request is sent)...');
try {
  await sdk.claims.create({ ...sampleClaim(), policyId: '123', diagnosisCode: 'flu', amount: -50 });
} catch (error) {
  if (!(error instanceof ValidationError)) {
    reportError(error);
    process.exit(1);
  }
  reportError(error);
}

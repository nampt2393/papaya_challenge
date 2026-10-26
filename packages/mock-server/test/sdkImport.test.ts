import { CLAIM_STATUSES } from '@insurance/partner-sdk';
import { expect, it } from 'vitest';

it('resolves the SDK workspace package', () => {
  expect(CLAIM_STATUSES).toHaveLength(8);
});

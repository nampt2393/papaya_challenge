/**
 * Example 3: watch a claim's status until you press Ctrl+C.
 *
 *   npm run example:3               # creates a new claim and watches it
 *   npm run example:3 -- CLM-0001   # watches an existing claim
 *
 * Change the status from another terminal with the curl command this script prints.
 */
import { CLAIM_TRANSITIONS, type ClaimStatus, type StatusHistoryEntry } from '@insurance/partner-sdk';
import { createSdk, describeClaim, reportError, sampleClaim, timestamp } from './shared';

const sdk = createSdk();
const baseUrl = process.env.INSURANCE_BASE_URL ?? 'http://localhost:4000';

let claimId = process.argv[2];
const watchingExisting = claimId !== undefined;
let current: ClaimStatus;
try {
  const claim = watchingExisting && claimId ? await sdk.claims.get(claimId) : await sdk.claims.create(sampleClaim());
  claimId = claim.id;
  current = claim.status;
  console.log(`${watchingExisting ? 'Watching' : 'Created'}: ${describeClaim(claim)}`);
} catch (error) {
  reportError(error);
  process.exit(1);
}

function printNextSteps(status: ClaimStatus): void {
  const next = CLAIM_TRANSITIONS[status];
  if (next.length === 0) {
    console.log(`  ${status} is final. Press Ctrl+C to stop.`);
    return;
  }
  console.log(`  Next allowed: ${next.join(' | ')}. For example:`);
  console.log(
    `    curl -X PATCH ${baseUrl}/__mock/claims/${claimId}/status -H 'content-type: application/json' -d '{"status":"${next[0]}"}'`,
  );
}

/**
 * Polling only sees the latest status, so several quick changes can arrive as one.
 * The claim's history has every step: return the statuses reached since `from`.
 */
function stepsSince(history: StatusHistoryEntry[], from: ClaimStatus): StatusHistoryEntry[] {
  const index = history.map((entry) => entry.status).lastIndexOf(from);
  return index === -1 ? history.slice(-1) : history.slice(index + 1);
}

console.log(`\n[${timestamp()}] Polling ${claimId} every 2s. Press Ctrl+C to stop.`);
printNextSteps(current);

let changes = 0;
const unsubscribe = sdk.claims.onStatusChange(
  claimId,
  (newStatus, claim) => {
    const steps = stepsSince(claim.statusHistory, current);
    changes += steps.length;
    const path = [current, ...steps.map((step) => step.status)].join(' → ');
    const notes = steps.flatMap((step) => (step.note ? [step.note] : []));
    console.log(`[${timestamp()}] ${claim.id}: ${path}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`);
    current = newStatus;
    printNextSteps(newStatus);
  },
  {
    intervalMs: 2000,
    onError: (error) => {
      console.error(`[${timestamp()}] Polling error, will keep trying:`);
      reportError(error);
    },
  },
);

process.on('SIGINT', () => {
  unsubscribe();
  console.log(`\nStopped watching ${claimId} after ${changes} status change(s).`);
  process.exit(0);
});

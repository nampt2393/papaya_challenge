/**
 * Example 1: submit a claim, and see how each kind of failure is reported.
 *
 *   npm run example:1                            # success (default)
 *   npm run example:1 -- --scenario validation
 *   npm run example:1 -- --scenario all
 */
import { parseArgs } from 'node:util';
import { ApiError, AuthError, NetworkError, ValidationError } from '@insurance/partner-sdk';
import { createSdk, describeClaim, reportError, sampleClaim } from './shared';

const WRONG_API_KEY = 'pk_test_wrong';

interface Scenario {
  description: string;
  /** The error this scenario demonstrates; `undefined` means it should succeed. */
  expected?: typeof ValidationError | typeof AuthError | typeof ApiError | typeof NetworkError;
  /** The API key the scenario uses, for the hint printed with an `AuthError`. */
  apiKey?: string;
  run: () => Promise<void>;
}

const scenarios = {
  success: {
    description: 'submit a valid claim, then fetch it',
    run: async () => {
      const sdk = createSdk();
      const claim = await sdk.claims.create(sampleClaim());
      console.log(`Created: ${describeClaim(claim)}`);
      const fetched = await sdk.claims.get(claim.id);
      console.log(`Fetched: ${fetched.id} is ${fetched.status} (submitted ${fetched.createdAt})`);
    },
  },
  validation: {
    description: 'submit an invalid claim; the SDK rejects it without sending a request',
    expected: ValidationError,
    run: async () => {
      await createSdk().claims.create({ ...sampleClaim(), policyId: '123', diagnosisCode: 'flu', amount: -50 });
    },
  },
  auth: {
    description: `the SDK is created with a wrong API key (${WRONG_API_KEY})`,
    expected: AuthError,
    apiKey: WRONG_API_KEY,
    run: async () => {
      await createSdk({ apiKey: WRONG_API_KEY }).claims.create(sampleClaim());
    },
  },
  'not-found': {
    description: 'fetch a claim that does not exist (CLM-9999)',
    expected: ApiError,
    run: async () => {
      await createSdk().claims.get('CLM-9999');
    },
  },
  network: {
    description: 'the API is unreachable (baseUrl points at a closed port); the SDK retries 3 times first',
    expected: NetworkError,
    run: async () => {
      await createSdk({ baseUrl: 'http://127.0.0.1:1' }).claims.get('CLM-0001');
    },
  },
} satisfies Record<string, Scenario>;

type ScenarioName = keyof typeof scenarios;
const names = Object.keys(scenarios) as ScenarioName[];

function usage(message: string): never {
  console.error(message);
  console.error('Usage: npm run example:1 [-- --scenario <name>]');
  console.error(`  name: one of ${names.join(', ')}, all (default success)`);
  process.exit(1);
}

let scenarioArg: string;
try {
  scenarioArg = parseArgs({ options: { scenario: { type: 'string', default: 'success' } } }).values.scenario;
} catch (error) {
  usage((error as Error).message);
}
if (scenarioArg !== 'all' && !(names as string[]).includes(scenarioArg)) usage(`Unknown scenario: ${scenarioArg}`);
const selected = scenarioArg === 'all' ? names : [scenarioArg as ScenarioName];

/** Runs one scenario and reports whether it behaved as intended. */
async function runScenario(name: ScenarioName): Promise<boolean> {
  const scenario: Scenario = scenarios[name];
  console.log(`Scenario ${name}: ${scenario.description}`);
  try {
    await scenario.run();
  } catch (error) {
    reportError(error, scenario.apiKey);
    return scenario.expected !== undefined && error instanceof scenario.expected;
  }
  if (scenario.expected) console.error(`Expected ${scenario.expected.name}, but the call succeeded.`);
  return scenario.expected === undefined;
}

let ok = true;
for (const [index, name] of selected.entries()) {
  if (index > 0) console.log('');
  ok = (await runScenario(name)) && ok;
}
process.exit(ok ? 0 : 1);

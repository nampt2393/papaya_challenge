export interface MockConfig {
  port: number;
  apiKeys: string[];
  jwtSecret: string;
  jwtTtlSec: number;
  /** Simulated latency and transient 503s on /api/v1 routes. */
  chaos: boolean;
  failureRate: number;
  delayMinMs: number;
  delayMaxMs: number;
  /** Seeds the random source so chaos is reproducible. */
  seed: number | undefined;
  /** Clock used for timestamps and token expiry. */
  now: () => number;
}

function number(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Reads settings from environment variables, falling back to the defaults. */
export function loadConfig(env: NodeJS.ProcessEnv): MockConfig {
  const apiKeys = (env.MOCK_API_KEYS ?? 'pk_test_dev_123')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  return {
    port: number(env.MOCK_PORT, 4000),
    apiKeys,
    jwtSecret: env.MOCK_JWT_SECRET ?? 'dev-secret-change-me',
    jwtTtlSec: number(env.MOCK_JWT_TTL_SEC, 3600),
    chaos: env.CHAOS !== 'off',
    failureRate: number(env.MOCK_FAILURE_RATE, 0.1),
    delayMinMs: number(env.MOCK_DELAY_MIN_MS, 200),
    delayMaxMs: number(env.MOCK_DELAY_MAX_MS, 500),
    seed: env.MOCK_SEED === undefined || env.MOCK_SEED === '' ? undefined : number(env.MOCK_SEED, 0),
    now: Date.now,
  };
}

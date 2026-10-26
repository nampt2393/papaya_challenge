import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('applies spec defaults', () => {
    expect(loadConfig({})).toMatchObject({
      port: 4000,
      apiKeys: ['pk_test_dev_123'],
      jwtSecret: 'dev-secret-change-me',
      jwtTtlSec: 3600,
      chaos: true,
      failureRate: 0.1,
      delayMinMs: 200,
      delayMaxMs: 500,
      seed: undefined,
    });
  });

  it('reads overrides from env', () => {
    expect(
      loadConfig({ MOCK_PORT: '5000', MOCK_API_KEYS: 'pk_test_a, pk_test_b', CHAOS: 'off', MOCK_SEED: '7', MOCK_FAILURE_RATE: '0.5' }),
    ).toMatchObject({ port: 5000, apiKeys: ['pk_test_a', 'pk_test_b'], chaos: false, seed: 7, failureRate: 0.5 });
  });
});

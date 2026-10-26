import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskApiKey, resolveConfig, type InsuranceSDKOptions } from '../src/config';
import { ValidationError } from '../src/errors';
import { InsuranceSDK } from '../src/InsuranceSDK';

describe('resolveConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [{ environment: 'sandbox' }, { apiKey: 'required' }],
    [{ apiKey: 'abc', environment: 'sandbox' }, { apiKey: 'must start with pk_' }],
    [{ apiKey: 'pk_test_1', environment: 'staging' }, { environment: 'must be sandbox or production' }],
    [{ apiKey: 'pk_test_1', environment: 'sandbox', timeout: 0 }, { timeout: 'must be a positive integer' }],
    [{ apiKey: 'pk_test_1', environment: 'sandbox', maxRetries: -1 }, { maxRetries: 'must be a non-negative integer' }],
  ])('rejects invalid options %#', (options, fields) => {
    expect(() => resolveConfig(options as InsuranceSDKOptions)).toThrow(ValidationError);
    expect(() => resolveConfig(options as InsuranceSDKOptions)).toThrow(expect.objectContaining({ fields }));
  });

  it('does not read INSURANCE_API_KEY from the environment', () => {
    vi.stubEnv('INSURANCE_API_KEY', 'pk_test_env');
    expect(() => new InsuranceSDK({ environment: 'sandbox' } as InsuranceSDKOptions)).toThrow(ValidationError);
  });

  it('resolves environment URLs, baseUrl override and defaults', () => {
    expect(resolveConfig({ apiKey: 'pk_test_1', environment: 'sandbox' })).toMatchObject({
      baseUrl: 'http://localhost:4000',
      timeoutMs: 30_000,
      maxRetries: 3,
    });
    expect(resolveConfig({ apiKey: 'pk_live_1', environment: 'production' }).baseUrl).toBe('https://api.insurance.example.com');
    expect(resolveConfig({ apiKey: 'pk_test_1', environment: 'sandbox', baseUrl: 'http://x:1/' }).baseUrl).toBe('http://x:1');
  });

  it('masks API keys', () => {
    expect(maskApiKey('pk_test_dev_123')).toBe('pk_test_****123');
    expect(maskApiKey('pk_live_abcdef')).toBe('pk_live_****def');
  });
});

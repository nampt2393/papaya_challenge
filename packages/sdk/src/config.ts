import { ValidationError } from './errors';
import { NodeTransport, type Transport } from './http/Transport';
import { toResult } from './validation/checks';

export const ENVIRONMENT_URLS = {
  sandbox: 'http://localhost:4000',
  production: 'https://api.insurance.example.com',
} as const;

export type Environment = keyof typeof ENVIRONMENT_URLS;

export interface InsuranceSDKOptions {
  /** Your partner API key (`pk_test_…` or `pk_live_…`). Required; the SDK never reads it from the environment. */
  apiKey: string;
  environment: Environment;
  /** Overrides the environment's base URL, e.g. a mock server on another port. */
  baseUrl?: string;
  /** Per-attempt timeout in ms. Default 30000. */
  timeout?: number;
  /** Retries for transient failures (503, network errors). Default 3. */
  maxRetries?: number;
  /** Replace the HTTP layer (advanced use and testing). */
  transport?: Transport;
}

export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  transport: Transport;
}

function isInteger(value: unknown, min: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

/** Validates options and applies defaults. Throws `ValidationError`. */
export function resolveConfig(options: InsuranceSDKOptions): ResolvedConfig {
  const { apiKey, environment, timeout, maxRetries, baseUrl } = options;
  const result = toResult({
    apiKey:
      typeof apiKey !== 'string' || apiKey.length === 0 ? 'required' : apiKey.startsWith('pk_') ? undefined : 'must start with pk_',
    environment: environment in ENVIRONMENT_URLS ? undefined : 'must be sandbox or production',
    timeout: timeout === undefined || isInteger(timeout, 1) ? undefined : 'must be a positive integer',
    maxRetries: maxRetries === undefined || isInteger(maxRetries, 0) ? undefined : 'must be a non-negative integer',
    baseUrl: baseUrl === undefined || URL.canParse(baseUrl) ? undefined : 'must be a valid URL',
  });
  if (!result.ok) throw new ValidationError(result.fields, { message: `Invalid SDK options: ${Object.keys(result.fields).join(', ')}` });

  return {
    apiKey,
    baseUrl: (baseUrl ?? ENVIRONMENT_URLS[environment]).replace(/\/+$/, ''),
    timeoutMs: timeout ?? 30_000,
    maxRetries: maxRetries ?? 3,
    transport: options.transport ?? new NodeTransport(),
  };
}

/** `pk_test_dev_123` → `pk_test_****123`. Safe for logs. */
export function maskApiKey(apiKey: string): string {
  const prefix = `${apiKey.split('_').slice(0, 2).join('_')}_`;
  return `${prefix}****${apiKey.slice(-3)}`;
}

import { resolveConfig, type InsuranceSDKOptions } from './config';
import { HttpClient } from './http/HttpClient';
import { RetryPolicy } from './http/RetryPolicy';
import { ClaimsResource } from './resources/ClaimsResource';

/**
 * Entry point of the SDK.
 *
 * @example
 * const sdk = new InsuranceSDK({ apiKey: process.env.INSURANCE_API_KEY!, environment: 'sandbox' });
 * const claim = await sdk.claims.create({ ... });
 */
export class InsuranceSDK {
  readonly claims: ClaimsResource;

  /** @throws ValidationError when options are invalid (e.g. missing `apiKey`). */
  constructor(options: InsuranceSDKOptions) {
    const config = resolveConfig(options);
    const http = new HttpClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      transport: config.transport,
      retry: new RetryPolicy({ maxRetries: config.maxRetries }),
    });
    this.claims = new ClaimsResource(http);
  }
}

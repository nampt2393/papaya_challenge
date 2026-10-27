export interface TokenResponse {
  accessToken: string;
  /** Lifetime in seconds. */
  expiresIn: number;
}

/**
 * Refresh before the token actually expires, by 10% of its lifetime but never
 * more than 60s, so short-lived tokens are still reused.
 */
const MAX_REFRESH_MARGIN_MS = 60_000;
const REFRESH_MARGIN_RATIO = 0.1;

/**
 * Owns the access token. Concurrent callers share a single in-flight refresh,
 * and a failed refresh is never cached.
 */
export class AuthManager {
  private readonly fetchToken: () => Promise<TokenResponse>;
  private readonly now: () => number;
  private token: { value: string; refreshAt: number } | undefined;
  private refreshPromise: Promise<string> | undefined;

  constructor(options: { fetchToken: () => Promise<TokenResponse>; now?: () => number }) {
    this.fetchToken = options.fetchToken;
    this.now = options.now ?? Date.now;
  }

  getToken(): Promise<string> {
    if (this.token && this.now() < this.token.refreshAt) {
      return Promise.resolve(this.token.value);
    }
    this.refreshPromise ??= this.refresh().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  /**
   * Drops the cached token, but only if it is still the one that was rejected.
   * If another caller already stored a newer token, this does nothing.
   */
  invalidate(failedToken: string): void {
    if (this.token?.value === failedToken) this.token = undefined;
  }

  private async refresh(): Promise<string> {
    const { accessToken, expiresIn } = await this.fetchToken();
    const lifetimeMs = expiresIn * 1000;
    const marginMs = Math.min(MAX_REFRESH_MARGIN_MS, lifetimeMs * REFRESH_MARGIN_RATIO);
    this.token = { value: accessToken, refreshAt: this.now() + lifetimeMs - marginMs };
    return accessToken;
  }
}

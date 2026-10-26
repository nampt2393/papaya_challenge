export interface TokenResponse {
  accessToken: string;
  /** Lifetime in seconds. */
  expiresIn: number;
}

/** Refresh this long before the token actually expires. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Owns the access token. Concurrent callers share a single in-flight refresh,
 * and a failed refresh is never cached.
 */
export class AuthManager {
  private readonly fetchToken: () => Promise<TokenResponse>;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | undefined;
  private refreshPromise: Promise<string> | undefined;

  constructor(options: { fetchToken: () => Promise<TokenResponse>; now?: () => number }) {
    this.fetchToken = options.fetchToken;
    this.now = options.now ?? Date.now;
  }

  getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - REFRESH_MARGIN_MS > this.now()) {
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
    this.token = { value: accessToken, expiresAt: this.now() + expiresIn * 1000 };
    return accessToken;
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../src/errors';
import { AuthManager, type TokenResponse } from '../src/http/AuthManager';

describe('AuthManager', () => {
  let now: number;
  let issued: number;
  let fetchToken: ReturnType<typeof vi.fn<() => Promise<TokenResponse>>>;
  let auth: AuthManager;

  beforeEach(() => {
    now = 0;
    issued = 0;
    fetchToken = vi.fn(async () => {
      await Promise.resolve();
      issued += 1;
      return { accessToken: `tok-${issued}`, expiresIn: 3600 };
    });
    auth = new AuthManager({ fetchToken, now: () => now });
  });

  it('caches the token until 60s before expiry', async () => {
    expect(await auth.getToken()).toBe('tok-1');
    now += 3_539_000;
    expect(await auth.getToken()).toBe('tok-1');
    now += 2_000;
    expect(await auth.getToken()).toBe('tok-2');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('3 concurrent calls with no valid token trigger exactly 1 refresh', async () => {
    const tokens = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
    expect(tokens).toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('3 concurrent calls with an expired cached token trigger exactly 1 refresh', async () => {
    await auth.getToken();
    now += 3_600_000;
    const tokens = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
    expect(tokens).toEqual(['tok-2', 'tok-2', 'tok-2']);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('3 concurrent invalidations of the same stale token trigger exactly 1 refresh', async () => {
    const stale = await auth.getToken();
    const retried = await Promise.all(
      [0, 1, 2].map(async () => {
        auth.invalidate(stale);
        return auth.getToken();
      }),
    );
    expect(retried).toEqual(['tok-2', 'tok-2', 'tok-2']);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('invalidate is a no-op when a newer token is already cached', async () => {
    const t1 = await auth.getToken();
    auth.invalidate(t1);
    const t2 = await auth.getToken();
    auth.invalidate(t1);
    expect(await auth.getToken()).toBe(t2);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('a failed refresh rejects all waiters and is not cached', async () => {
    fetchToken.mockRejectedValueOnce(new AuthError('bad key', { code: 'INVALID_API_KEY' }));
    const results = await Promise.allSettled([auth.getToken(), auth.getToken(), auth.getToken()]);
    expect(results.every((r) => r.status === 'rejected' && r.reason instanceof AuthError)).toBe(true);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(await auth.getToken()).toBe('tok-1');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});

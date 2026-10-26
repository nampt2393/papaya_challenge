import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, AuthError, NetworkError, SDKError, ValidationError } from '../src/errors';
import { InsuranceSDK } from '../src/InsuranceSDK';
import { StatusPoller } from '../src/resources/StatusPoller';
import type { Claim, ClaimStatus } from '../src/types';
import { fakeTransport, json, withTokenEndpoint } from './helpers/fakeTransport';

function claimWith(status: ClaimStatus): Claim {
  return {
    id: 'CLM-0001',
    policyId: 'POL-1',
    claimType: 'OUTPATIENT',
    diagnosisCode: 'J06.9',
    treatmentDate: '2024-03-15',
    amount: 100,
    currency: 'THB',
    status,
    statusHistory: [],
    createdAt: '2024-03-16T00:00:00.000Z',
    updatedAt: '2024-03-16T00:00:00.000Z',
  };
}

/** Each script entry is a status to return or an error to throw; the last entry repeats. */
function scripted(script: (ClaimStatus | Error)[]) {
  let i = 0;
  return vi.fn(async (_id: string): Promise<Claim> => {
    const step = script[Math.min(i++, script.length - 1)]!;
    if (step instanceof Error) throw step;
    return claimWith(step);
  });
}

describe('StatusPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire for the baseline and fires once per change', async () => {
    const fetchClaim = scripted(['SUBMITTED', 'SUBMITTED', 'DOCUMENTS_VERIFIED', 'DOCUMENTS_VERIFIED', 'UNDER_ASSESSMENT']);
    const callback = vi.fn();
    const unsubscribe = new StatusPoller(fetchClaim).subscribe('CLM-0001', callback, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchClaim).toHaveBeenCalledTimes(5);
    expect(callback.mock.calls.map((call) => call[0])).toEqual(['DOCUMENTS_VERIFIED', 'UNDER_ASSESSMENT']);
    expect(callback.mock.calls[0]![1]).toMatchObject({ id: 'CLM-0001', status: 'DOCUMENTS_VERIFIED' });
    unsubscribe();
  });

  it('defaults to a 5 second interval', async () => {
    const fetchClaim = scripted(['SUBMITTED']);
    const unsubscribe = new StatusPoller(fetchClaim).subscribe('CLM-0001', vi.fn());
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchClaim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchClaim).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('never overlaps requests when a fetch is slower than the interval', async () => {
    let pending = 0;
    let maxPending = 0;
    const fetchClaim = vi.fn(async () => {
      pending += 1;
      maxPending = Math.max(maxPending, pending);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      pending -= 1;
      return claimWith('SUBMITTED');
    });
    const unsubscribe = new StatusPoller(fetchClaim).subscribe('CLM-0001', vi.fn(), { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(maxPending).toBe(1);
    expect(fetchClaim).toHaveBeenCalledTimes(3); // t=0, t=4000, t=8000
    unsubscribe();
  });

  it('reports errors to onError and keeps polling', async () => {
    const fetchClaim = scripted(['SUBMITTED', new NetworkError('down'), 'DOCUMENTS_VERIFIED']);
    const callback = vi.fn();
    const onError = vi.fn();
    const unsubscribe = new StatusPoller(fetchClaim).subscribe('CLM-0001', callback, { intervalMs: 1000, onError });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledWith(expect.any(NetworkError));
    expect(callback).toHaveBeenCalledWith('DOCUMENTS_VERIFIED', expect.objectContaining({ status: 'DOCUMENTS_VERIFIED' }));
    unsubscribe();
  });

  it.each([
    ['404', new ApiError('missing', { status: 404, code: 'NOT_FOUND' })],
    ['AuthError', new AuthError('bad key', { code: 'INVALID_API_KEY' })],
  ])('stops polling on %s', async (_name, error) => {
    const fetchClaim = scripted(['SUBMITTED', error]);
    const onError = vi.fn();
    new StatusPoller(fetchClaim).subscribe('CLM-0001', vi.fn(), { intervalMs: 1000, onError });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchClaim).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unsubscribe stops further polls', async () => {
    const fetchClaim = scripted(['SUBMITTED', 'DOCUMENTS_VERIFIED']);
    const unsubscribe = new StatusPoller(fetchClaim).subscribe('CLM-0001', vi.fn(), { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchClaim).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not fire the callback when unsubscribed during an in-flight fetch', async () => {
    let resolveSecond: (claim: Claim) => void = () => {};
    const fetchClaim = vi
      .fn<(id: string) => Promise<Claim>>()
      .mockResolvedValueOnce(claimWith('SUBMITTED'))
      .mockImplementationOnce(() => new Promise<Claim>((resolve) => (resolveSecond = resolve)));
    const callback = vi.fn();
    const unsubscribe = new StatusPoller(fetchClaim).subscribe('CLM-0001', callback, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchClaim).toHaveBeenCalledTimes(2);
    unsubscribe();
    resolveSecond(claimWith('DOCUMENTS_VERIFIED'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a throwing callback goes to onError and polling continues', async () => {
    const fetchClaim = scripted(['SUBMITTED', 'DOCUMENTS_VERIFIED', 'UNDER_ASSESSMENT']);
    const callback = vi.fn().mockImplementationOnce(() => {
      throw new Error('partner bug');
    });
    const onError = vi.fn();
    const unsubscribe = new StatusPoller(fetchClaim).subscribe('CLM-0001', callback, { intervalMs: 1000, onError });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'CALLBACK_ERROR' }));
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(SDKError);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith('UNDER_ASSESSMENT', expect.anything());
    unsubscribe();
  });

  it('a rejecting async callback goes to onError without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const fetchClaim = scripted(['SUBMITTED', 'DOCUMENTS_VERIFIED', 'UNDER_ASSESSMENT']);
      const callback = vi.fn(async () => {
        throw new Error('db write failed');
      });
      const onError = vi.fn();
      const unsubscribe = new StatusPoller(fetchClaim).subscribe('CLM-0001', callback, { intervalMs: 1000, onError });
      await vi.advanceTimersByTimeAsync(2000);
      unsubscribe();
      vi.useRealTimers(); // let Node report unhandled rejections
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError.mock.calls[0]![0]).toMatchObject({ code: 'CALLBACK_ERROR' });
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('validates claimId and intervalMs synchronously', () => {
    const poller = new StatusPoller(scripted(['SUBMITTED']));
    expect(() => poller.subscribe('', vi.fn())).toThrow(expect.objectContaining({ fields: { claimId: 'required' } }));
    expect(() => poller.subscribe('CLM-1', vi.fn(), { intervalMs: 500 })).toThrow(ValidationError);
    expect(() => poller.subscribe('CLM-1', vi.fn(), { intervalMs: 1500.5 })).toThrow(
      expect.objectContaining({ fields: { intervalMs: 'must be an integer >= 1000' } }),
    );
  });

  it('is exposed as sdk.claims.onStatusChange', async () => {
    const statuses: ClaimStatus[] = ['SUBMITTED', 'APPROVED'];
    let i = 0;
    const transport = fakeTransport(withTokenEndpoint(() => json(200, claimWith(statuses[Math.min(i++, 1)]!))));
    const sdk = new InsuranceSDK({ apiKey: 'pk_test_1', environment: 'sandbox', transport });
    const callback = vi.fn();
    const unsubscribe = sdk.claims.onStatusChange('CLM-0001', callback, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledWith('APPROVED', expect.objectContaining({ id: 'CLM-0001' }));
    unsubscribe();
  });
});

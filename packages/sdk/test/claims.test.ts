import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors';
import type { TransportRequest } from '../src/http/Transport';
import { InsuranceSDK } from '../src/InsuranceSDK';
import type { Claim, CreateClaimInput } from '../src/types';
import { fakeTransport, isTokenRequest, json, withTokenEndpoint, type FakeReply } from './helpers/fakeTransport';

const valid: CreateClaimInput = {
  policyId: 'POL-123',
  claimType: 'OUTPATIENT',
  diagnosisCode: 'J06.9',
  treatmentDate: '2024-03-15',
  amount: 15000,
  currency: 'THB',
};

const claim: Claim = {
  ...valid,
  id: 'CLM-0001',
  status: 'SUBMITTED',
  statusHistory: [{ status: 'SUBMITTED', at: '2024-03-16T00:00:00.000Z' }],
  createdAt: '2024-03-16T00:00:00.000Z',
  updatedAt: '2024-03-16T00:00:00.000Z',
};

function setup(handler: (req: TransportRequest) => FakeReply = () => json(200, claim)) {
  const transport = fakeTransport(withTokenEndpoint(handler));
  const sdk = new InsuranceSDK({ apiKey: 'pk_test_dev_123', environment: 'sandbox', baseUrl: 'http://api.test', transport });
  const apiRequests = () => transport.calls.filter((c) => !isTokenRequest(c));
  return { sdk, transport, apiRequests };
}

describe('claims', () => {
  it('create posts the input and returns the claim', async () => {
    const { sdk, apiRequests } = setup(() => json(201, claim));
    await expect(sdk.claims.create(valid)).resolves.toEqual(claim);
    const [req] = apiRequests();
    expect(req).toMatchObject({ method: 'POST', url: 'http://api.test/api/v1/claims' });
    expect(JSON.parse(req!.body as string)).toEqual(valid);
  });

  it('create rejects invalid input without any network call', async () => {
    const { sdk, transport } = setup();
    await expect(sdk.claims.create({ ...valid, amount: -1 })).rejects.toMatchObject({
      name: 'ValidationError',
      fields: { amount: 'must be positive' },
    });
    expect(transport.calls).toHaveLength(0);
  });

  it('get fetches by encoded id', async () => {
    const { sdk, apiRequests } = setup();
    await expect(sdk.claims.get('CLM-0001')).resolves.toEqual(claim);
    await sdk.claims.get('CLM/1');
    expect(apiRequests().map((r) => r.url)).toEqual(['http://api.test/api/v1/claims/CLM-0001', 'http://api.test/api/v1/claims/CLM%2F1']);
  });

  it('get rejects an empty id', async () => {
    const { sdk, transport } = setup();
    await expect(sdk.claims.get('')).rejects.toMatchObject({ fields: { id: 'required' } });
    expect(transport.calls).toHaveLength(0);
  });

  it('list sends filters as query and returns a page', async () => {
    const page = { data: [claim], page: 1, pageSize: 20, total: 1, totalPages: 1 };
    const { sdk, apiRequests } = setup(() => json(200, page));
    await expect(sdk.claims.list({ status: 'UNDER_ASSESSMENT', page: 1, pageSize: 20 })).resolves.toEqual(page);
    await sdk.claims.list();
    expect(apiRequests().map((r) => r.url)).toEqual([
      'http://api.test/api/v1/claims?status=UNDER_ASSESSMENT&page=1&pageSize=20',
      'http://api.test/api/v1/claims',
    ]);
  });

  it('list rejects pageSize 101, page 0 and unknown status', async () => {
    const { sdk, transport } = setup();
    const error = await sdk.claims.list({ pageSize: 101, page: 0, status: 'PENDING' as never }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual({
      page: 'must be an integer >= 1',
      pageSize: 'must be an integer between 1 and 100',
      status:
        'must be one of SUBMITTED, DOCUMENTS_VERIFIED, UNDER_ASSESSMENT, PENDING_INFO, APPROVED, REJECTED, PAYMENT_INITIATED, CLOSED',
    });
    expect(transport.calls).toHaveLength(0);
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { MultipartBody } from '../src/http/multipart';
import type { TransportRequest } from '../src/http/Transport';
import { InsuranceSDK } from '../src/InsuranceSDK';
import { resolveUploadSource } from '../src/resources/uploadSource';
import type { ClaimDocument } from '../src/types';
import { fakeTransport, isTokenRequest, json, withTokenEndpoint, type FakeReply } from './helpers/fakeTransport';

const dir = mkdtempSync(join(tmpdir(), 'sdk-docs-'));
const pdfPath = join(dir, 'receipt.pdf');
writeFileSync(pdfPath, Buffer.alloc(1234, 1));
const emptyPath = join(dir, 'empty.pdf');
writeFileSync(emptyPath, '');

const document: ClaimDocument = {
  id: 'DOC-0001',
  claimId: 'CLM-0001',
  type: 'medical_receipt',
  filename: 'receipt.pdf',
  contentType: 'application/pdf',
  size: 1234,
  uploadedAt: '2024-03-16T00:00:00.000Z',
};

function setup(handler: (req: TransportRequest) => FakeReply | Promise<FakeReply> = () => json(201, document)) {
  const transport = fakeTransport(withTokenEndpoint(handler));
  const sdk = new InsuranceSDK({ apiKey: 'pk_test_dev_123', environment: 'sandbox', baseUrl: 'http://api.test', transport });
  const apiRequests = () => transport.calls.filter((c) => !isTokenRequest(c));
  return { sdk, transport, apiRequests };
}

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('latin1');
}

describe('documents.upload', () => {
  it('uploads from a file path with inferred name, size and type', async () => {
    const { sdk, apiRequests } = setup();
    await expect(sdk.documents.upload('CLM-0001', pdfPath, { type: 'medical_receipt' })).resolves.toEqual(document);
    const [req] = apiRequests();
    expect(req!.url).toBe('http://api.test/api/v1/claims/CLM-0001/documents');
    const body = req!.body as MultipartBody;
    expect(body.replayable).toBe(true);
    expect(body.contentLength).toBeGreaterThan(1234);
    const raw = await readAll(body.createStream());
    expect(raw).toContain('name="type"\r\n\r\nmedical_receipt');
    expect(raw).toContain('filename="receipt.pdf"\r\nContent-Type: application/pdf');
    expect(raw.length).toBe(body.contentLength);
  });

  it('rejects a path that does not exist without network', async () => {
    const { sdk, transport } = setup();
    await expect(sdk.documents.upload('CLM-0001', join(dir, 'missing.pdf'), { type: 'other' })).rejects.toMatchObject({
      name: 'ValidationError',
      fields: { file: 'file not found' },
    });
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects a directory path as file not found', async () => {
    const { sdk } = setup();
    await expect(sdk.documents.upload('CLM-0001', dir, { type: 'other' })).rejects.toMatchObject({ fields: { file: 'file not found' } });
  });

  it('rejects an empty file', async () => {
    const { sdk, transport } = setup();
    await expect(sdk.documents.upload('CLM-0001', emptyPath, { type: 'other' })).rejects.toMatchObject({
      fields: { size: 'must be greater than 0' },
    });
    expect(transport.calls).toHaveLength(0);
  });

  it('requires filename for Buffer sources', async () => {
    const { sdk } = setup();
    await expect(sdk.documents.upload('CLM-0001', Buffer.from('x'), { type: 'other' })).rejects.toMatchObject({
      fields: { filename: 'required' },
    });
  });

  it('requires size for stream sources and marks them non-replayable', async () => {
    await expect(resolveUploadSource(Readable.from([Buffer.from('x')]), { type: 'other', filename: 'a.pdf' })).rejects.toMatchObject({
      fields: { size: 'required for stream uploads' },
    });
    const resolved = await resolveUploadSource(Readable.from([Buffer.from('x')]), { type: 'other', filename: 'a.pdf', size: 1 });
    expect(resolved.replayable).toBe(false);
    expect(resolved.file).toMatchObject({ filename: 'a.pdf', contentType: 'application/pdf', size: 1 });
  });

  it('rejects files over 10 MB before sending', async () => {
    const { sdk, transport } = setup();
    await expect(
      sdk.documents.upload('CLM-0001', Buffer.alloc(10_485_761), { type: 'medical_receipt', filename: 'a.pdf' }),
    ).rejects.toMatchObject({ fields: { size: 'must be at most 10 MB' } });
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects unsupported content types', async () => {
    const { sdk } = setup();
    await expect(sdk.documents.upload('CLM-0001', Buffer.from('x'), { type: 'other', filename: 'notes.txt' })).rejects.toMatchObject({
      fields: { contentType: 'required' },
    });
    await expect(
      sdk.documents.upload('CLM-0001', Buffer.from('x'), { type: 'other', filename: 'notes.txt', contentType: 'text/plain' }),
    ).rejects.toMatchObject({ fields: { contentType: 'must be one of application/pdf, image/jpeg, image/png' } });
  });

  it('rejects an empty claimId and invalid type', async () => {
    const { sdk } = setup();
    await expect(sdk.documents.upload('', pdfPath, { type: 'selfie' as never })).rejects.toMatchObject({
      fields: { claimId: 'required', type: 'must be one of medical_receipt, medical_report, prescription, id_card, other' },
    });
  });

  it('reports monotonic integer progress ending at 100', async () => {
    const { sdk } = setup((req) => {
      for (const sent of [0, 50, 50, 20, 200]) req.onUploadProgress?.(sent, 200);
      return json(201, document);
    });
    const seen: number[] = [];
    await sdk.documents.upload('CLM-0001', Buffer.from('x'), {
      type: 'medical_receipt',
      filename: 'a.pdf',
      onProgress: (percent) => seen.push(percent),
    });
    expect(seen).toEqual([0, 25, 100]);
  });

  it('emits 100 on success even if the transport never reported completion', async () => {
    const { sdk } = setup(() => json(201, document));
    const seen: number[] = [];
    await sdk.documents.upload('CLM-0001', pdfPath, { type: 'other', onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([100]);
  });
});

describe('documents.list', () => {
  it('lists documents for a claim', async () => {
    const { sdk, apiRequests } = setup(() => json(200, [document]));
    await expect(sdk.documents.list('CLM-0001')).resolves.toEqual([document]);
    expect(apiRequests()[0]).toMatchObject({ method: 'GET', url: 'http://api.test/api/v1/claims/CLM-0001/documents' });
  });
});

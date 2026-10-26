import type { FastifyInstance } from 'fastify';

export const validClaim = {
  policyId: 'POL-123',
  claimType: 'OUTPATIENT',
  diagnosisCode: 'J06.9',
  treatmentDate: '2024-03-15',
  amount: 15000,
  currency: 'THB',
};

export async function getToken(app: FastifyInstance, apiKey = 'pk_test_dev_123'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: { apiKey } });
  return res.json<{ accessToken: string }>().accessToken;
}

export async function createClaim(app: FastifyInstance, token: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/claims',
    headers: { authorization: `Bearer ${token}` },
    payload: { ...validClaim, ...overrides },
  });
  return res.json<{ id: string }>();
}

export function setStatus(app: FastifyInstance, id: string, status: string) {
  return app.inject({ method: 'PATCH', url: `/__mock/claims/${id}/status`, payload: { status } });
}

/** Builds a multipart/form-data payload: text fields first, then the optional file. */
export function multipartPayload(
  fields: Record<string, string>,
  file?: { filename: string; contentType: string; data: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----test-boundary';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

import { type Claim, type ClaimStatus, type CreateClaimInput, validateClaim, validateListParams } from '@insurance/partner-sdk';
import type { FastifyInstance, FastifyReply } from 'fastify';

export function validationFailed(reply: FastifyReply, fields: Record<string, string>) {
  return reply.code(400).send({ code: 'VALIDATION_ERROR', message: `Validation failed: ${Object.keys(fields).join(', ')}`, fields });
}

export function claimNotFound(reply: FastifyReply, id: string) {
  return reply.code(404).send({ code: 'NOT_FOUND', message: `Claim ${id} not found` });
}

const toNumber = (value: string | undefined) => (value === undefined ? undefined : Number(value));

export function claimRoutes(app: FastifyInstance): void {
  const { store, config } = app;

  app.post('/api/v1/claims', async (request, reply) => {
    const result = validateClaim(request.body, new Date(config.now()));
    if (!result.ok) return validationFailed(reply, result.fields);

    const input = request.body as CreateClaimInput;
    const at = new Date(config.now()).toISOString();
    const claim: Claim = {
      id: store.nextClaimId(),
      policyId: input.policyId,
      claimType: input.claimType,
      diagnosisCode: input.diagnosisCode,
      treatmentDate: input.treatmentDate,
      amount: input.amount,
      currency: input.currency,
      status: 'SUBMITTED',
      statusHistory: [{ status: 'SUBMITTED', at }],
      createdAt: at,
      updatedAt: at,
    };
    store.claims.set(claim.id, claim);
    return reply.code(201).send(claim);
  });

  app.get<{ Params: { id: string } }>('/api/v1/claims/:id', async (request, reply) => {
    const claim = store.claims.get(request.params.id);
    return claim ?? claimNotFound(reply, request.params.id);
  });

  app.get<{ Querystring: { status?: string; page?: string; pageSize?: string } }>('/api/v1/claims', async (request, reply) => {
    const params = { status: request.query.status, page: toNumber(request.query.page), pageSize: toNumber(request.query.pageSize) };
    const result = validateListParams(params);
    if (!result.ok) return validationFailed(reply, result.fields);

    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const status = params.status as ClaimStatus | undefined;
    const matching = [...store.claims.values()].filter((claim) => status === undefined || claim.status === status).reverse();
    return {
      data: matching.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: matching.length,
      totalPages: Math.ceil(matching.length / pageSize),
    };
  });
}

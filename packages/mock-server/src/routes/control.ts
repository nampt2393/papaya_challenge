import { CLAIM_STATUSES, type ClaimStatus, type StatusHistoryEntry } from '@insurance/partner-sdk';
import type { FastifyInstance } from 'fastify';
import { allowedNext, canTransition } from '../lifecycle';
import { claimNotFound, validationFailed } from './claims';

/** Test/demo-only endpoints. No authentication, never affected by chaos. */
export function controlRoutes(app: FastifyInstance): void {
  const { store, config } = app;

  app.patch<{ Params: { id: string }; Body: { status?: unknown; note?: unknown } | undefined }>(
    '/__mock/claims/:id/status',
    async (request, reply) => {
      const status = request.body?.status;
      const note = request.body?.note;
      if (typeof status !== 'string' || !(CLAIM_STATUSES as readonly string[]).includes(status)) {
        return validationFailed(reply, { status: `must be one of ${CLAIM_STATUSES.join(', ')}` });
      }
      const claim = store.claims.get(request.params.id);
      if (!claim) return claimNotFound(reply, request.params.id);

      const to = status as ClaimStatus;
      if (!canTransition(claim.status, to)) {
        return reply.code(409).send({
          code: 'INVALID_TRANSITION',
          message: `Cannot move from ${claim.status} to ${to}`,
          allowed: allowedNext(claim.status),
        });
      }
      const at = new Date(config.now()).toISOString();
      const entry: StatusHistoryEntry = typeof note === 'string' && note.length > 0 ? { status: to, at, note } : { status: to, at };
      claim.status = to;
      claim.statusHistory.push(entry);
      claim.updatedAt = at;
      return claim;
    },
  );

  app.post('/__mock/reset', async (_request, reply) => {
    store.reset();
    return reply.code(204).send();
  });
}

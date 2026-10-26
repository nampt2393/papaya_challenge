import type { FastifyInstance } from 'fastify';

/** Adds an `x-request-id` header to every response. */
export function requestId(app: FastifyInstance): void {
  let counter = 0;
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('x-request-id', `req-${++counter}`);
  });
}

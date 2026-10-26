import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { MockConfig } from '../config';
import { createRandom } from '../random';

/** Adds random latency and transient 503s to /api/v1 routes. /__mock routes are never affected. */
export function chaos(app: FastifyInstance, config: MockConfig): void {
  if (!config.chaos) return;
  const random = createRandom(config.seed);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1')) return;
    const delay = config.delayMinMs + random() * (config.delayMaxMs - config.delayMinMs);
    if (delay > 0) await sleep(delay);
    if (random() < config.failureRate) {
      return reply.code(503).send({ code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' });
    }
  });
}

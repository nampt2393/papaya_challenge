import { maskApiKey } from '@insurance/partner-sdk';
import type { FastifyInstance } from 'fastify';
import { signToken } from '../auth/jwt';

export function authRoutes(app: FastifyInstance): void {
  const { config } = app;

  app.post('/api/v1/auth/token', async (request, reply) => {
    const body = request.body as { apiKey?: unknown } | undefined;
    const apiKey = body?.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Validation failed: apiKey', fields: { apiKey: 'required' } });
    }
    if (!config.apiKeys.includes(apiKey)) {
      return reply.code(401).send({ code: 'INVALID_API_KEY', message: 'Unknown API key' });
    }
    return {
      accessToken: signToken({ sub: maskApiKey(apiKey) }, config.jwtSecret, config.jwtTtlSec, config.now()),
      tokenType: 'Bearer',
      expiresIn: config.jwtTtlSec,
    };
  });
}

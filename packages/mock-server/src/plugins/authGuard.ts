import type { FastifyInstance } from 'fastify';
import { verifyToken } from '../auth/jwt';

/** Requires a valid, unexpired bearer token on every route in `scope`. */
export function authGuard(scope: FastifyInstance): void {
  const { config } = scope;
  scope.addHook('preHandler', async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const result = token === undefined ? undefined : verifyToken(token, config.jwtSecret, config.now());
    if (result?.ok) return;
    if (result?.reason === 'expired') {
      return reply.code(401).send({ code: 'TOKEN_EXPIRED', message: 'Access token has expired' });
    }
    return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Missing or invalid access token' });
  });
}

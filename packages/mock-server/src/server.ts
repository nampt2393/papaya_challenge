import multipart from '@fastify/multipart';
import { MAX_DOCUMENT_BYTES } from '@insurance/partner-sdk';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { loadConfig, type MockConfig } from './config';
import { authGuard } from './plugins/authGuard';
import { chaos } from './plugins/chaos';
import { requestId } from './plugins/requestId';
import { authRoutes } from './routes/auth';
import { claimRoutes } from './routes/claims';
import { controlRoutes } from './routes/control';
import { documentRoutes } from './routes/documents';
import { Store } from './store';

declare module 'fastify' {
  interface FastifyInstance {
    config: MockConfig;
    store: Store;
  }
}

/** Builds the mock API. `overrides` replace values read from the environment defaults. */
export async function buildServer(overrides: Partial<MockConfig> = {}): Promise<FastifyInstance> {
  const config: MockConfig = { ...loadConfig({}), ...overrides };
  const app = Fastify({ logger: false });
  app.decorate('config', config);
  app.decorate('store', new Store());

  requestId(app);
  chaos(app, config);

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode ?? 500;
    void reply.code(status).send({ code: status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR', message: error.message });
  });
  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({ code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` });
  });

  await app.register(multipart, { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } });

  authRoutes(app);
  controlRoutes(app);
  await app.register(async (scope) => {
    authGuard(scope);
    claimRoutes(scope);
    documentRoutes(scope);
  });
  return app;
}

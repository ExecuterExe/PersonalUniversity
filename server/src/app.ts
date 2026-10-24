import { ENGINE_VERSION } from '@ou/engine';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { checkGoogleConfig, type Config } from './config';
import type { Deps } from './domain/context';
import { AppError } from './errors';
import { registerRoutes } from './routes';

export function buildApp(config: Config, deps: Deps) {
  const app = Fastify();

  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Некорректные данные',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if ('statusCode' in error && error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: 'Не удалось прочитать запрос' });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    engineVersion: ENGINE_VERSION,
    googleConfigured: checkGoogleConfig(config).length === 0,
  }));

  registerRoutes(app, deps);
  return app;
}

import { ENGINE_VERSION } from '@ou/engine';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { checkGoogleConfig, type Config } from './config';
import type { Deps } from './domain/context';
import { AppError } from './errors';
import { registerGoogleRoutes } from './google/routes';
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
    // Журнал запросов выключен, поэтому серверные ошибки пишем сами — иначе они пропадут молча.
    console.error(`Ошибка на ${request.method} ${request.url}:`, error);
    return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    engineVersion: ENGINE_VERSION,
    googleConfigured: checkGoogleConfig(config).length === 0,
  }));

  // После любого изменения план отправляется в Google (с небольшой задержкой — см. index.ts).
  app.addHook('onResponse', async (req, reply) => {
    if (
      deps.afterChange &&
      req.method !== 'GET' &&
      req.url.startsWith('/api/') &&
      !req.url.startsWith('/api/google') &&
      reply.statusCode < 400
    ) {
      deps.afterChange();
    }
  });

  registerRoutes(app, deps);
  registerGoogleRoutes(app, deps, config);
  return app;
}

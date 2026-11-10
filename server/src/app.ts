import { ENGINE_VERSION } from '@ou/engine';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { checkGoogleConfig, type Config } from './config';
import type { Deps } from './domain/context';
import { AppError } from './errors';
import { GoogleError } from './google/api';
import { registerGoogleRoutes } from './google/routes';
import { registerRoutes } from './routes';
import { registerSystemRoutes } from './system/routes';
import { registerWeb } from './web';

/** Страницы самого сервиса: localhost на любом порту (рабочий режим, разработка, тестовый экземпляр). */
function isOwnOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function buildApp(config: Config, deps: Deps, options: { webDir?: string } = {}) {
  const app = Fastify();
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    return payload;
  });

  // Сервис работает в фоне постоянно, поэтому чужая открытая страница не должна
  // ничего менять через него: изменения принимаются только со страниц самого сервиса.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const origin = req.headers.origin;
    if (origin !== undefined && !isOwnOrigin(origin)) {
      return reply.status(403).send({ error: 'Запрос с чужой страницы отклонён' });
    }
  });

  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: error.message, details: error.details });
    }
    if (error instanceof GoogleError) {
      return reply.status(error.kind === 'auth' ? 401 : 503).send({ error: error.message });
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
    web: options.webDir !== undefined,
    // В рабочем режиме сервер работает в фоне: по номеру процесса его останавливает `npm run app:stop`.
    ...(options.webDir ? { pid: process.pid } : {}),
  }));

  // После любого изменения план отправляется в Google (с небольшой задержкой — см. index.ts).
  app.addHook('onResponse', async (req, reply) => {
    if (
      deps.afterChange &&
      req.method !== 'GET' &&
      req.url.startsWith('/api/') &&
      !req.url.startsWith('/api/google') &&
      !req.url.startsWith('/api/progress') &&
      req.url.split('?')[0] !== '/api/practice/prompt' &&
      reply.statusCode < 400
    ) {
      deps.afterChange();
    }
  });

  registerRoutes(app, deps);
  registerGoogleRoutes(app, deps, config);
  registerSystemRoutes(app);
  if (options.webDir) registerWeb(app, options.webDir);
  return app;
}

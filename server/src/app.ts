import { ENGINE_VERSION } from '@ou/engine';
import Fastify from 'fastify';
import { checkGoogleConfig, type Config } from './config';

export function buildApp(config: Config) {
  const app = Fastify();

  app.get('/api/health', async () => ({
    status: 'ok',
    engineVersion: ENGINE_VERSION,
    googleConfigured: checkGoogleConfig(config).length === 0,
  }));

  return app;
}

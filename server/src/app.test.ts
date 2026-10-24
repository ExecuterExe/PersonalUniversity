import { ENGINE_VERSION } from '@ou/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDeps } from './deps';

describe('GET /api/health', () => {
  it('отвечает, что сервер работает, и видит движок', async () => {
    const app = buildApp(loadConfig({}), createDeps({ dbPath: ':memory:' }));
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      engineVersion: ENGINE_VERSION,
      googleConfigured: false,
    });
  });

  it('сообщает, что Google настроен, когда ключи на месте', async () => {
    const app = buildApp(
      loadConfig({
        GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'secret',
      }),
      createDeps({ dbPath: ':memory:' }),
    );
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.json()).toMatchObject({ googleConfigured: true });
  });
});

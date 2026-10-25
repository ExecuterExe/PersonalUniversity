import { ENGINE_VERSION } from '@ou/engine';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      web: false,
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

describe('рабочий режим и защита от чужих страниц', () => {
  const webDir = mkdtempSync(join(tmpdir(), 'ou-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Мой университет</title>');
  writeFileSync(join(webDir, 'assets', 'app-1.js'), 'console.log(1)');
  const app = buildApp(loadConfig({ OU_SERVE_WEB: '1' }), createDeps({ dbPath: ':memory:' }), {
    webDir,
  });

  it('отдаёт интерфейс и файлы сборки с адреса сервера', async () => {
    const page = await app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('Мой университет');

    const script = await app.inject({ method: 'GET', url: '/assets/app-1.js' });
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.headers['cache-control']).toContain('immutable');
  });

  it('не выпускает за пределы сборки и не подменяет API страницей', async () => {
    const outside = await app.inject({ method: 'GET', url: '/..%2f..%2fpackage.json' });
    expect(outside.statusCode).toBe(404);
    const api = await app.inject({ method: 'GET', url: '/api/nothing' });
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toContain('application/json');
  });

  it('после входа через Google возвращает на адрес самого сервера', () => {
    expect(loadConfig({ OU_SERVE_WEB: '1', SERVER_PORT: '4100' }).appUrl).toBe(
      'http://localhost:4100',
    );
  });

  it('принимает изменения только со страниц самого сервиса', async () => {
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/timer/pause',
      headers: { origin: 'https://example.com' },
    });
    expect(foreign.statusCode).toBe(403);

    const own = await app.inject({
      method: 'POST',
      url: '/api/timer/pause',
      headers: { origin: 'http://localhost:4100' },
    });
    expect(own.statusCode).not.toBe(403);
  });
});

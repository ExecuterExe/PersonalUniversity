import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadConfig, readEnvFile } from './config';
import { createDeps } from './deps';
import { runChecks } from './domain/decisions';
import { backupIfDue } from './domain/maintenance';

const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));
const CHECK_INTERVAL_MS = 15 * 60_000;

readEnvFile();
const config = loadConfig();
const deps = createDeps({ dbPath: `${DATA_DIR}ou.sqlite` });
const app = buildApp(config, deps);

/** Фоновые проверки и резервная копия — при запуске и каждые 15 минут, пока сервер открыт. */
async function background(): Promise<void> {
  try {
    backupIfDue(deps, `${DATA_DIR}backups`);
    await runChecks(deps);
  } catch (error) {
    console.error('Фоновая проверка не удалась:', error);
  }
}

// Только localhost: сервис не должен быть виден другим устройствам в сети.
await app.listen({ host: 'localhost', port: config.port });
console.log(`Сервер «Мой университет» запущен: http://localhost:${config.port}`);
await background();
setInterval(() => void background(), CHECK_INTERVAL_MS);

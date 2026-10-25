import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadConfig, readEnvFile } from './config';
import { createDeps } from './deps';
import { runChecks } from './domain/decisions';
import { backupIfDue } from './domain/maintenance';
import { syncGoogle } from './google/sync';

const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));
const CHECK_INTERVAL_MS = 15 * 60_000;
const SYNC_DELAY_MS = 3_000;

readEnvFile();
const config = loadConfig();

// Только для проверки: отдельная база (OU_DB_PATH) и перематываемые часы (POST /api/dev/clock).
const testMode = Boolean(process.env.OU_DB_PATH);
const dbPath = process.env.OU_DB_PATH || `${DATA_DIR}ou.sqlite`;
let clockShift = 0;
const now = () => Date.now() + clockShift;
const deps = createDeps({ dbPath, config, now });
if (testMode) console.log(`Тестовый запуск: база ${dbPath}`);

/** Изменения идут в Google пачкой: через несколько секунд после последнего. */
let syncTimer: NodeJS.Timeout | undefined;
deps.afterChange = () => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncGoogle(deps).catch((error: unknown) =>
      console.error('Синхронизация с Google не удалась:', error),
    );
  }, SYNC_DELAY_MS);
};

const app = buildApp(config, deps);

if (testMode) {
  app.post('/api/dev/clock', async (req) => {
    const { iso } = req.body as { iso: string };
    clockShift += Date.parse(iso) - now();
    return { now: new Date(now()).toISOString() };
  });
}

/** При запуске и каждые 15 минут, пока сервер открыт: Google, проверки, резервная копия. */
async function background(): Promise<void> {
  try {
    if (!testMode) backupIfDue(deps, `${DATA_DIR}backups`);
    await syncGoogle(deps);
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

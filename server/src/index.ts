import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadConfig, readEnvFile } from './config';
import { createDeps } from './deps';
import { runChecks } from './domain/decisions';
import { backupIfDue } from './domain/maintenance';
import { pauseForSleep, pauseIfAway } from './domain/sessions';
import { syncGoogle, syncIfPlanChanged } from './google/sync';

const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));
const WEB_DIR = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const CHECK_INTERVAL_MS = 15 * 60_000;
const SYNC_DELAY_MS = 3_000;
const HEARTBEAT_MS = 30_000;
/** Сердцебиение пропало дольше этого — компьютер спал, был выключен или сервис не работал. */
const SLEEP_GAP_MS = 2 * 60_000;
/** Столько без запросов от страницы — считаем, что её закрыли. */
const AWAY_MS = 10 * 60_000;
const HEARTBEAT_KEY = 'heartbeat';

readEnvFile();
const config = loadConfig();

// Только для проверки: отдельная база (OU_DB_PATH) и перематываемые часы (POST /api/dev/clock).
const testMode = Boolean(process.env.OU_DB_PATH);
const dbPath = process.env.OU_DB_PATH || `${DATA_DIR}ou.sqlite`;
let clockShift = 0;
const now = () => Date.now() + clockShift;
const deps = createDeps({ dbPath, config, now });
if (testMode) console.log(`Тестовый запуск: база ${dbPath}`);

/**
 * Изменения идут в Google пачкой — через несколько секунд после последнего — и только если
 * поменялось расписание: пауза таймера или итог занятия календарь не трогают.
 */
let syncTimer: NodeJS.Timeout | undefined;
deps.afterChange = () => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncIfPlanChanged(deps).catch((error: unknown) =>
      console.error('Синхронизация с Google не удалась:', error),
    );
  }, SYNC_DELAY_MS);
};

const app = buildApp(config, deps, config.serveWeb ? { webDir: WEB_DIR } : {});

/** Последний запрос от страницы сервиса: по нему видно, что её закрыли. */
let lastSeen = now();
app.addHook('onRequest', async (req) => {
  if (req.url.startsWith('/api/') && req.url !== '/api/health') lastSeen = now();
});

/**
 * Раз в полминуты сервер отмечается в базе. Большой разрыв между отметками — сон или
 * выключение (в том числе до этого запуска): идущее занятие встаёт на паузу с того момента.
 */
function heartbeat(): void {
  try {
    const t = now();
    const last = Number(deps.store.getMeta(HEARTBEAT_KEY) ?? 0);
    if (last > 0 && t - last > SLEEP_GAP_MS) pauseForSleep(deps, last, t);
    else pauseIfAway(deps, lastSeen, AWAY_MS);
    deps.store.setMeta(HEARTBEAT_KEY, String(t));
  } catch (error) {
    console.error('Отметка о работе не удалась:', error);
  }
}

if (testMode) {
  app.post('/api/dev/clock', async (req) => {
    const { iso, sleep } = req.body as { iso: string; sleep?: boolean };
    clockShift += Date.parse(iso) - now();
    // Перемотка часов — не сон компьютера и не закрытая страница; `sleep` — как раз сон.
    if (!sleep) {
      deps.store.setMeta(HEARTBEAT_KEY, String(now()));
      lastSeen = now();
    }
    return { now: new Date(now()).toISOString() };
  });
}

/**
 * Каждые 15 минут, пока сервер работает: пропуски, конфликты, резервная копия. В Google фоновые
 * проверки не ходят — с ним сервис сверяется при запуске, после правок расписания и по кнопке.
 */
async function background(): Promise<void> {
  try {
    if (!testMode) backupIfDue(deps, `${DATA_DIR}backups`);
    await runChecks(deps);
  } catch (error) {
    console.error('Фоновая проверка не удалась:', error);
  }
}

// Только localhost: сервис не должен быть виден другим устройствам в сети.
try {
  await app.listen({ host: 'localhost', port: config.port });
} catch (error) {
  // Например, ярлык нажали дважды: сервер уже работает, второй не нужен.
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.log(
      `Порт ${config.port} уже занят — похоже, сервер уже запущен. Этот экземпляр не нужен.`,
    );
    process.exit(0);
  }
  throw error;
}
console.log(`Сервер «Мой университет» запущен: http://localhost:${config.port}`);
// Отметки — только у того экземпляра, который действительно работает.
heartbeat();
setInterval(heartbeat, HEARTBEAT_MS);
// При запуске — одна синхронизация: подхватить правки, сделанные в Google, пока сервис не работал.
try {
  const report = await syncGoogle(deps);
  if (report?.copiesRemoved) {
    console.log(`Google: убраны лишние копии событий — ${report.copiesRemoved}`);
  }
} catch (error) {
  console.error('Синхронизация с Google не удалась:', error);
}
await background();
setInterval(() => void background(), CHECK_INTERVAL_MS);

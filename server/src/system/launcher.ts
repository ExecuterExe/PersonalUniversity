// Запуск «Моего университета» одним нажатием: собрать интерфейс, если он устарел, поднять сервер
// в фоне и открыть «Сегодня» в браузере. Его вызывают ярлык на рабочем столе и автозапуск.
//
//   npm run app            — открыть (запустит сервер, если он не работает)
//   npm run app:stop       — остановить сервер, работающий в фоне
//   npm run app:install    — ярлык на рабочем столе и автозапуск с Windows
//   npm run app:uninstall  — убрать оба ярлыка
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, readEnvFile } from '../config';
import {
  createShortcut,
  removeShortcut,
  shortcutPath,
  shortcutsSupported,
  showError,
} from './shortcuts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WEB = join(ROOT, 'web');
const DIST_INDEX = join(WEB, 'dist', 'index.html');
const LOG_DIR = join(ROOT, 'data', 'logs');
const LOG_FILE = join(LOG_DIR, 'server.log');
const LOCK_FILE = join(ROOT, 'data', 'launch.lock');
const LOG_LIMIT_BYTES = 1_000_000;
const START_TIMEOUT_MS = 60_000;

readEnvFile();
const config = loadConfig({ ...process.env, OU_SERVE_WEB: '1' });
const base = `http://localhost:${config.port}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Health {
  web?: boolean;
  pid?: number;
}

async function health(): Promise<Health | null> {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

function newestChange(dir: string): number {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile())
      newest = Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs);
  }
  return newest;
}

/** Интерфейс собирается заново, только если исходники новее сборки. */
function ensureBuilt(): void {
  const sources = Math.max(
    newestChange(join(WEB, 'src')),
    newestChange(join(WEB, 'public')),
    newestChange(join(ROOT, 'engine', 'src')),
    statSync(join(WEB, 'index.html')).mtimeMs,
  );
  if (existsSync(DIST_INDEX) && statSync(DIST_INDEX).mtimeMs >= sources) return;
  console.log('Собираю интерфейс…');
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const result = spawnSync(process.execPath, [vite, 'build'], {
    cwd: WEB,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(
      'Не удалось собрать интерфейс — запусти `npm run build -w @ou/web` и посмотри ошибку.',
    );
}

/** Сервер работает отдельным фоновым процессом без окна; журнал — в data/logs/server.log. */
function startServer(): void {
  mkdirSync(LOG_DIR, { recursive: true });
  if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_LIMIT_BYTES) {
    renameSync(LOG_FILE, join(LOG_DIR, 'server.old.log'));
  }
  const log = openSync(LOG_FILE, 'a');
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'server', 'src', 'index.ts')],
    {
      cwd: ROOT,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: { ...process.env, OU_SERVE_WEB: '1' },
    },
  );
  child.unref();
}

/**
 * Сервер запускает только один запуск: ярлык часто нажимают дважды, а при входе в Windows
 * автозапуск может совпасть с нажатием. Остальные просто ждут, пока сервер ответит.
 */
function takeLock(): boolean {
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  try {
    closeSync(openSync(LOCK_FILE, 'wx'));
    return true;
  } catch {
    // Замок от запуска, который так и не довёл дело до конца, — устарел.
    if (Date.now() - statSync(LOCK_FILE).mtimeMs < START_TIMEOUT_MS) return false;
    rmSync(LOCK_FILE, { force: true });
    return takeLock();
  }
}

async function waitForServer(): Promise<Health | null> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const running = await health();
    if (running) return running;
    await sleep(300);
  }
  return null;
}

function openBrowser(url: string): void {
  // Для проверки запускателя без открытия настоящего браузера.
  if (process.env.OU_NO_BROWSER) {
    console.log(`Открыл бы: ${url}`);
    return;
  }
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function open(): Promise<void> {
  const running = await health();
  if (running && !running.web) {
    // Работает режим разработки (npm run dev): у него свой адрес интерфейса.
    openBrowser(`${loadConfig().appUrl}/#today`);
    return;
  }
  if (!running) {
    const starter = takeLock();
    try {
      if (starter) {
        ensureBuilt();
        startServer();
      }
      if (!(await waitForServer())) {
        throw new Error(`Сервер не запустился за минуту. Подробности — в журнале:\n${LOG_FILE}`);
      }
    } finally {
      if (starter) rmSync(LOCK_FILE, { force: true });
    }
  }
  openBrowser(`${base}/#today`);
}

async function stop(): Promise<void> {
  const running = await health();
  if (!running?.pid) {
    console.log(
      running ? 'Работает режим разработки — останови его в его окне.' : 'Сервер не работает.',
    );
    return;
  }
  process.kill(running.pid);
  for (let i = 0; i < 50 && (await health()); i++) await sleep(200);
  console.log('Сервер остановлен.');
}

function install(autostart: boolean): void {
  if (!shortcutsSupported) throw new Error('Ярлыки умеет создавать только Windows.');
  ensureBuilt();
  createShortcut('desktop');
  console.log(`Ярлык на рабочем столе: ${shortcutPath('desktop')}`);
  if (autostart) {
    createShortcut('startup');
    console.log(`Автозапуск при входе в Windows: ${shortcutPath('startup')}`);
  } else {
    removeShortcut('startup');
  }
}

function uninstall(): void {
  removeShortcut('desktop');
  removeShortcut('startup');
  console.log('Ярлык и автозапуск убраны.');
}

const [command = 'open', ...flags] = process.argv.slice(2);
try {
  if (command === 'open') await open();
  else if (command === 'stop') await stop();
  else if (command === 'install') install(!flags.includes('--no-autostart'));
  else if (command === 'uninstall') uninstall();
  else throw new Error(`Неизвестная команда: ${command}. Есть: open, stop, install, uninstall.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  // Ярлык запускает свёрнутое окно, которое тут же закроется, — ошибку нужно показать.
  if (command === 'open') showError(message);
  process.exitCode = 1;
}

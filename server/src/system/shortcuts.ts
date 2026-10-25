// Ярлыки Windows: на рабочем столе и в автозагрузке. Создаются через PowerShell (WScript.Shell),
// потому что у Node нет своего способа писать .lnk.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ShortcutPlace = 'desktop' | 'startup';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const LAUNCHER = join(ROOT, 'server', 'src', 'system', 'launcher.ts');
const ICON = join(ROOT, 'web', 'public', 'favicon.ico');
const NAME = 'Мой университет.lnk';

export const shortcutsSupported = process.platform === 'win32';

/** Строка для PowerShell в одинарных кавычках. */
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

function powershell(script: string): string {
  // Вывод — в UTF-8, иначе русские пути придут в кодировке консоли; без полосок прогресса.
  const full = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; ${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

let folders: Record<ShortcutPlace, string> | undefined;

/**
 * Рабочий стол и папка автозагрузки текущего пользователя (с учётом OneDrive).
 * OU_SHORTCUT_DIR — подмена для тестового экземпляра, чтобы проверка не трогала настоящие ярлыки.
 */
function placeDir(place: ShortcutPlace): string {
  const override = process.env.OU_SHORTCUT_DIR;
  if (override) {
    const dir = join(override, place);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  folders ??= JSON.parse(
    powershell(
      "@{ desktop = [Environment]::GetFolderPath('Desktop'); startup = [Environment]::GetFolderPath('Startup') } | ConvertTo-Json -Compress",
    ),
  ) as Record<ShortcutPlace, string>;
  return folders[place];
}

export const shortcutPath = (place: ShortcutPlace) => join(placeDir(place), NAME);

export const hasShortcut = (place: ShortcutPlace) => existsSync(shortcutPath(place));

/** Ярлык запускает сервер, если он ещё не работает, и открывает «Сегодня». */
export function createShortcut(place: ShortcutPlace): void {
  powershell(
    [
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(shortcutPath(place))})`,
      `$s.TargetPath = ${quote(process.execPath)}`,
      `$s.Arguments = ${quote(`--import tsx "${LAUNCHER}" open`)}`,
      `$s.WorkingDirectory = ${quote(ROOT)}`,
      `$s.IconLocation = ${quote(`${ICON},0`)}`,
      // Свёрнутое окно: запускатель работает пару секунд и закрывается сам.
      '$s.WindowStyle = 7',
      `$s.Description = ${quote('Открыть «Мой университет»')}`,
      '$s.Save()',
    ].join('; '),
  );
}

export function removeShortcut(place: ShortcutPlace): void {
  rmSync(shortcutPath(place), { force: true });
}

/** Сообщение об ошибке, когда окна консоли не видно (запуск ярлыком). */
export function showError(message: string): void {
  if (!shortcutsSupported) return;
  powershell(
    `Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show(${quote(message)}, ${quote('Мой университет')})`,
  );
}

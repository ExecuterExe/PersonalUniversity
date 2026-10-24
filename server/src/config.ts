import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  /** Куда вернуть браузер после входа через Google. */
  appUrl: string;
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
}

const ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));
const DEFAULT_PORT = 4100;

/** Загружает .env из корня проекта в process.env. Возвращает false, если файла нет. */
export function readEnvFile(path: string = ENV_PATH): boolean {
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Не общий PORT: его выставляют многие инструменты запуска, и сервер занял бы чужой порт.
  const port = env.SERVER_PORT ? Number(env.SERVER_PORT) : DEFAULT_PORT;
  return {
    port,
    appUrl: env.APP_URL || 'http://localhost:5173',
    google: {
      clientId: env.GOOGLE_CLIENT_ID?.trim() ?? '',
      clientSecret: env.GOOGLE_CLIENT_SECRET?.trim() ?? '',
      redirectUri: env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/auth/google/callback`,
    },
  };
}

/** Проблемы в настройках Google человеческим языком; пустой список — всё готово. */
export function checkGoogleConfig(config: Config): string[] {
  const problems: string[] = [];
  const { clientId, clientSecret, redirectUri } = config.google;

  if (!clientId) {
    problems.push('GOOGLE_CLIENT_ID не заполнен');
  } else if (!clientId.endsWith('.apps.googleusercontent.com')) {
    problems.push(
      'GOOGLE_CLIENT_ID не похож на Client ID Google: он заканчивается на .apps.googleusercontent.com',
    );
  }

  if (!clientSecret) {
    problems.push('GOOGLE_CLIENT_SECRET не заполнен');
  }

  const expectedRedirect = `http://localhost:${config.port}/auth/google/callback`;
  if (redirectUri !== expectedRedirect) {
    problems.push(
      `GOOGLE_REDIRECT_URI должен быть ${expectedRedirect} — ровно так же он указывается в Google Cloud`,
    );
  }

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    problems.push(`SERVER_PORT должен быть числом от 1 до 65535, сейчас: ${String(config.port)}`);
  }

  return problems;
}

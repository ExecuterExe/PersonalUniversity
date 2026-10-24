import { describe, expect, it } from 'vitest';
import { checkGoogleConfig, loadConfig } from './config';

const VALID_ENV = {
  SERVER_PORT: '4100',
  GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:4100/auth/google/callback',
};

describe('настройки', () => {
  it('без .env берёт значения по умолчанию', () => {
    const config = loadConfig({});
    expect(config.port).toBe(4100);
    expect(config.appUrl).toBe('http://localhost:5173');
    expect(config.google.redirectUri).toBe('http://localhost:4100/auth/google/callback');
  });

  it('заполненные ключи Google проходят проверку', () => {
    expect(checkGoogleConfig(loadConfig(VALID_ENV))).toEqual([]);
  });

  it('называет каждый пустой ключ', () => {
    const problems = checkGoogleConfig(loadConfig({}));
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('GOOGLE_CLIENT_ID');
    expect(problems.join('\n')).toContain('GOOGLE_CLIENT_SECRET');
  });

  it('замечает Client ID не того формата', () => {
    const problems = checkGoogleConfig(loadConfig({ ...VALID_ENV, GOOGLE_CLIENT_ID: 'abc' }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('.apps.googleusercontent.com');
  });

  it('замечает адрес возврата, не совпадающий с портом', () => {
    const problems = checkGoogleConfig(loadConfig({ ...VALID_ENV, SERVER_PORT: '5000' }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('http://localhost:5000/auth/google/callback');
  });

  it('замечает некорректный порт', () => {
    const problems = checkGoogleConfig(loadConfig({ ...VALID_ENV, SERVER_PORT: 'abc' }));
    expect(problems.some((p) => p.startsWith('SERVER_PORT'))).toBe(true);
  });

  it('не реагирует на общий PORT от инструментов запуска', () => {
    expect(loadConfig({ PORT: '5173' }).port).toBe(4100);
  });
});

import { useEffect, useState } from 'react';

interface Health {
  status: string;
  engineVersion: string;
  googleConfigured: boolean;
}

interface GoogleStatus {
  connected: boolean;
  email: string | null;
  needsReauth: boolean;
  lastSyncError: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// Временная страница: интерфейс появится на этапе 4. Пока — проверка связи и вход в Google.
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const result = new URLSearchParams(window.location.search).get('google');

  useEffect(() => {
    Promise.all([getJson<Health>('/api/health'), getJson<GoogleStatus>('/api/google/status')])
      .then(([h, g]) => {
        setHealth(h);
        setGoogle(g);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main>
      <h1>Мой университет</h1>
      {error && <p>Сервер недоступен: {error}</p>}
      {!error && !health && <p>Проверяю сервер…</p>}
      {result === 'denied' && <p>Вход в Google отменён.</p>}
      {result === 'expired' && <p>Ссылка входа устарела — попробуй ещё раз.</p>}
      {result === 'error' && <p>Google не подтвердил вход — попробуй ещё раз.</p>}
      {health && (
        <ul>
          <li>Сервер: {health.status === 'ok' ? 'работает' : health.status}</li>
          <li>Движок: версия {health.engineVersion}</li>
          <li>
            Google: {!health.googleConfigured && 'ключи ещё не заданы'}
            {health.googleConfigured && google?.connected && !google.needsReauth && (
              <>подключён ({google.email})</>
            )}
            {health.googleConfigured && google?.needsReauth && (
              <a href="/auth/google">доступ истёк — войти заново</a>
            )}
            {health.googleConfigured && google && !google.connected && (
              <a href="/auth/google">подключить Google Календарь</a>
            )}
          </li>
          {google?.lastSyncError && <li>Последняя ошибка: {google.lastSyncError}</li>}
        </ul>
      )}
    </main>
  );
}

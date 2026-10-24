import { useEffect, useState } from 'react';

interface Health {
  status: string;
  engineVersion: string;
  googleConfigured: boolean;
}

// Временная страница этапа 0: показывает, что интерфейс, сервер и движок связаны.
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main>
      <h1>Мой университет</h1>
      {error && <p>Сервер недоступен: {error}</p>}
      {!error && !health && <p>Проверяю сервер…</p>}
      {health && (
        <ul>
          <li>Сервер: {health.status === 'ok' ? 'работает' : health.status}</li>
          <li>Движок: версия {health.engineVersion}</li>
          <li>Google: {health.googleConfigured ? 'ключи на месте' : 'ключи ещё не заданы'}</li>
        </ul>
      )}
    </main>
  );
}

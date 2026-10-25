import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, errorText } from './api';

/** Счётчик изменений: после любого действия данные на всех экранах загружаются заново. */
export const RefreshContext = createContext<{ version: number; refresh: () => void }>({
  version: 0,
  refresh: () => undefined,
});

export function useRefresh() {
  return useContext(RefreshContext);
}

export function useApi<T>(url: string | null) {
  const { version } = useRefresh();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    api
      .get<T>(url)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [url, version, local]);

  const reload = useCallback(() => setLocal((n) => n + 1), []);
  return { data, error, reload };
}

/**
 * Выполнить действие: показывает ошибку, после успеха обновляет все экраны.
 * Возвращает результат или undefined, если не получилось.
 */
export function useAction() {
  const { refresh } = useRefresh();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        refresh();
        return result;
      } catch (e) {
        setError(errorText(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  return { run, error, setError, busy };
}

/** Текущее время, обновляется раз в интервал — для таймера и «сейчас». */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Экран из адреса: #today, #schedule … */
export function useHashRoute(fallback: string): [string, (route: string) => void] {
  const read = () => window.location.hash.replace(/^#/, '') || fallback;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  });
  return [route, (next: string) => (window.location.hash = next)];
}

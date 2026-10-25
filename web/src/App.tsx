import { useCallback, useEffect, useState } from 'react';
import { Loading } from './components';
import { RefreshContext, useApi, useHashRoute, useRefresh } from './hooks';
import { DecisionsScreen } from './screens/Decisions';
import { DisciplinesScreen } from './screens/Disciplines';
import { ScheduleScreen } from './screens/Schedule';
import { SemesterScreen } from './screens/Semester';
import { SettingsScreen } from './screens/Settings';
import { SetupWizard, storedStep } from './screens/Setup';
import { StatsScreen } from './screens/Stats';
import { TodayScreen } from './screens/Today';
import type { GoogleStatus, Today } from './types';

const ROUTES = [
  ['today', 'Сегодня'],
  ['schedule', 'Расписание'],
  ['decisions', 'Решения'],
  ['disciplines', 'Дисциплины'],
  ['semester', 'Семестр'],
  ['stats', 'Статистика'],
  ['settings', 'Настройки'],
] as const;

const GOOGLE_RESULT: Record<string, string> = {
  connected: 'Google Календарь подключён.',
  denied: 'Вход в Google отменён.',
  expired: 'Ссылка входа устарела — попробуй ещё раз.',
  error: 'Google не подтвердил вход — попробуй ещё раз.',
};

// Технический интерфейс этапа 4: все сценарии руками. Дизайн — на этапе 5.
function Shell() {
  const { refresh } = useRefresh();
  const { data: today, error } = useApi<Today>('/api/today');
  const { data: google } = useApi<GoogleStatus>('/api/google/status');
  const [route, navigate] = useHashRoute('today');
  const [wizardStep, setWizardStep] = useState<number | null>(storedStep);
  const googleResult = new URLSearchParams(window.location.search).get('google');

  // Раз в минуту — свежие данные: пропуски, конфликты, таймер.
  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Сервер ещё запускается или перезапускается — пробуем снова через пару секунд.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(refresh, 3000);
    return () => clearTimeout(id);
  }, [error, refresh]);

  if (!today) return <Loading error={error} />;
  const wizard = wizardStep ?? (today.setup.settingsSaved ? null : 0);
  const semesterIds =
    today.semester?.disciplines.filter((d) => d.frequency !== null).map((d) => d.id) ?? [];

  return (
    <div className="app">
      <header>
        <h1>Мой университет</h1>
        {google?.needsReauth && (
          <span className="error">
            Доступ к Google истёк — <a href="/auth/google">войти заново</a>
          </span>
        )}
        {google?.connected && !google.needsReauth && google.lastSyncError && (
          <span className="muted">Google: {google.lastSyncError}</span>
        )}
      </header>
      {googleResult && GOOGLE_RESULT[googleResult] && (
        <p className="warning">{GOOGLE_RESULT[googleResult]}</p>
      )}

      {wizard !== null ? (
        <SetupWizard
          today={today}
          step={wizard}
          setStep={setWizardStep}
          onFinish={() => {
            setWizardStep(null);
            navigate('semester');
          }}
        />
      ) : (
        <>
          <nav>
            {ROUTES.map(([id, title]) => (
              <a key={id} href={`#${id}`} className={route === id ? 'active' : ''}>
                {title}
                {id === 'decisions' && today.openDecisions > 0 && (
                  <span className="badge">{today.openDecisions}</span>
                )}
              </a>
            ))}
          </nav>
          {route === 'today' && <TodayScreen today={today} />}
          {route === 'schedule' && <ScheduleScreen today={today} />}
          {route === 'decisions' && <DecisionsScreen today={today} />}
          {route === 'disciplines' && <DisciplinesScreen semesterDisciplineIds={semesterIds} />}
          {route === 'semester' && <SemesterScreen today={today} />}
          {route === 'stats' && <StatsScreen />}
          {route === 'settings' && <SettingsScreen />}
        </>
      )}
    </div>
  );
}

export function App() {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return (
    <RefreshContext.Provider value={{ version, refresh }}>
      <Shell />
    </RefreshContext.Provider>
  );
}

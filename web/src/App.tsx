import {
  BarChart3,
  BookOpen,
  CalendarDays,
  GraduationCap,
  Inbox,
  Layers,
  Settings,
  Sun,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { useCallback, useEffect, useState } from 'react';
import { ColorsProvider } from './colors';
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
import { Alert, Loading } from './ui';

const ROUTES = [
  { id: 'today', title: 'Сегодня', icon: Sun },
  { id: 'schedule', title: 'Расписание', icon: CalendarDays },
  { id: 'decisions', title: 'Решения', icon: Inbox },
  { id: 'disciplines', title: 'Дисциплины', icon: BookOpen },
  { id: 'semester', title: 'Семестр', icon: Layers },
  { id: 'stats', title: 'Статистика', icon: BarChart3 },
  { id: 'settings', title: 'Настройки', icon: Settings },
] as const;

const GOOGLE_RESULT: Record<string, { tone: 'success' | 'warning'; text: string }> = {
  connected: { tone: 'success', text: 'Google Календарь подключён.' },
  denied: { tone: 'warning', text: 'Вход в Google отменён.' },
  expired: { tone: 'warning', text: 'Ссылка входа устарела — попробуй ещё раз.' },
  error: { tone: 'warning', text: 'Google не подтвердил вход — попробуй ещё раз.' },
};

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <GraduationCap size={21} />
      </span>
      Мой университет
    </div>
  );
}

function Shell() {
  const { refresh } = useRefresh();
  const { data: today, error } = useApi<Today>('/api/today');
  const { data: google } = useApi<GoogleStatus>('/api/google/status');
  const [route, navigate] = useHashRoute('today');
  const [wizardStep, setWizardStep] = useState<number | null>(storedStep);
  const googleResult =
    GOOGLE_RESULT[new URLSearchParams(window.location.search).get('google') ?? ''];

  // Раз в минуту — свежие данные: пропуски, конфликты, таймер.
  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Сервер ещё запускается или перезапускается — пробуем снова каждые пару секунд, пока не ответит.
  useEffect(() => {
    if (!error) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [error, refresh]);

  if (!today) {
    return (
      <div className="wizard">
        <Brand />
        {error ? <Alert tone="warning">Жду, пока запустится сервер…</Alert> : <Loading />}
      </div>
    );
  }

  const wizard = wizardStep ?? (today.setup.settingsSaved ? null : 0);
  if (wizard !== null) {
    return (
      <div className="wizard">
        <Brand />
        <SetupWizard
          today={today}
          step={wizard}
          setStep={setWizardStep}
          onFinish={() => {
            setWizardStep(null);
            navigate('semester');
          }}
        />
      </div>
    );
  }

  // Часы компьютера в другом поясе (например, в поездке): говорим, по какому поясу всё в сервисе.
  const service = DateTime.fromMillis(today.now, { zone: today.timezone });
  const mine = DateTime.fromMillis(today.now);
  const zoneMismatch = service.offset !== mine.offset;

  const semesterIds =
    today.semester?.disciplines.filter((d) => d.frequency !== null).map((d) => d.id) ?? [];
  const week = today.semester?.currentWeek;

  return (
    <div className="layout">
      <aside className="sidebar">
        <Brand />
        {ROUTES.map(({ id, title, icon: Icon }) => (
          <a key={id} href={`#${id}`} className={`nav-item ${route === id ? 'active' : ''}`}>
            <Icon size={19} />
            {title}
            {id === 'decisions' && today.openDecisions > 0 && (
              <span className="count">{today.openDecisions}</span>
            )}
          </a>
        ))}
        <div className="sidebar-footer">
          {today.semester ? (
            <>
              {week !== null && week !== undefined && week > 0
                ? `Неделя ${week} из ${today.semester.fullWeeks}`
                : 'Семестр начинается'}
              <br />
              <span className="faint">
                до {today.semester.endDate.split('-').reverse().join('.')}
              </span>
            </>
          ) : (
            'Семестр ещё не составлен'
          )}
        </div>
      </aside>
      <main className="main">
        <div
          className="stack"
          style={{
            marginBottom:
              googleResult || google?.needsReauth || google?.lastSyncError || zoneMismatch ? 20 : 0,
          }}
        >
          {zoneMismatch && (
            <Alert tone="info">
              Часы компьютера показывают {mine.toFormat('HH:mm')}, а расписание ведётся по поясу{' '}
              {today.timezone} — там сейчас {service.toFormat('HH:mm')}. Все времена в сервисе — по
              этому поясу; в Google Календаре занятия видны по местному времени.
            </Alert>
          )}
          {googleResult && <Alert tone={googleResult.tone}>{googleResult.text}</Alert>}
          {google?.needsReauth && (
            <Alert tone="warning">
              Доступ к Google истёк — <a href="/auth/google">войти заново</a>. Пока сервис работает
              с последними данными календаря.
            </Alert>
          )}
          {google?.connected && !google.needsReauth && google.lastSyncError && (
            <Alert tone="warning">Google: {google.lastSyncError}</Alert>
          )}
        </div>
        {route === 'today' && <TodayScreen today={today} />}
        {route === 'schedule' && <ScheduleScreen today={today} />}
        {route === 'decisions' && <DecisionsScreen today={today} />}
        {route === 'disciplines' && <DisciplinesScreen semesterDisciplineIds={semesterIds} />}
        {route === 'semester' && <SemesterScreen today={today} />}
        {route === 'stats' && <StatsScreen today={today} />}
        {route === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}

export function App() {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return (
    <RefreshContext.Provider value={{ version, refresh }}>
      <ColorsProvider>
        <Shell />
      </ColorsProvider>
    </RefreshContext.Provider>
  );
}

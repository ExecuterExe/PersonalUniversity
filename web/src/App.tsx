import {
  BarChart3,
  BookOpen,
  CalendarDays,
  GraduationCap,
  Inbox,
  Layers,
  NotebookPen,
  Settings,
  Sun,
  Trophy,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { useCallback, useEffect, useState } from 'react';
import { ColorsProvider } from './colors';
import { ConfirmProvider } from './confirm';
import { RefreshContext, useApi, useHashRoute, useRefresh } from './hooks';
import { DecisionsScreen } from './screens/Decisions';
import { DisciplinesScreen } from './screens/Disciplines';
import { ScheduleScreen } from './screens/Schedule';
import { SemesterScreen } from './screens/Semester';
import { SettingsScreen } from './screens/Settings';
import { SetupWizard, storedStep } from './screens/Setup';
import { StatsScreen } from './screens/Stats';
import { TodayScreen } from './screens/Today';
import { TimeUpDialog } from './screens/Focus';
import { PracticeScreen } from './screens/Practice';
import { ProgressMini, ProgressNotice, ProgressScreen } from './screens/Progress';
import type { GoogleStatus, Today, StudyProgress } from './types';
import { Alert, Loading, Progress } from './ui';

const ROUTES = [
  { id: 'today', title: 'Сегодня', icon: Sun },
  { id: 'schedule', title: 'Расписание', icon: CalendarDays },
  { id: 'decisions', title: 'Решения', icon: Inbox },
  { id: 'disciplines', title: 'Дисциплины', icon: BookOpen },
  { id: 'practice', title: 'Практика', icon: NotebookPen },
  { id: 'progress', title: 'Прогресс', icon: Trophy },
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

/** Фон за всем интерфейсом: плывущее сияние, а в режиме погружения — ещё и звёзды. */
function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <span className="glow g1" />
      <span className="glow g2" />
      <span className="glow g3" />
      <span className="stars" />
    </div>
  );
}

function SemesterBadge({ semester }: { semester: NonNullable<Today['semester']> }) {
  const week = semester.currentWeek;
  const started = week !== null && week > 0;
  return (
    <div className="sidebar-footer">
      <div className="row between">
        <span>{started ? `Неделя ${week} из ${semester.fullWeeks}` : 'Семестр начинается'}</span>
        {started && <strong>{Math.round((week / semester.fullWeeks) * 100)}%</strong>}
      </div>
      <Progress
        value={started ? week / semester.fullWeeks : 0}
        label="Сколько недель семестра прошло"
      />
      <span className="faint">до {semester.endDate.split('-').reverse().join('.')}</span>
    </div>
  );
}

/** Пояс Google не совпадает с поясом сервиса: объяснить сдвиг на примере и где его поправить. */
function GoogleZoneWarning({ googleZone, today }: { googleZone: string; today: Today }) {
  const example = today.next?.start ?? today.now;
  const at = (zone: string, format: string) =>
    DateTime.fromMillis(example, { zone }).toFormat(format);
  return (
    <Alert tone="warning">
      Google Календарь показывает время по поясу {googleZone} ({at(googleZone, "'UTC'Z")}), а
      расписание сервиса ведётся по {today.timezone} ({at(today.timezone, "'UTC'Z")}). Поэтому в
      Google занятия сдвинуты: занятие в {at(today.timezone, 'HH:mm')} там видно в{' '}
      {at(googleZone, 'HH:mm')}. В сервисе время верное — поправь пояс в Google:{' '}
      <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">
        Настройки → Общие → Часовой пояс
      </a>
      .
    </Alert>
  );
}

function Shell() {
  const { refresh } = useRefresh();
  const { data: today, error } = useApi<Today>('/api/today');
  const { data: progress } = useApi<StudyProgress>('/api/progress');
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

  // После возвращения во вкладку сверяем состояние, изменившееся в другом окне.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Повторяем запрос после временного сбоя соединения с локальным сервером.
  useEffect(() => {
    if (!error) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [error, refresh]);

  // Идёт занятие и открыт его экран — гасим свет: тёмный режим погружения.
  const immersive = Boolean(today?.timer) && route === 'today';
  const timer = today?.timer;
  useEffect(() => {
    if (!timer || timer.overtime || timer.remainingMs <= 0) return;
    const timeout = setTimeout(refresh, timer.remainingMs);
    return () => clearTimeout(timeout);
  }, [timer, refresh]);
  useEffect(() => {
    document.documentElement.classList.toggle('immersive', immersive);
  }, [immersive]);

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

  // Google показывает занятия в поясе своего основного календаря: если он другой, время там сдвинуто.
  const googleZone = google?.connected ? google.calendarTimezone : null;
  const inGoogle = googleZone ? DateTime.fromMillis(today.now, { zone: googleZone }) : null;
  const googleMismatch =
    inGoogle !== null && inGoogle.isValid && inGoogle.offset !== service.offset;

  const semesterIds =
    today.semester?.disciplines.filter((d) => d.frequency !== null).map((d) => d.id) ?? [];

  return (
    <div className="layout">
      <aside className="sidebar">
        <Brand />
        <nav className="nav">
          {ROUTES.map(({ id, title, icon: Icon }) => (
            <a key={id} href={`#${id}`} className={`nav-item ${route === id ? 'active' : ''}`}>
              <Icon size={19} />
              {title}
              {id === 'decisions' && today.openDecisions > 0 && (
                <span className="count">{today.openDecisions}</span>
              )}
            </a>
          ))}
        </nav>
        {today.semester ? (
          <SemesterBadge semester={today.semester} />
        ) : (
          <div className="sidebar-footer">Семестр ещё не составлен</div>
        )}
        <ProgressMini data={progress} />
      </aside>
      <main className="main">
        <div
          className="stack"
          style={{
            marginBottom:
              googleResult ||
              google?.needsReauth ||
              google?.lastSyncError ||
              zoneMismatch ||
              googleMismatch
                ? 20
                : 0,
          }}
        >
          {error && (
            <Alert tone="warning">
              Не удалось обновить данные приложения: {error}. Пока показаны последние полученные
              данные; обновление повторится автоматически.
            </Alert>
          )}
          {googleMismatch && googleZone && (
            <GoogleZoneWarning googleZone={googleZone} today={today} />
          )}
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
            <Alert tone="warning">
              Последняя ошибка при обновлении Google Календаря: {google.lastSyncError}
            </Alert>
          )}
        </div>
        {route === 'today' && <TodayScreen today={today} progress={progress} />}
        {route === 'schedule' && <ScheduleScreen today={today} />}
        {route === 'decisions' && <DecisionsScreen today={today} />}
        {route === 'disciplines' && <DisciplinesScreen semesterDisciplineIds={semesterIds} />}
        {route === 'semester' && <SemesterScreen today={today} />}
        {route === 'stats' && <StatsScreen today={today} />}
        {route === 'practice' && <PracticeScreen today={today} />}
        {route === 'progress' && <ProgressScreen />}
        {route === 'settings' && <SettingsScreen />}
      </main>
      {timer && timer.paused && !timer.overtime && timer.remainingMs === 0 ? (
        <TimeUpDialog key={timer.sessionId} timer={timer} onFinished={() => navigate('today')} />
      ) : (
        <ProgressNotice data={progress} />
      )}
    </div>
  );
}

export function App() {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return (
    <RefreshContext.Provider value={{ version, refresh }}>
      <ColorsProvider>
        <ConfirmProvider>
          <Backdrop />
          <div className="app">
            <Shell />
          </div>
        </ConfirmProvider>
      </ColorsProvider>
    </RefreshContext.Provider>
  );
}

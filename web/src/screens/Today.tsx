import { plural, SESSION_FORMS } from '@ou/engine';
import { DateTime } from 'luxon';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  X,
  Inbox,
  Layers,
  NotebookPen,
  Play,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAccent, useColor } from '../colors';
import { countdown, formatDuration, formatPercent, local, ORIGIN, STATUS, time } from '../format';
import { celebrate } from '../fx';
import { useAction, useApi, useNow, useRefresh } from '../hooks';
import type {
  SessionDetails,
  SessionView,
  Stats,
  Today,
  StudyAward,
  StudyProgress,
} from '../types';
import { Badge, Button, Card, Empty, ErrorText, Field, PageHeader } from '../ui';
import { FocusView } from './Focus';
import { ProgressMini } from './Progress';

const EARLY_START_MS = 30 * 60_000;

/** «через 25 мин», «через 2 ч 10 мин», «завтра в 10:00», «пн 2 ноября в 10:00» */
function when(start: number, now: number, zone: string): string {
  const s = local(start, zone).setLocale('ru');
  const n = local(now, zone);
  const minutes = Math.round((start - now) / 60_000);
  if (minutes <= 0) return 'сейчас';
  if (s.hasSame(n, 'day')) return `через ${formatDuration(minutes)}`;
  if (s.hasSame(n.plus({ days: 1 }), 'day')) return `завтра в ${s.toFormat('HH:mm')}`;
  return `${s.toFormat('cccc, d MMMM')} в ${s.toFormat('HH:mm')}`;
}

const STATUS_TONE: Record<SessionView['status'], 'primary' | 'success' | 'danger' | undefined> = {
  planned: 'primary',
  held: 'success',
  missed: 'danger',
  skipped: undefined,
  cancelled: undefined,
};

/** Итог занятия: без него следующее не начнётся (методология, раздел 8). */
export function SummaryCard({ session, zone }: { session: SessionView; zone: string }) {
  const [retelling, setRetelling] = useState('');
  const [continueFrom, setContinueFrom] = useState('');
  const [nextQuestion, setNextQuestion] = useState('');
  const { run, error, busy } = useAction();
  const color = useColor(session.disciplineId);

  const save = async () => {
    if (busy || !retelling.trim()) return;
    const saved = await run(() =>
      api.post<{ award: StudyAward | null }>(`/api/sessions/${session.id}/summary`, {
        retelling,
        continueFrom,
        nextQuestion,
      }),
    );
    if (saved && !saved.award) celebrate('Занятие завершено', 'Итог сохранён');
  };

  return (
    <Card
      className="lesson-summary"
      title="Итог занятия"
      icon={<NotebookPen size={19} color={color.accent} />}
    >
      <div className="lesson-summary-meta">
        <strong>{session.disciplineName}</strong>
        <span>
          {local(session.start, zone).setLocale('ru').toFormat('d MMMM')} ·{' '}
          {time(session.start, zone)}–{time(session.end, zone)}
        </span>
        {session.actualMinutes !== undefined && (
          <Badge tone="success">{formatDuration(session.actualMinutes)} учёбы</Badge>
        )}
      </div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Что получилось за занятие?">
          <textarea
            className="textarea lesson-note"
            rows={4}
            maxLength={20000}
            value={retelling}
            onChange={(e) => setRetelling(e.target.value)}
            placeholder="Например: решил три задачи на JOIN. В последней пока не понял, откуда взялись дубликаты."
          />
        </Field>
        <details className="lesson-next">
          <summary>Заметка на следующее занятие</summary>
          <div className="stack">
            <Field label="С чего продолжить">
              <input
                className="input"
                maxLength={2000}
                value={continueFrom}
                onChange={(e) => setContinueFrom(e.target.value)}
                placeholder="Например: вернуться к третьей задаче"
              />
            </Field>
            <Field label="Вопрос себе">
              <input
                className="input"
                maxLength={2000}
                value={nextQuestion}
                onChange={(e) => setNextQuestion(e.target.value)}
                placeholder="Как проверить, что строки не удвоились?"
              />
            </Field>
          </div>
        </details>
        <ErrorText error={error} />
        <div>
          <Button type="submit" icon={<Check size={16} />} disabled={busy || !retelling.trim()}>
            {busy ? 'Сохраняю…' : 'Сохранить итог'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function LessonStart({ session, today }: { session: SessionView; today: Today }) {
  const { run, error, busy } = useAction();
  const { refresh } = useRefresh();
  const zone = today.timezone;
  // Привязка к часам сервера, в том числе при возвращении в открытую вкладку.
  const [base] = useState(() => Date.now());
  const now = today.now + useNow(1000) - base;
  const ongoing = now >= session.start;
  const startable = now >= session.start - EARLY_START_MS && now < session.end;
  useEffect(() => {
    const remaining = session.end - today.now;
    if (remaining > 60_000 || remaining <= 0) return;
    const id = setTimeout(refresh, remaining);
    return () => clearTimeout(id);
  }, [session.end, today.now, refresh]);
  const sameDay = local(session.start, zone).hasSame(local(now, zone), 'day');
  return (
    <>
      <div className="today-start-row">
        {startable && (
          <Button
            icon={<Play size={16} />}
            disabled={busy}
            onClick={() => void run(() => api.post(`/api/sessions/${session.id}/start`))}
          >
            Начать занятие
          </Button>
        )}
        <span>
          {ongoing
            ? `До конца по расписанию · ${countdown(session.end - now)}`
            : sameDay
              ? `До начала · ${countdown(session.start - now)}`
              : when(session.start, now, zone)}
        </span>
      </div>
      <ErrorText error={error} />
    </>
  );
}

function NextLesson({ session, today }: { session: SessionView; today: Today }) {
  const { data: details } = useApi<SessionDetails>(`/api/sessions/${session.id}`);
  const style = useAccent(session.disciplineId);
  const zone = today.timezone;
  const hint = today.continueHints[session.disciplineId];
  return (
    <section className="today-next" style={style}>
      <div className="today-next-label">
        <span className="dot" />
        Ближайшее занятие
      </div>
      <h2>{session.disciplineName}</h2>
      <p className="today-session-time">
        <Clock size={16} />
        {local(session.start, zone).setLocale('ru').toFormat('d MMMM')} ·{' '}
        {time(session.start, zone)}–{time(session.end, zone)}
      </p>
      <LessonStart key={today.now} session={session} today={today} />
      {(hint || details?.nextQuestion) && (
        <details className="today-reminder">
          <summary>
            {details?.nextQuestion ? 'Вопрос с прошлого занятия' : 'С чего продолжить'}
            <span className="today-preview">{details?.nextQuestion || hint}</span>
          </summary>
          {details?.nextQuestion && <p>{details.nextQuestion}</p>}
          {hint && <p>{hint}</p>}
        </details>
      )}
      {details?.goal && (
        <details className="today-reminder">
          <summary>Цель дисциплины</summary>
          <p>{details.goal}</p>
        </details>
      )}
    </section>
  );
}

/** Занятие на линии дня: время, точка на линии, карточка. */
function TimelineItem({ s, today, next }: { s: SessionView; today: Today; next: boolean }) {
  const style = useAccent(s.disciplineId);
  const zone = today.timezone;
  const { run, error, busy } = useAction();
  const startable =
    !next &&
    s.status === 'planned' &&
    today.now >= s.start - EARLY_START_MS &&
    s.end > today.now &&
    !today.timer &&
    !today.pendingSummary;
  return (
    <li className={`tl-item ${s.status} ${next ? 'next' : ''}`} style={style}>
      <span className="tl-time">
        {time(s.start, zone)}
        <small>{time(s.end, zone)}</small>
      </span>
      <span className="tl-node">{s.status === 'held' && <Check size={11} strokeWidth={4} />}</span>
      <div className="tl-card">
        <div className="grow">
          <strong>{s.disciplineName}</strong>
          {ORIGIN[s.origin] && <div className="faint">{ORIGIN[s.origin]}</div>}
          <ErrorText error={error} />
        </div>
        <Badge tone={STATUS_TONE[s.status]}>{STATUS[s.status]}</Badge>
        {startable && (
          <Button
            size="sm"
            icon={<Play size={14} />}
            disabled={busy}
            onClick={() => void run(() => api.post(`/api/sessions/${s.id}/start`))}
          >
            Начать
          </Button>
        )}
      </div>
    </li>
  );
}

function Unplanned({ today }: { today: Today }) {
  const disciplines = today.semester?.disciplines.filter((d) => d.frequency !== null) ?? [];
  const [id, setId] = useState('');
  const { run, error, busy } = useAction();
  const dialog = useRef<HTMLDialogElement>(null);
  if (disciplines.length === 0 || today.pendingSummary) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={<Zap size={15} />}
        onClick={() => dialog.current?.showModal()}
      >
        Вне расписания
      </Button>
      <dialog ref={dialog} aria-labelledby="unplanned-title" className="today-dialog">
        <div className="row between">
          <h2 id="unplanned-title">Вне расписания</h2>
          <Button
            variant="ghost"
            icon={<X size={16} />}
            aria-label="Закрыть"
            onClick={() => dialog.current?.close()}
          />
        </div>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (id && !busy)
              void run(() => api.post('/api/sessions/unplanned', { disciplineId: id }));
          }}
        >
          <Field label="Дисциплина">
            <select className="select" value={id} onChange={(e) => setId(e.target.value)}>
              <option value="">Выбери дисциплину</option>
              {disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <ErrorText error={error} />
          <Button type="submit" icon={<Play size={16} />} disabled={!id || busy}>
            Начать занятие
          </Button>
        </form>
      </dialog>
    </>
  );
}

function SemesterNumbers() {
  const { data, error } = useApi<Stats | null>('/api/stats');
  if (!data) return <ErrorText error={error} />;
  const sum = (field: 'actualMinutes' | 'held' | 'plannedMinutes') =>
    data.disciplines.reduce((n, d) => n + d[field], 0);
  const planned = sum('plannedMinutes');
  return (
    <div className="today-numbers">
      <dl>
        {[
          ['Чистая учёба', formatDuration(sum('actualMinutes'))],
          ['Проведено', sum('held')],
          ['Без пропусков', data.streak],
          ['План выполнен', planned ? formatPercent(sum('actualMinutes') / planned) : '—'],
          ['Прогноз', data.forecast.overall !== null ? formatPercent(data.forecast.overall) : '—'],
        ].map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <a href="#stats">Вся статистика →</a>
    </div>
  );
}

export function TodayScreen({ today, progress }: { today: Today; progress?: StudyProgress }) {
  const zone = today.timezone;
  const [expanded, setExpanded] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  if (today.timer) return <FocusView timer={today.timer} />;

  const date = DateTime.fromMillis(today.now, { zone }).setLocale('ru').toFormat('cccc, d MMMM');
  const week = today.semester?.currentWeek;
  const header = (
    <PageHeader
      title="Сегодня"
      icon={<CalendarDays size={23} />}
      subtitle={date[0]!.toUpperCase() + date.slice(1)}
      actions={today.semester && <Unplanned today={today} />}
    />
  );

  if (!today.semester) {
    return (
      <>
        {header}
        <Card>
          <Empty
            icon={<Layers size={26} />}
            title={
              today.draftPending ? 'Расписание ждёт подтверждения' : 'Семестр ещё не составлен'
            }
            action={
              <Button
                icon={<ArrowRight size={16} />}
                onClick={() => (window.location.hash = 'semester')}
              >
                {today.draftPending ? 'Посмотреть черновик' : 'Составить расписание'}
              </Button>
            }
          >
            Сервис разложит дисциплины по неделе с учётом твоего времени и календаря.
          </Empty>
        </Card>
      </>
    );
  }

  const upcoming =
    today.sessions.find((s) => s.status === 'planned' && s.end > today.now) ?? today.next;

  return (
    <div className="today-home">
      {header}
      <div className="today-board">
        {today.pendingSummary ? (
          <SummaryCard key={today.pendingSummary.id} session={today.pendingSummary} zone={zone} />
        ) : upcoming ? (
          <NextLesson key={upcoming.id} session={upcoming} today={today} />
        ) : (
          <Card>
            <Empty
              icon={<CalendarDays size={22} />}
              title="Впереди нет занятий"
              action={<a href="#schedule">Открыть расписание →</a>}
            />
          </Card>
        )}
        <Card
          className="today-plan"
          title="План на день"
          action={
            <a href="#schedule" className="today-schedule-link" aria-label="Открыть расписание">
              <CalendarDays size={16} />
              <ArrowRight size={14} />
            </a>
          }
        >
          {today.sessions.length ? (
            <>
              <ol className="timeline">
                {(showAllSessions ? today.sessions : today.sessions.slice(0, 3)).map((s) => (
                  <TimelineItem key={s.id} s={s} today={today} next={s.id === upcoming?.id} />
                ))}
              </ol>
              {today.sessions.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllSessions(!showAllSessions)}
                >
                  {showAllSessions
                    ? 'Свернуть'
                    : `Ещё ${today.sessions.length - 3} ${plural(today.sessions.length - 3, SESSION_FORMS)}`}
                </Button>
              )}
            </>
          ) : (
            <p className="muted">На сегодня занятий нет.</p>
          )}
        </Card>
      </div>
      <div className="today-footer">
        <ProgressMini data={progress} today />
        <div className="today-links">
          {today.openDecisions > 0 && (
            <a href="#decisions" className="today-decisions">
              <Inbox size={16} />
              Ждут решения <strong>{today.openDecisions}</strong>
              <ArrowRight size={14} />
            </a>
          )}
          <details className="today-semester" onToggle={(e) => setExpanded(e.currentTarget.open)}>
            <summary>
              Как идёт семестр{' '}
              {week && week > 0 ? (
                <small>
                  Неделя {week} из {today.semester.fullWeeks}
                </small>
              ) : null}
            </summary>
            {expanded && <SemesterNumbers />}
          </details>
        </div>
      </div>
    </div>
  );
}

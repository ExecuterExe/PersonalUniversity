import { plural, SESSION_FORMS } from '@ou/engine';
import { DateTime } from 'luxon';
import {
  ArrowRight,
  Brain,
  Flame,
  Inbox,
  Layers,
  NotebookPen,
  Play,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useAccent, useColor } from '../colors';
import { formatDuration, formatPercent, local, ORIGIN, STATUS, time } from '../format';
import { useAction, useApi } from '../hooks';
import type { SessionDetails, SessionView, Stats, Today } from '../types';
import { Alert, Badge, Button, Card, Empty, ErrorText, Field, PageHeader } from '../ui';
import { FocusView } from './Focus';

const EARLY_START_MS = 30 * 60_000;

function greeting(now: number, zone: string): string {
  const hour = local(now, zone).hour;
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18) return 'Добрый вечер';
  return 'Доброй ночи';
}

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
  const [keyConcepts, setKeyConcepts] = useState('');
  const [retelling, setRetelling] = useState('');
  const [continueFrom, setContinueFrom] = useState('');
  const { run, error, busy } = useAction();
  const color = useColor(session.disciplineId);
  return (
    <Card
      title={`Итог: ${session.disciplineName}`}
      icon={<NotebookPen size={20} color={color.accent} />}
      action={
        session.actualMinutes !== undefined && (
          <Badge tone="success">чистая учёба {formatDuration(session.actualMinutes)}</Badge>
        )
      }
    >
      <div className="stack">
        <p className="faint">
          {local(session.start, zone).setLocale('ru').toFormat('cccc, d MMMM')} ·{' '}
          {time(session.start, zone)}–{time(session.end, zone)}
        </p>
        <Alert tone="info">
          Сначала попробуй вспомнить, не заглядывая в материалы, — так знания закрепляются лучше
          всего.
        </Alert>
        <div className="grid-2">
          <Field label="Ключевые понятия" hint="Списком, как вспоминается">
            <textarea
              className="textarea"
              value={keyConcepts}
              onChange={(e) => setKeyConcepts(e.target.value)}
            />
          </Field>
          <Field label="Короткий пересказ" hint="Своими словами, пара абзацев">
            <textarea
              className="textarea"
              value={retelling}
              onChange={(e) => setRetelling(e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="С чего продолжить в следующий раз"
          hint="Необязательно — покажется перед следующим занятием"
        >
          <input
            className="input"
            value={continueFrom}
            placeholder="Например: глава 3, раздел о сигналах"
            onChange={(e) => setContinueFrom(e.target.value)}
          />
        </Field>
        <div className="row">
          <Button
            icon={<Sparkles size={17} />}
            disabled={busy || (!keyConcepts.trim() && !retelling.trim())}
            onClick={() =>
              void run(() =>
                api.post(`/api/sessions/${session.id}/summary`, {
                  keyConcepts,
                  retelling,
                  continueFrom,
                }),
              )
            }
          >
            Записать итог
          </Button>
          <span className="faint">Достаточно одного из двух полей.</span>
        </div>
        <ErrorText error={error} />
      </div>
    </Card>
  );
}

/** Главное на экране: следующее занятие и кнопка «Начать». */
function NextHero({ session, today }: { session: SessionView; today: Today }) {
  const { data: details } = useApi<SessionDetails>(`/api/sessions/${session.id}`);
  const { run, error, busy } = useAction();
  const zone = today.timezone;
  const startable =
    today.now >= session.start - EARLY_START_MS && today.now < session.end && !today.pendingSummary;
  const hint = today.continueHints[session.disciplineId];
  return (
    <div className="hero">
      <div className="eyebrow">
        {startable
          ? 'Пора заниматься'
          : `Следующее занятие · ${when(session.start, today.now, zone)}`}
      </div>
      <h2>{session.disciplineName}</h2>
      <div className="meta">
        {local(session.start, zone).setLocale('ru').toFormat('cccc, d MMMM')} ·{' '}
        {time(session.start, zone)}–{time(session.end, zone)} ·{' '}
        {formatDuration(Math.round((session.end - session.start) / 60_000))}
      </div>
      {details?.goal && (
        <div className="meta small" style={{ marginTop: 6 }}>
          Цель: {details.goal}
        </div>
      )}
      {hint && (
        <div className="hint">
          <strong>С чего продолжить:</strong> {hint}
        </div>
      )}
      <div className="row" style={{ marginTop: 18 }}>
        {startable ? (
          <Button
            size="lg"
            icon={<Play size={18} />}
            disabled={busy}
            onClick={() => void run(() => api.post(`/api/sessions/${session.id}/start`))}
          >
            Начать занятие
          </Button>
        ) : (
          <span className="small" style={{ opacity: 0.85 }}>
            Начать можно за 30 минут до начала
          </span>
        )}
      </div>
      {error && (
        <p className="small" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
    </div>
  );
}

function LessonRow({ s, today }: { s: SessionView; today: Today }) {
  const style = useAccent(s.disciplineId);
  const zone = today.timezone;
  const { run, error, busy } = useAction();
  const startable =
    s.status === 'planned' &&
    today.now >= s.start - EARLY_START_MS &&
    s.end > today.now &&
    !today.timer &&
    !today.pendingSummary;
  return (
    <div
      className={`lesson ${s.status === 'held' ? 'done' : ''} ${s.status === 'missed' || s.status === 'skipped' ? 'off' : ''}`}
      style={style}
    >
      <span className="time">
        {time(s.start, zone)}–{time(s.end, zone)}
      </span>
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
  );
}

function Unplanned({ today }: { today: Today }) {
  const disciplines = today.semester?.disciplines.filter((d) => d.frequency !== null) ?? [];
  const [id, setId] = useState('');
  const { run, error, busy } = useAction();
  if (disciplines.length === 0 || today.pendingSummary) return null;
  return (
    <Card title="Хочется позаниматься сейчас" icon={<Zap size={18} color="var(--violet)" />}>
      <div className="stack">
        <select className="select" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Выбери дисциплину</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          icon={<Play size={15} />}
          disabled={!id || busy}
          onClick={() => void run(() => api.post('/api/sessions/unplanned', { disciplineId: id }))}
        >
          Начать вне расписания
        </Button>
        <p className="faint">Пойдёт в статистику, расписание не изменится.</p>
        <ErrorText error={error} />
      </div>
    </Card>
  );
}

function Pulse() {
  const { data } = useApi<Stats | null>('/api/stats');
  if (!data) return null;
  const held = data.disciplines.reduce((sum, d) => sum + d.held, 0);
  const actual = data.disciplines.reduce((sum, d) => sum + d.actualMinutes, 0);
  return (
    <Card title="Как идёт семестр" icon={<TrendingUp size={18} color="var(--primary)" />}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row between">
          <span className="row muted" style={{ gap: 8 }}>
            <Flame size={16} color="var(--warning)" /> Серия без пропусков
          </span>
          <strong>{data.streak}</strong>
        </div>
        <div className="row between">
          <span className="row muted" style={{ gap: 8 }}>
            <Brain size={16} color="var(--violet)" /> Чистая учёба
          </span>
          <strong>{formatDuration(actual)}</strong>
        </div>
        <div className="row between">
          <span className="row muted" style={{ gap: 8 }}>
            <NotebookPen size={16} color="var(--success)" /> Проведено занятий
          </span>
          <strong>{held}</strong>
        </div>
        {data.forecast.overall !== null && (
          <div className="row between">
            <span className="row muted" style={{ gap: 8 }}>
              <Target size={16} color="var(--violet)" /> Прогноз к концу семестра
            </span>
            <strong>{formatPercent(data.forecast.overall)} плана</strong>
          </div>
        )}
      </div>
    </Card>
  );
}

export function TodayScreen({ today }: { today: Today }) {
  const zone = today.timezone;
  if (today.timer) return <FocusView timer={today.timer} />;

  const date = DateTime.fromMillis(today.now, { zone }).setLocale('ru').toFormat('cccc, d MMMM');
  const header = (
    <PageHeader
      title={greeting(today.now, zone)}
      subtitle={date[0]!.toUpperCase() + date.slice(1)}
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
    <>
      {header}
      <div className="split">
        <div className="stack-lg">
          {today.pendingSummary ? (
            <SummaryCard session={today.pendingSummary} zone={zone} />
          ) : upcoming ? (
            <NextHero session={upcoming} today={today} />
          ) : (
            <Card>
              <Empty icon={<Sparkles size={26} />} title="Семестр завершён">
                Занятий больше нет — загляни в «Решения», там итоги.
              </Empty>
            </Card>
          )}
          <Card
            title="Сегодня"
            action={
              <span className="faint">
                {today.sessions.length
                  ? `${today.sessions.length} ${plural(today.sessions.length, SESSION_FORMS)}`
                  : ''}
              </span>
            }
          >
            {today.sessions.length === 0 ? (
              <p className="muted">
                Сегодня занятий нет — можно отдохнуть или позаниматься вне расписания.
              </p>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {today.sessions.map((s) => (
                  <LessonRow key={s.id} s={s} today={today} />
                ))}
              </div>
            )}
          </Card>
        </div>
        <div className="stack-lg">
          {today.openDecisions > 0 && (
            <Card className="tinted">
              <div className="stack">
                <div className="row" style={{ gap: 10 }}>
                  <Inbox size={20} color="var(--violet)" />
                  <strong>
                    {today.openDecisions === 1
                      ? 'Есть вопрос, который ждёт решения'
                      : `${today.openDecisions} ${plural(today.openDecisions, ['вопрос', 'вопроса', 'вопросов'])} ждут решения`}
                  </strong>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ArrowRight size={15} />}
                  onClick={() => (window.location.hash = 'decisions')}
                >
                  Разобрать
                </Button>
              </div>
            </Card>
          )}
          <Pulse />
          <Unplanned today={today} />
        </div>
      </div>
    </>
  );
}

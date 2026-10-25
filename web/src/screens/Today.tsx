import { plural, SESSION_FORMS } from '@ou/engine';
import { DateTime } from 'luxon';
import {
  ArrowRight,
  BookmarkCheck,
  Brain,
  CalendarDays,
  Check,
  Clock,
  Coffee,
  Flame,
  Hourglass,
  Inbox,
  Layers,
  Moon,
  NotebookPen,
  Play,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Target,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../api';
import { useAccent, useColor } from '../colors';
import { countdown, formatDuration, formatPercent, local, ORIGIN, STATUS, time } from '../format';
import { celebrate } from '../fx';
import { useAction, useApi, useNow } from '../hooks';
import type { SessionDetails, SessionView, Stats, Today } from '../types';
import { Alert, Badge, Button, Card, Empty, ErrorText, Field, PageHeader } from '../ui';
import { FocusView } from './Focus';

const EARLY_START_MS = 30 * 60_000;

function greeting(now: number, zone: string): { text: string; icon: LucideIcon } {
  const hour = local(now, zone).hour;
  if (hour >= 5 && hour < 12) return { text: 'Доброе утро', icon: Sunrise };
  if (hour >= 12 && hour < 18) return { text: 'Добрый день', icon: Sun };
  if (hour >= 18) return { text: 'Добрый вечер', icon: Sunset };
  return { text: 'Доброй ночи', icon: Moon };
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
              void run(async () => {
                await api.post(`/api/sessions/${session.id}/summary`, {
                  keyConcepts,
                  retelling,
                  continueFrom,
                });
                return true;
              }).then((saved) => {
                if (!saved) return;
                celebrate(
                  'Занятие засчитано!',
                  session.actualMinutes
                    ? `+${formatDuration(session.actualMinutes)} чистой учёбы — так держать`
                    : 'Так держать',
                );
              })
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

/** Рисунок героя: пятна света и орбиты со «спутниками». */
function HeroArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <span className="orb o1" />
      <span className="orb o2" />
      <span className="orb o3" />
      <svg className="orbits" viewBox="0 0 420 420">
        <circle className="path" cx="210" cy="210" r="200" />
        <circle className="path" cx="210" cy="210" r="150" />
        <circle className="path" cx="210" cy="210" r="100" />
        <g className="spin">
          <circle cx="210" cy="10" r="5" fill="#fff" />
          <circle cx="410" cy="210" r="3" fill="#fff" opacity="0.6" />
        </g>
        <g className="spin slow">
          <circle cx="210" cy="60" r="4" fill="#c4f1ff" />
          <circle cx="60" cy="210" r="3" fill="#fff" opacity="0.7" />
          <circle cx="310" cy="210" r="2.5" fill="#ffd6f0" />
        </g>
      </svg>
    </div>
  );
}

/**
 * Живой отсчёт до начала (или до конца, если занятие уже идёт). Время сервиса берётся с сервера
 * и дальше идёт по часам браузера — новый ответ сервера даёт новый экземпляр.
 */
function HeroClock({
  session,
  serverNow,
  zone,
}: {
  session: SessionView;
  serverNow: number;
  zone: string;
}) {
  const [base] = useState(() => ({ server: serverNow, client: Date.now() }));
  const now = base.server + (useNow(1000) - base.client);
  const start = local(session.start, zone).setLocale('ru');
  let label: string;
  let big: string;
  let sub: string;
  if (now >= session.start && now < session.end) {
    label = 'идёт сейчас';
    big = countdown(session.end - now);
    sub = 'до конца';
  } else if (start.hasSame(local(now, zone), 'day')) {
    label = 'до начала';
    big = countdown(session.start - now);
    sub = `начало в ${start.toFormat('HH:mm')}`;
  } else {
    const tomorrow = start.hasSame(local(now, zone).plus({ days: 1 }), 'day');
    label = tomorrow ? 'завтра' : start.toFormat('cccc');
    big = start.toFormat('HH:mm');
    sub = tomorrow ? 'начало' : start.toFormat('d MMMM');
  }
  return (
    <div className="hero-clock">
      <span className="label">{label}</span>
      <span className="big">{big}</span>
      <span className="sub">{sub}</span>
    </div>
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
      <HeroArt />
      <div className="hero-inner">
        <div className="hero-body">
          <span className="eyebrow-pill">
            <span className={`live-dot ${startable ? '' : 'calm'}`} />
            {startable ? 'Пора заниматься' : `Следующее · ${when(session.start, today.now, zone)}`}
          </span>
          <h2>{session.disciplineName}</h2>
          <div className="hero-chips">
            <span className="hero-chip">
              <CalendarDays size={14} />
              {local(session.start, zone).setLocale('ru').toFormat('cccc, d MMMM')}
            </span>
            <span className="hero-chip">
              <Clock size={14} />
              {time(session.start, zone)}–{time(session.end, zone)}
            </span>
            <span className="hero-chip">
              <Hourglass size={14} />
              {formatDuration(Math.round((session.end - session.start) / 60_000))}
            </span>
          </div>
          {details?.goal && (
            <p className="goal">
              <Target size={16} />
              <span>{details.goal}</span>
            </p>
          )}
          {hint && (
            <div className="hint">
              <BookmarkCheck size={16} />
              <span>
                <strong>С чего продолжить:</strong> {hint}
              </span>
            </div>
          )}
          <div className="hero-actions">
            {startable ? (
              <Button
                size="lg"
                className="beckon"
                icon={<Play size={18} />}
                disabled={busy}
                onClick={() => void run(() => api.post(`/api/sessions/${session.id}/start`))}
              >
                Начать занятие
              </Button>
            ) : (
              <span className="hero-note">Начать можно за 30 минут до начала</span>
            )}
          </div>
          {error && (
            <p className="small" style={{ marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>
        <HeroClock key={today.now} session={session} serverNow={today.now} zone={zone} />
      </div>
    </div>
  );
}

/** Занятие на линии дня: время, точка на линии, карточка. */
function TimelineItem({ s, today, next }: { s: SessionView; today: Today; next: boolean }) {
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

const METER = 112;
const METER_STROKE = 11;
const METER_RADIUS = (METER - METER_STROKE) / 2;
const METER_LENGTH = 2 * Math.PI * METER_RADIUS;

/** Кольцо: какая доля плана семестра (в часах чистой учёбы) уже пройдена. */
function MeterRing({ value }: { value: number }) {
  const share = Math.max(0, Math.min(1, value));
  return (
    <div
      className="meter-ring"
      role="img"
      aria-label={`Пройдено ${formatPercent(share)} плана семестра`}
    >
      <svg width={METER} height={METER}>
        <defs>
          <linearGradient id="meter-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f6cf2" />
            <stop offset="100%" stopColor="#9b5cf0" />
          </linearGradient>
        </defs>
        <circle
          className="track"
          cx={METER / 2}
          cy={METER / 2}
          r={METER_RADIUS}
          fill="none"
          strokeWidth={METER_STROKE}
        />
        <circle
          className="fill"
          cx={METER / 2}
          cy={METER / 2}
          r={METER_RADIUS}
          fill="none"
          stroke="url(#meter-gradient)"
          strokeWidth={METER_STROKE}
          strokeDasharray={METER_LENGTH}
          strokeDashoffset={METER_LENGTH * (1 - share)}
          style={{ '--full': METER_LENGTH } as CSSProperties}
        />
      </svg>
      <div className="center">
        <strong>{formatPercent(share)}</strong>
        <span>плана</span>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="mini-stat">
      <span className="ico">{icon}</span>
      <span className="grow">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Pulse() {
  const { data } = useApi<Stats | null>('/api/stats');
  if (!data) return null;
  const held = data.disciplines.reduce((sum, d) => sum + d.held, 0);
  const actual = data.disciplines.reduce((sum, d) => sum + d.actualMinutes, 0);
  const planned = data.disciplines.reduce((sum, d) => sum + d.plannedMinutes, 0);
  return (
    <Card title="Как идёт семестр" icon={<TrendingUp size={18} color="var(--primary)" />}>
      <div className="pulse">
        <MeterRing value={planned > 0 ? actual / planned : 0} />
        <div className="mini-stats">
          <MiniStat
            icon={<Flame size={15} color="var(--warning)" />}
            label="Серия"
            value={data.streak}
          />
          <MiniStat
            icon={<Brain size={15} color="var(--violet)" />}
            label="Чистая учёба"
            value={formatDuration(actual)}
          />
          <MiniStat
            icon={<NotebookPen size={15} color="var(--success)" />}
            label="Проведено"
            value={held}
          />
        </div>
      </div>
      {data.forecast.overall !== null && (
        <div className="forecast-line">
          <Target size={16} color="var(--violet)" />
          Прогноз к концу семестра
          <strong>{formatPercent(data.forecast.overall)} плана</strong>
        </div>
      )}
    </Card>
  );
}

export function TodayScreen({ today }: { today: Today }) {
  const zone = today.timezone;
  if (today.timer) return <FocusView timer={today.timer} />;

  const date = DateTime.fromMillis(today.now, { zone }).setLocale('ru').toFormat('cccc, d MMMM');
  const hello = greeting(today.now, zone);
  const week = today.semester?.currentWeek;
  const header = (
    <PageHeader
      icon={<hello.icon size={24} className="sway" />}
      title={hello.text}
      subtitle={date[0]!.toUpperCase() + date.slice(1)}
      actions={
        today.semester &&
        week !== null &&
        week !== undefined &&
        week > 0 && (
          <span className="pill">
            <Layers size={14} color="var(--violet)" />
            Неделя {week} из {today.semester.fullWeeks}
          </span>
        )
      }
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
              <div className="row muted" style={{ gap: 12, flexWrap: 'nowrap' }}>
                <span className="swatch-sm">
                  <Coffee size={17} />
                </span>
                Сегодня занятий нет — можно отдохнуть или позаниматься вне расписания.
              </div>
            ) : (
              <ol className="timeline">
                {today.sessions.map((s) => (
                  <TimelineItem key={s.id} s={s} today={today} next={s.id === upcoming?.id} />
                ))}
              </ol>
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

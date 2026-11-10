import { plural, SESSION_FORMS } from '@ou/engine';
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  MoveRight,
  SkipForward,
  X,
} from 'lucide-react';
import type { DateTime } from 'luxon';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api, ApiError, errorText } from '../api';
import { useAccent, useColor } from '../colors';
import { useConfirm } from '../confirm';
import {
  day,
  formatClock,
  formatDuration,
  fromInput,
  local,
  ORIGIN,
  STATUS,
  time,
  toInput,
  weekStart,
} from '../format';
import { useApi, useRefresh } from '../hooks';
import type { AppSettings, SessionView, Today, Violation, Weekday } from '../types';
import { Alert, Badge, Button, Card, Empty, ErrorText, Loading, PageHeader } from '../ui';

const PX_PER_MIN = 1.15;
/** Шаг перетаскивания — четверть часа. */
const SNAP_MINUTES = 15;
/** Сдвиг меньше этого — не перетаскивание, а нажатие. */
const DRAG_THRESHOLD_PX = 5;

/** Перенос, который сервер не принял из-за правил: его показывают в панели занятия. */
interface PendingMove {
  start: number;
  violations: Violation[];
}

const violationsOf = (e: unknown) =>
  e instanceof ApiError
    ? (e.details as { violations?: Violation[] } | undefined)?.violations
    : undefined;

/** Ручной перенос: если правила нарушаются — показать какие и спросить. */
function MoveForm({
  s,
  zone,
  pending,
  onDone,
}: {
  s: SessionView;
  zone: string;
  pending?: PendingMove | undefined;
  onDone: () => void;
}) {
  const { refresh } = useRefresh();
  const [value, setValue] = useState(toInput(pending?.start ?? s.start, zone));
  const [violations, setViolations] = useState<Violation[] | null>(pending?.violations ?? null);
  const [error, setError] = useState<string | null>(null);

  const move = async (confirm: boolean) => {
    setError(null);
    try {
      await api.post(`/api/sessions/${s.id}/move`, { start: fromInput(value, zone), confirm });
      refresh();
      onDone();
    } catch (e) {
      const found = violationsOf(e);
      if (found) setViolations(found);
      else setError(errorText(e));
    }
  };

  return (
    <div className="stack">
      <input
        className="input"
        type="datetime-local"
        aria-label="Новое время занятия"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setViolations(null);
        }}
      />
      {violations ? (
        <Alert tone="warning">
          <div className="stack" style={{ gap: 6 }}>
            <strong>Так нарушаются правила:</strong>
            {violations.map((v, i) => (
              <span key={i}>• {v.message}</span>
            ))}
            <div>
              <Button variant="danger" size="sm" onClick={() => void move(true)}>
                Перенести всё равно
              </Button>
            </div>
          </div>
        </Alert>
      ) : (
        <Button icon={<MoveRight size={16} />} onClick={() => void move(false)}>
          Перенести
        </Button>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function SessionPanel({
  s,
  today,
  pending,
  onClose,
}: {
  s: SessionView;
  today: Today;
  pending?: PendingMove | undefined;
  onClose: () => void;
}) {
  const { refresh } = useRefresh();
  const confirm = useConfirm();
  const color = useColor(s.disciplineId);
  const [moving, setMoving] = useState(pending !== undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  const [error, setError] = useState<string | null>(null);
  const zone = today.timezone;
  const future = s.status === 'planned' && s.start > today.now;

  const skip = async () => {
    if (
      !(await confirm({
        title: `Пропустить «${s.disciplineName}» ${day(s.start, zone)}?`,
        text: 'Это не будет считаться пропуском.',
        ok: 'Пропустить',
      }))
    )
      return;
    try {
      await api.post(`/api/sessions/${s.id}/skip`);
      refresh();
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <dialog
      ref={dialog}
      className="schedule-detail"
      aria-label={s.disciplineName}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <Card
        title={s.disciplineName}
        icon={<span className="dot" style={{ background: color.accent, width: 12, height: 12 }} />}
        action={
          <Button variant="ghost" icon={<X size={16} />} aria-label="Закрыть" onClick={onClose} />
        }
      >
        <div className="stack">
          <span className="muted">
            {local(s.start, zone).setLocale('ru').toFormat('cccc, d MMMM')} · {time(s.start, zone)}–
            {time(s.end, zone)}
          </span>
          <div className="row">
            <Badge
              tone={s.status === 'held' ? 'success' : s.status === 'missed' ? 'danger' : 'primary'}
            >
              {STATUS[s.status]}
            </Badge>
            {ORIGIN[s.origin] && <Badge tone="violet">{ORIGIN[s.origin]}</Badge>}
          </div>
          {s.moveReason && !s.moveReason.startsWith(ORIGIN[s.origin]) && (
            <p className="faint">Причина: {s.moveReason}</p>
          )}
          {s.acceptedViolations && s.acceptedViolations.length > 0 && (
            <p className="faint">С твоего согласия здесь нарушено правило расписания.</p>
          )}
          {s.actualMinutes !== undefined && (
            <p className="faint">Чистая учёба: {s.actualMinutes} мин</p>
          )}
          {future && !moving && (
            <div className="row">
              <Button
                variant="secondary"
                icon={<CalendarClock size={16} />}
                onClick={() => setMoving(true)}
              >
                Перенести
              </Button>
              <Button variant="ghost" icon={<SkipForward size={16} />} onClick={() => void skip()}>
                Пропустить
              </Button>
            </div>
          )}
          {moving && <MoveForm s={s} zone={zone} pending={pending} onDone={onClose} />}
          <ErrorText error={error} />
        </div>
      </Card>
    </dialog>
  );
}

function Block({
  s,
  top,
  height,
  zone,
  selected,
  draggable,
  dragging,
  onSelect,
  onPointerDown,
}: {
  s: SessionView;
  top: number;
  height: number;
  zone: string;
  selected: boolean;
  draggable: boolean;
  dragging: boolean;
  onSelect: () => void;
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const style = useAccent(s.disciplineId);
  const classes = ['block', s.status, selected && 'selected', draggable && 'draggable'];
  return (
    <button
      type="button"
      className={classes.filter(Boolean).join(' ')}
      style={{ ...style, top, height: Math.max(height, 34), opacity: dragging ? 0.35 : undefined }}
      onClick={onSelect}
      onPointerDown={onPointerDown}
    >
      <strong>
        {s.status === 'held' && <Check size={13} style={{ verticalAlign: -2, marginRight: 3 }} />}
        {s.disciplineName}
      </strong>
      <span className="faint">
        {time(s.start, zone)}–{time(s.end, zone)}
      </span>
    </button>
  );
}

/** Тень занятия там, куда его сейчас тянут. */
function Ghost({ s, top, minute }: { s: SessionView; top: number; minute: number }) {
  const style = useAccent(s.disciplineId);
  const minutes = (s.end - s.start) / 60_000;
  return (
    <div
      className="block ghost"
      style={{ ...style, top, height: Math.max(minutes * PX_PER_MIN - 3, 34) }}
    >
      <strong>{s.disciplineName}</strong>
      <span className="faint">
        {formatClock(minute)}–{formatClock(minute + minutes)}
      </span>
    </div>
  );
}

interface Drag {
  id: string;
  /** Куда тянут сейчас: день недели (0–6) и минута от начала дня. */
  dayIndex: number;
  minute: number;
  moved: boolean;
}

export function ScheduleScreen({ today }: { today: Today }) {
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'day' | 'grid'>('day');
  const monday = local(weekStart(today.now, today.timezone), today.timezone).plus({
    weeks: offset,
  });
  return (
    <ScheduleWeek
      key={`${today.semester?.id}-${monday.toMillis()}`}
      today={today}
      monday={monday}
      offset={offset}
      setOffset={setOffset}
      view={view}
      setView={setView}
    />
  );
}

function AgendaRow({ s, zone, select }: { s: SessionView; zone: string; select: () => void }) {
  const accent = useAccent(s.disciplineId);
  return (
    <button type="button" className="agenda-item" style={accent} onClick={select}>
      <span className="agenda-time">
        <strong>{time(s.start, zone)}</strong>
        <small>{time(s.end, zone)}</small>
      </span>
      <span className="agenda-subject">
        <strong>{s.disciplineName}</strong>
        <small>
          {formatDuration(Math.round((s.end - s.start) / 60000))} ·{' '}
          {s.running ? 'Идёт сейчас' : STATUS[s.status]}
        </small>
      </span>
      <ChevronRight size={17} aria-hidden="true" />
    </button>
  );
}

function ScheduleWeek({
  today,
  monday,
  offset,
  setOffset,
  view,
  setView,
}: {
  today: Today;
  monday: DateTime;
  offset: number;
  setOffset: (n: number) => void;
  view: 'day' | 'grid';
  setView: (v: 'day' | 'grid') => void;
}) {
  const zone = today.timezone;
  const { refresh } = useRefresh();
  const currentDay = local(today.now, zone).weekday - 1;
  const [dayIndex, setDayIndex] = useState(offset === 0 ? currentDay : 0);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMove | undefined>(undefined);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const suppressClick = useRef(false);
  const from = monday.toMillis();
  const to = monday.plus({ weeks: 1 }).toMillis();
  const { data, error } = useApi<SessionView[]>(
    today.semester ? `/api/schedule?from=${from}&to=${to}` : null,
  );
  const { data: settings, error: settingsError } = useApi<AppSettings>(
    view === 'grid' && today.semester ? '/api/settings' : null,
  );

  const select = (id: string | null) => {
    setSelected(id);
    setPending(undefined);
  };

  const header = (
    <PageHeader
      icon={<CalendarDays size={24} />}
      title="Расписание"
      subtitle={`${monday.setLocale('ru').toFormat('d MMMM')} — ${monday.plus({ days: 6 }).setLocale('ru').toFormat('d MMMM')}`}
      actions={
        today.semester && (
          <>
            <Button
              variant="secondary"
              icon={<ChevronLeft size={17} />}
              aria-label="Прошлая неделя"
              onClick={() => setOffset(offset - 1)}
            />
            <Button
              variant="secondary"
              onClick={() => {
                setOffset(0);
                setDayIndex(currentDay);
                select(null);
              }}
              disabled={offset === 0 && (view === 'grid' || dayIndex === currentDay)}
            >
              Сегодня
            </Button>
            <Button
              variant="secondary"
              icon={<ChevronRight size={17} />}
              aria-label="Следующая неделя"
              onClick={() => setOffset(offset + 1)}
            />
          </>
        )
      }
    />
  );

  if (!today.semester) {
    return (
      <>
        {header}
        <Card>
          <Empty icon={<CalendarClock size={26} />} title="Расписания пока нет">
            Составь семестр — и здесь появится неделя с занятиями.
          </Empty>
        </Card>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <Loading error={error} height={420} />
      </>
    );
  }

  const minuteOf = (t: number) => {
    const dt = local(t, zone);
    return dt.hour * 60 + dt.minute;
  };
  const marks = [
    ...(settings?.studyWindows ?? []).flatMap((w) => [w.start, w.end]),
    ...data.flatMap((s) => [minuteOf(s.start), minuteOf(s.start) + (s.end - s.start) / 60_000]),
  ];
  if (!marks.length) marks.push(9 * 60, 17 * 60);
  const startHour = Math.max(0, Math.floor(Math.min(...marks) / 60) - 1);
  const endHour = Math.min(24, Math.ceil(Math.max(...marks) / 60) + 1);
  const height = (endHour - startHour) * 60 * PX_PER_MIN;
  const y = (minute: number) => (minute - startHour * 60) * PX_PER_MIN;
  const days = Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }));
  const todayKey = local(today.now, zone).toISODate();
  const nowMinute = minuteOf(today.now);
  const selectedSession = data.find((s) => s.id === selected);
  const visibleDay = days[dayIndex]!;
  const daily = days.map((d) =>
    data.filter((s) => local(s.start, zone).hasSame(d, 'day')).sort((a, b) => a.start - b.start),
  );
  const lessons = daily[dayIndex]!;
  const weekSessions = data.filter((s) => s.status !== 'skipped' && s.status !== 'cancelled');
  const weekMinutes = Math.round(weekSessions.reduce((sum, s) => sum + s.end - s.start, 0) / 60000);
  const dragged = drag ? data.find((s) => s.id === drag.id) : undefined;
  const at = (d: DateTime, minute: number) =>
    d.set({ hour: Math.floor(minute / 60), minute: minute % 60 }).toMillis();

  /** Перетаскивание будущего занятия мышью или пальцем; отпустил — перенос с проверкой правил. */
  const startDrag = (s: SessionView, dayIndex: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = minuteOf(s.start);
    const length = (s.end - s.start) / 60_000;
    let current: Drag = { id: s.id, dayIndex, minute: origin, moved: false };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      const column = columns.current.findIndex((el) => {
        const r = el?.getBoundingClientRect();
        return r !== undefined && ev.clientX >= r.left && ev.clientX < r.right;
      });
      const snapped = Math.round(dy / PX_PER_MIN / SNAP_MINUTES) * SNAP_MINUTES;
      const minute = Math.min(Math.max(origin + snapped, startHour * 60), endHour * 60 - length);
      current = {
        id: s.id,
        dayIndex: column === -1 ? current.dayIndex : column,
        minute,
        moved: true,
      };
      setDrag(current);
    };

    const onUp = (event: PointerEvent) => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      setDrag(null);
      if (!current.moved || event.type === 'pointercancel') return;
      // Щелчок, который браузер пришлёт следом за перетаскиванием, — не выбор занятия.
      // Флаг сбрасывается при следующем нажатии на любое занятие.
      suppressClick.current = true;
      const start = at(days[current.dayIndex]!, current.minute);
      if (start === s.start) return;
      setDragError(null);
      api
        .post(`/api/sessions/${s.id}/move`, { start, confirm: false })
        .then(() => refresh())
        .catch((err: unknown) => {
          const violations = violationsOf(err);
          if (violations) {
            setSelected(s.id);
            setPending({ start, violations });
          } else setDragError(errorText(err));
        });
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <>
      {header}
      {dragError && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="danger">{dragError}</Alert>
        </div>
      )}
      <div className="schedule-toolbar">
        <div className="stats-nav" role="group" aria-label="Вид расписания">
          <button type="button" aria-pressed={view === 'day'} onClick={() => setView('day')}>
            <List size={15} />
            По дням
          </button>
          <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
            <CalendarDays size={15} />
            Сетка недели
          </button>
        </div>
        <span className="muted small">
          {weekSessions.length} {plural(weekSessions.length, SESSION_FORMS)} ·{' '}
          {formatDuration(weekMinutes)} за неделю
        </span>
      </div>
      <ErrorText error={error} />
      {view === 'day' ? (
        <section className="agenda-card">
          <div className="agenda-days" role="group" aria-label="Дни недели">
            {days.map((d, i) => (
              <button
                type="button"
                key={d.toMillis()}
                aria-pressed={dayIndex === i}
                aria-current={d.toISODate() === todayKey ? 'date' : undefined}
                aria-label={`${d.setLocale('ru').toFormat('cccc, d MMMM')}, ${daily[i]!.length} ${plural(daily[i]!.length, SESSION_FORMS)}`}
                onClick={() => setDayIndex(i)}
              >
                <span>{d.setLocale('ru').toFormat('ccc')}</span>
                <strong>{d.day}</strong>
                <i aria-hidden="true" className={daily[i]!.length ? 'has-lessons' : ''} />
              </button>
            ))}
          </div>
          <div className="agenda-body">
            <h2>
              {visibleDay.toISODate() === todayKey
                ? 'Сегодня'
                : visibleDay.setLocale('ru').toFormat('cccc')}
              , {visibleDay.setLocale('ru').toFormat('d MMMM')}
            </h2>
            {lessons.length ? (
              <div className="agenda-list">
                {lessons.map((s) => (
                  <AgendaRow key={s.id} s={s} zone={zone} select={() => select(s.id)} />
                ))}
              </div>
            ) : (
              <p className="agenda-empty">На этот день занятий нет.</p>
            )}
          </div>
        </section>
      ) : !settings ? (
        <Loading error={settingsError} height={240} />
      ) : (
        <>
          <div className="week-grid">
            <div className="day-head" style={{ borderLeft: 'none' }} />
            {days.map((d) => (
              <div
                key={d.toISODate()}
                className={`day-head ${d.toISODate() === todayKey ? 'today' : ''}`}
              >
                {d.setLocale('ru').toFormat('ccc')}
                <strong>{d.day}</strong>
              </div>
            ))}
            <div className="hours" style={{ height }}>
              {/* Подписи — только внутренним линиям: у краёв сетки они обрезались бы. */}
              {Array.from({ length: endHour - startHour - 1 }, (_, i) => (
                <span key={i} className="hour" style={{ top: (i + 1) * 60 * PX_PER_MIN }}>
                  {String(startHour + i + 1).padStart(2, '0')}:00
                </span>
              ))}
            </div>
            {days.map((d, dayIndex) => {
              const key = d.toISODate();
              const excluded = settings.excludedWeekdays.includes(d.weekday as Weekday);
              return (
                <div
                  key={key}
                  ref={(el) => {
                    columns.current[dayIndex] = el;
                  }}
                  className={`day-col ${key === todayKey ? 'today' : ''}`}
                  style={{ height, backgroundSize: `100% ${60 * PX_PER_MIN}px` }}
                >
                  {!excluded &&
                    settings.studyWindows.map((w, i) => (
                      <div
                        key={i}
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: y(w.start),
                          height: (w.end - w.start) * PX_PER_MIN,
                          background: 'rgba(79, 95, 232, 0.05)',
                        }}
                      />
                    ))}
                  {key === todayKey && nowMinute >= startHour * 60 && nowMinute <= endHour * 60 && (
                    <div className="now-line" style={{ top: y(nowMinute) }} />
                  )}
                  {data
                    .filter((s) => local(s.start, zone).toISODate() === key)
                    .map((s) => (
                      <Block
                        key={s.id}
                        s={s}
                        top={y(minuteOf(s.start))}
                        height={((s.end - s.start) / 60_000) * PX_PER_MIN - 3}
                        zone={zone}
                        selected={s.id === selected}
                        draggable={s.status === 'planned' && s.start > today.now}
                        dragging={drag?.id === s.id && drag.moved}
                        onPointerDown={(e) => {
                          suppressClick.current = false;
                          if (s.status === 'planned' && s.start > today.now)
                            startDrag(s, dayIndex, e);
                        }}
                        onSelect={() => {
                          if (suppressClick.current) {
                            suppressClick.current = false;
                            return;
                          }
                          select(s.id === selected ? null : s.id);
                        }}
                      />
                    ))}
                  {drag?.moved && dragged && drag.dayIndex === dayIndex && (
                    <Ghost s={dragged} top={y(drag.minute)} minute={drag.minute} />
                  )}
                </div>
              );
            })}
          </div>
          <p className="faint" style={{ marginTop: 10 }}>
            Будущие занятия можно переносить перетаскиванием.
          </p>
        </>
      )}
      {selectedSession && (
        <SessionPanel
          key={`${selectedSession.id}-${pending?.start ?? ''}`}
          s={selectedSession}
          today={today}
          pending={pending}
          onClose={() => select(null)}
        />
      )}
    </>
  );
}

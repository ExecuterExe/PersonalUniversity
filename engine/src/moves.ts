import { gridStart } from './candidates';
import { MAKEUP_HORIZON_DAYS, SLOT_STEP_MINUTES } from './defaults';
import { formatInterval } from './format';
import {
  allowedWindows,
  checkPlacement,
  getDiscipline,
  occupiesTime,
  weeklyLoads,
  type Placement,
  type RuleContext,
} from './rules';
import { maxGapDays } from './rhythm';
import { durationMinutes, instantAt, localInfo, MINUTE } from './time';
import type { BusyEvent, Frequency, Instant, Session, Violation } from './types';

export type MoveKind = 'same-day' | 'same-week' | 'next-week' | 'makeup';

export interface MoveOption {
  start: Instant;
  end: Instant;
  kind: MoveKind;
  /** Чем меньше, тем меньше вмешательство. */
  cost: number;
  /** «Вт 04.11, 18:00–19:30 · на этой неделе» */
  label: string;
  weekIndex: number;
  weekLoadBefore: number;
  weekLoadAfter: number;
}

const KIND_LABEL: Record<MoveKind, string> = {
  'same-day': 'в тот же день',
  'same-week': 'на этой неделе',
  'next-week': 'на следующей неделе',
  makeup: 'отработка',
};

const NEXT_WEEK_DAYS = 3;

export interface MoveSearch {
  limit?: number;
  /** Частота дисциплины — для правила максимального перерыва; по умолчанию — по приоритету. */
  frequency?: Frequency;
  /** Разрешить остаться на прежнем времени (когда занятие укорачивают). */
  allowCurrentStart?: boolean;
}

/** Штраф за слишком длинный перерыв до соседних занятий той же дисциплины (раздел 5). */
function gapPenalty(ownDays: readonly number[], day: number, maxGap: number): number {
  let prev: number | undefined;
  let next: number | undefined;
  for (const d of ownDays) {
    if (d < day) prev = d;
    else if (d > day && next === undefined) next = d;
  }
  return (
    5 *
    (Math.max(0, prev === undefined ? 0 : day - prev - maxGap) +
      Math.max(0, next === undefined ? 0 : next - day - maxGap))
  );
}

/**
 * Варианты переноса занятия от «дешёвого» к «дорогому».
 * conflict — занятие переезжает из-за события; makeup — отработка пропуска в ближайшие 7 дней.
 * Каждый вариант проходит все жёсткие правила.
 */
export function findMoveOptions(
  ctx: RuleContext,
  sessions: readonly Session[],
  sessionId: string,
  now: Instant,
  mode: 'conflict' | 'makeup',
  search: MoveSearch = {},
): MoveOption[] {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Неизвестное занятие: ${sessionId}`);
  const { cal } = ctx;
  const discipline = getDiscipline(ctx, session.disciplineId);
  const duration = durationMinutes(session);
  const original = localInfo(cal, session.originalStart ?? session.start);
  const current = localInfo(cal, session.start);
  const today = localInfo(cal, now).dayIndex;
  const limit = search.limit ?? 3;
  const maxGap = maxGapDays(search.frequency ?? (discipline.priority === 'main' ? 2 : 1));

  const others = sessions.filter((s) => s.id !== session.id && occupiesTime(s));
  const loads = weeklyLoads(cal, others);
  const dayCount = new Map<number, number>();
  const sameDisciplineDays = new Set<number>();
  for (const o of others) {
    const day = localInfo(cal, o.start).dayIndex;
    dayCount.set(day, (dayCount.get(day) ?? 0) + 1);
    if (o.disciplineId === session.disciplineId) sameDisciplineDays.add(day);
  }
  const ownDays = [...sameDisciplineDays].sort((a, b) => a - b);

  const days: { dayIndex: number; kind: MoveKind }[] = [];
  if (mode === 'conflict') {
    const weekStart = current.weekIndex * 7;
    for (let d = weekStart; d < weekStart + 7; d++) {
      days.push({ dayIndex: d, kind: d === current.dayIndex ? 'same-day' : 'same-week' });
    }
    for (let d = weekStart + 7; d < weekStart + 7 + NEXT_WEEK_DAYS; d++) {
      days.push({ dayIndex: d, kind: 'next-week' });
    }
  } else {
    for (let d = today; d <= today + MAKEUP_HORIZON_DAYS; d++)
      days.push({ dayIndex: d, kind: 'makeup' });
  }

  const placementId = mode === 'conflict' ? session.id : `${session.id}.makeup`;
  const bestPerDay = new Map<number, MoveOption>();
  for (const { dayIndex, kind } of days) {
    if (dayIndex < today || instantAt(cal, dayIndex, 0) >= cal.rangeEnd) continue;
    const weekIndex = Math.floor(dayIndex / 7);

    for (const w of allowedWindows(ctx, discipline)) {
      for (let m = gridStart(w.start); m + duration <= w.end; m += SLOT_STEP_MINUTES) {
        const start = instantAt(cal, dayIndex, m);
        const end = start + duration * MINUTE;
        if (start <= now) continue;
        if (mode === 'conflict' && start === session.start && !search.allowCurrentStart) continue;

        const placement: Placement = {
          id: placementId,
          disciplineId: session.disciplineId,
          start,
          end,
          ...(session.customDuration ? { customDuration: true } : {}),
        };
        if (checkPlacement(ctx, placement, others).length > 0) continue;

        let cost: number;
        if (kind === 'same-day') cost = 0;
        else if (kind === 'same-week') cost = 10 + 2 * Math.abs(dayIndex - current.dayIndex);
        else if (kind === 'next-week') cost = 30 + 2 * (dayIndex - current.weekIndex * 7 - 7);
        else cost = 5 + 2 * Math.max(0, dayIndex - original.dayIndex);
        cost += (3 * Math.abs(m - original.minuteOfDay)) / 60;
        if (sameDisciplineDays.has(dayIndex - 1)) cost += 15;
        if (sameDisciplineDays.has(dayIndex + 1)) cost += 15;
        cost += gapPenalty(ownDays, dayIndex, maxGap);
        if ((dayCount.get(dayIndex) ?? 0) > 0) cost += 8;
        cost -= m % 60 === 0 ? 1 : m % 30 === 0 ? 0.5 : 0;

        const prev = bestPerDay.get(dayIndex);
        if (prev && prev.cost <= cost) continue;
        const loadWithout = loads[weekIndex] ?? 0;
        bestPerDay.set(dayIndex, {
          start,
          end,
          kind,
          cost,
          label: `${formatInterval(start, end, cal.zone)} · ${KIND_LABEL[kind]}`,
          weekIndex,
          weekLoadBefore:
            loadWithout + (mode === 'conflict' && current.weekIndex === weekIndex ? duration : 0),
          weekLoadAfter: loadWithout + duration,
        });
      }
    }
  }

  return [...bestPerDay.values()]
    .sort((a, b) => a.cost - b.cost || a.start - b.start)
    .slice(0, limit);
}

export function describeEvents(events: readonly BusyEvent[]): string {
  const names = events.map((e) => `«${e.title ?? 'занято'}»`);
  return `событие ${names.join(', ')}`;
}

/** Переносит занятие, запоминая исходное место и причину. */
export function applyMove(
  sessions: readonly Session[],
  sessionId: string,
  option: { start: Instant; end: Instant },
  reason: string,
): Session[] {
  return sessions.map((s) =>
    s.id === sessionId
      ? {
          ...s,
          start: option.start,
          end: option.end,
          origin: s.origin === 'skeleton' ? 'moved' : s.origin,
          originalStart: s.originalStart ?? s.start,
          moveReason: reason,
        }
      : s,
  );
}

/** Добавляет отработку пропущенного занятия. */
export function addMakeup(
  sessions: readonly Session[],
  missedId: string,
  option: { start: Instant; end: Instant },
): Session[] {
  const missed = sessions.find((s) => s.id === missedId);
  if (!missed) throw new Error(`Неизвестное занятие: ${missedId}`);
  const makeup: Session = {
    id: `${missed.id}.makeup`,
    disciplineId: missed.disciplineId,
    start: option.start,
    end: option.end,
    status: 'planned',
    origin: 'makeup',
    originalStart: missed.start,
    moveReason: 'отработка пропуска',
    ...(missed.customDuration ? { customDuration: true } : {}),
  };
  return [...sessions.filter((s) => s.id !== makeup.id), makeup].sort(
    (a, b) => a.start - b.start || a.id.localeCompare(b.id),
  );
}

export interface WeekLoadChange {
  weekIndex: number;
  beforeMinutes: number;
  afterMinutes: number;
  capMinutes: number;
}

/** Как изменится нагрузка по неделям — итог внизу окна разбора пропусков (раздел 8). */
export function loadPreview(
  ctx: RuleContext,
  before: readonly Session[],
  after: readonly Session[],
): WeekLoadChange[] {
  const a = weeklyLoads(ctx.cal, before);
  const b = weeklyLoads(ctx.cal, after);
  return a
    .map((beforeMinutes, weekIndex) => ({
      weekIndex,
      beforeMinutes,
      afterMinutes: b[weekIndex]!,
      capMinutes: ctx.settings.maxWeeklyMinutes,
    }))
    .filter((w) => w.beforeMinutes !== w.afterMinutes);
}

/** Занятия, которые не начаты до конца своего времени. */
export function detectMissed(sessions: readonly Session[], now: Instant): string[] {
  return sessions.filter((s) => s.status === 'planned' && s.end <= now).map((s) => s.id);
}

/** Проверка ручного переноса (перетаскивание или правка в Google). */
export function checkManualMove(
  ctx: RuleContext,
  sessions: readonly Session[],
  sessionId: string,
  start: Instant,
): Violation[] {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Неизвестное занятие: ${sessionId}`);
  const end = start + (session.end - session.start);
  return checkPlacement(
    ctx,
    {
      id: session.id,
      disciplineId: session.disciplineId,
      start,
      end,
      ...(session.customDuration ? { customDuration: true } : {}),
    },
    sessions.filter((s) => s.id !== session.id),
  );
}

/**
 * Автоматически переносит занятия, которые в конкретную неделю попали на событие
 * (при построении черновика). Основные — первыми. Что перенести не удалось — возвращается.
 */
export function resolveConflictsAutomatically(
  ctx: RuleContext,
  sessions: readonly Session[],
  now: Instant,
  options: {
    /** Разбирать только эти занятия (например, только что добавленные). */
    onlyIds?: ReadonlySet<string>;
    frequencies?: Readonly<Record<string, Frequency>>;
  } = {},
): {
  sessions: Session[];
  moved: number;
  unresolved: { sessionId: string; events: BusyEvent[] }[];
} {
  const { onlyIds, frequencies } = options;
  let current = [...sessions];
  const priorityRank = (s: Session) =>
    getDiscipline(ctx, s.disciplineId).priority === 'main' ? 0 : 1;
  const conflicting = current
    .filter(
      (s) =>
        s.status === 'planned' &&
        s.start > now &&
        (!onlyIds || onlyIds.has(s.id)) &&
        !ctx.busy.isFree(s.start, s.end),
    )
    .sort((a, b) => priorityRank(a) - priorityRank(b) || a.start - b.start);

  let moved = 0;
  const unresolved: { sessionId: string; events: BusyEvent[] }[] = [];
  for (const s of conflicting) {
    const events = ctx.busy.overlapping(s.start, s.end);
    const frequency = frequencies?.[s.disciplineId];
    const [best] = findMoveOptions(ctx, current, s.id, now, 'conflict', {
      limit: 1,
      ...(frequency === undefined ? {} : { frequency }),
    });
    if (best) {
      current = applyMove(current, s.id, best, describeEvents(events));
      moved++;
    } else {
      unresolved.push({ sessionId: s.id, events });
    }
  }
  current.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return { sessions: current, moved, unresolved };
}

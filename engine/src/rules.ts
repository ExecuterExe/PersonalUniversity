import { BusyIndex } from './busy';
import {
  formatClock,
  formatDuration,
  formatInterval,
  formatWindow,
  plural,
  SESSION_FORMS,
} from './format';
import { DAY, durationMinutes, localInfo, makeCalendar, type SemesterCalendar } from './time';
import type {
  BusyEvent,
  Discipline,
  Instant,
  SemesterSpec,
  SessionStatus,
  Settings,
  TimeWindow,
  Violation,
  ViolationCode,
} from './types';

/** Всё, что нужно для проверки жёстких правил. */
export interface RuleContext {
  cal: SemesterCalendar;
  settings: Settings;
  disciplines: Map<string, Discipline>;
  busy: BusyIndex;
}

export function makeRuleContext(
  semester: SemesterSpec,
  settings: Settings,
  disciplines: readonly Discipline[],
  busy: readonly BusyEvent[],
): RuleContext {
  return {
    cal: makeCalendar(semester, settings.timezone),
    settings,
    disciplines: new Map(disciplines.map((d) => [d.id, d])),
    busy: new BusyIndex(busy, settings.bufferMinutes),
  };
}

export function getDiscipline(ctx: RuleContext, id: string): Discipline {
  const d = ctx.disciplines.get(id);
  if (!d) throw new Error(`Неизвестная дисциплина: ${id}`);
  return d;
}

export function allowedWindows(ctx: RuleContext, discipline: Discipline): TimeWindow[] {
  return [...ctx.settings.studyWindows, ...(discipline.extraWindows ?? [])];
}

/** Занятие на проверку: новое место или уже стоящее в плане. */
export interface Placement {
  id?: string;
  disciplineId: string;
  start: Instant;
  end: Instant;
  status?: SessionStatus;
  customDuration?: boolean;
}

/** Пропущенные, пропущенные по выбору и отменённые занятия места не занимают. */
export function occupiesTime(p: { status?: SessionStatus }): boolean {
  return p.status === undefined || p.status === 'planned' || p.status === 'held';
}

/**
 * Проверяет все жёсткие правила методологии для одного занятия.
 * Пустой список — занятие можно ставить.
 */
export function checkPlacement(
  ctx: RuleContext,
  p: Placement,
  others: readonly Placement[],
): Violation[] {
  const { cal, settings } = ctx;
  const discipline = getDiscipline(ctx, p.disciplineId);
  const info = localInfo(cal, p.start);
  const duration = durationMinutes(p);
  const violations: Violation[] = [];

  if (p.start < cal.rangeStart || p.end > cal.rangeEnd) {
    violations.push({ code: 'outside-semester', message: 'Вне дат семестра' });
  }

  if (!p.customDuration && duration !== discipline.durationMinutes) {
    violations.push({
      code: 'duration',
      message: `Длительность ${formatDuration(duration)} вместо ${formatDuration(discipline.durationMinutes)}`,
    });
  }

  if (settings.excludedWeekdays.includes(info.weekday)) {
    violations.push({ code: 'excluded-day', message: 'Этот день отмечен как неудобный' });
  }

  const windows = allowedWindows(ctx, discipline);
  const endMinute = info.minuteOfDay + duration;
  if (!windows.some((w) => info.minuteOfDay >= w.start && endMinute <= w.end)) {
    violations.push({
      code: 'outside-window',
      message: `${formatClock(info.minuteOfDay)}–${formatClock(endMinute)} вне окон для учёбы (${windows.map(formatWindow).join(', ') || 'окна не заданы'})`,
    });
  }

  const busy = ctx.busy.overlapping(p.start, p.end);
  if (busy.length > 0) {
    const names = busy.map((e) => `«${e.title ?? 'занято'}»`).join(', ');
    violations.push({
      code: 'busy',
      message: busy.every((e) => e.noBuffer)
        ? `Попадает на неудобное время: ${names}`
        : `Пересекается с ${names} с учётом буфера ${settings.bufferMinutes} мин`,
    });
  }

  // Соседей по дню и неделе ищем только среди близких по времени — так быстрее.
  const near = others.filter(
    (o) =>
      !(p.id !== undefined && o.id === p.id) &&
      occupiesTime(o) &&
      o.start < p.end + 7 * DAY &&
      o.end > p.start - 7 * DAY,
  );
  const sameWeek: Placement[] = [];
  const sameDay: Placement[] = [];
  for (const o of near) {
    const oi = localInfo(cal, o.start);
    if (oi.weekIndex === info.weekIndex) sameWeek.push(o);
    if (oi.dateKey === info.dateKey) sameDay.push(o);
  }

  if (sameDay.length >= settings.maxSessionsPerDay) {
    violations.push({
      code: 'sessions-per-day',
      message: `В этот день уже ${sameDay.length} ${plural(sameDay.length, SESSION_FORMS)} — больше ${settings.maxSessionsPerDay} нельзя`,
    });
  }

  if (sameDay.some((o) => o.disciplineId === p.disciplineId)) {
    violations.push({
      code: 'same-discipline-day',
      message: `«${discipline.name}» уже стоит в этот день`,
    });
  }

  const gap = settings.bufferMinutes * 60_000;
  const tooClose = sameDay.find((o) => o.start < p.end + gap && o.end + gap > p.start);
  if (tooClose) {
    violations.push({
      code: 'session-gap',
      message: `Слишком близко к занятию ${formatInterval(tooClose.start, tooClose.end, cal.zone)} — нужен буфер ${settings.bufferMinutes} мин`,
    });
  }

  const dayTotal = sameDay.reduce((sum, o) => sum + durationMinutes(o), 0) + duration;
  if (dayTotal > settings.maxDailyMinutes) {
    violations.push({
      code: 'daily-cap',
      message: `За день выйдет ${formatDuration(dayTotal)} — лимит ${formatDuration(settings.maxDailyMinutes)}`,
    });
  }

  const weekTotal = sameWeek.reduce((sum, o) => sum + durationMinutes(o), 0) + duration;
  if (weekTotal > settings.maxWeeklyMinutes) {
    violations.push({
      code: 'weekly-cap',
      message: `За неделю выйдет ${formatDuration(weekTotal)} — лимит ${formatDuration(settings.maxWeeklyMinutes)}`,
    });
  }

  return violations;
}

/** Нарушения, кроме тех, на которые пользователь уже согласился для этого занятия. */
export function unaccepted(
  violations: readonly Violation[],
  accepted: readonly ViolationCode[] = [],
): Violation[] {
  return violations.filter((v) => !accepted.includes(v.code));
}

/** Нагрузка по неделям семестра, минуты. */
export function weeklyLoads(cal: SemesterCalendar, sessions: readonly Placement[]): number[] {
  const loads = new Array<number>(cal.weeks).fill(0);
  for (const s of sessions) {
    if (!occupiesTime(s)) continue;
    const w = localInfo(cal, s.start).weekIndex;
    if (w >= 0 && w < cal.weeks) loads[w]! += durationMinutes(s);
  }
  return loads;
}

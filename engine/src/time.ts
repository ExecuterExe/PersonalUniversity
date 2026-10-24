import { DateTime } from 'luxon';
import type { Instant, SemesterSpec, Weekday } from './types';

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** Один местный день семестра — заранее посчитан, чтобы не дёргать часовой пояс в горячих циклах. */
interface CalendarDay {
  start: Instant;
  end: Instant;
  dateKey: string;
  /** В этот день не меняется смещение часового пояса — время можно считать сложением. */
  uniform: boolean;
}

export interface SemesterCalendar {
  zone: string;
  weeks: number;
  /** Понедельник 00:00 первой недели семестра. */
  firstMonday: DateTime;
  /** Начало первого дня семестра. */
  rangeStart: Instant;
  /** Понедельник 00:00 после последней недели. */
  rangeEnd: Instant;
  /** Дни семестра плюс неделя после него (для переносов на следующую неделю). */
  days: CalendarDay[];
}

export function makeCalendar(spec: SemesterSpec, zone: string): SemesterCalendar {
  const start = DateTime.fromISO(spec.startDate, { zone }).startOf('day');
  if (!start.isValid) throw new Error(`Некорректная дата начала семестра: ${spec.startDate}`);
  if (!Number.isInteger(spec.weeks) || spec.weeks < 1) {
    throw new Error(`Число недель семестра должно быть целым и больше нуля: ${spec.weeks}`);
  }
  const firstMonday = start.minus({ days: start.weekday - 1 });
  const days: CalendarDay[] = [];
  let day = firstMonday;
  for (let i = 0; i < (spec.weeks + 1) * 7; i++) {
    const next = day.plus({ days: 1 });
    days.push({
      start: day.toMillis(),
      end: next.toMillis(),
      dateKey: day.toISODate() ?? '',
      uniform: day.offset === next.offset && next.toMillis() - day.toMillis() === DAY,
    });
    day = next;
  }
  return {
    zone,
    weeks: spec.weeks,
    firstMonday,
    rangeStart: start.toMillis(),
    rangeEnd: firstMonday.plus({ weeks: spec.weeks }).toMillis(),
    days,
  };
}

/** Момент «день семестра + время по часам». */
export function instantAt(cal: SemesterCalendar, dayIndex: number, minuteOfDay: number): Instant {
  const day = cal.days[dayIndex];
  if (day?.uniform) return day.start + minuteOfDay * MINUTE;
  return atMinute(cal.firstMonday.plus({ days: dayIndex }), minuteOfDay).toMillis();
}

/** Полночь указанного дня недели в неделе семестра. */
export function dayStart(cal: SemesterCalendar, weekIndex: number, weekday: Weekday): DateTime {
  return cal.firstMonday.plus({ days: weekIndex * 7 + (weekday - 1) });
}

/** Время по часам в указанный день: устойчиво к переходу на летнее время. */
export function atMinute(day: DateTime, minuteOfDay: number): DateTime {
  return day.set({
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    second: 0,
    millisecond: 0,
  });
}

export function slotInterval(
  cal: SemesterCalendar,
  weekIndex: number,
  weekday: Weekday,
  startMinute: number,
  durationMinutes: number,
): { start: Instant; end: Instant } {
  const start = instantAt(cal, weekIndex * 7 + weekday - 1, startMinute);
  return { start, end: start + durationMinutes * MINUTE };
}

export interface LocalInfo {
  weekIndex: number;
  weekday: Weekday;
  minuteOfDay: number;
  /** YYYY-MM-DD местного дня. */
  dateKey: string;
  /** Номер дня от понедельника первой недели. */
  dayIndex: number;
}

export function localInfo(cal: SemesterCalendar, instant: Instant): LocalInfo {
  const { days } = cal;
  if (days.length > 0 && instant >= days[0]!.start && instant < days[days.length - 1]!.end) {
    let lo = 0;
    let hi = days.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (days[mid]!.start <= instant) lo = mid;
      else hi = mid - 1;
    }
    const day = days[lo]!;
    if (day.uniform) {
      return {
        weekIndex: Math.floor(lo / 7),
        weekday: ((lo % 7) + 1) as Weekday,
        minuteOfDay: Math.floor((instant - day.start) / MINUTE),
        dateKey: day.dateKey,
        dayIndex: lo,
      };
    }
  }
  const dt = DateTime.fromMillis(instant, { zone: cal.zone });
  const day = dt.startOf('day');
  const dayIndex = Math.round(day.diff(cal.firstMonday, 'days').days);
  return {
    weekIndex: Math.floor(dayIndex / 7),
    weekday: dt.weekday as Weekday,
    minuteOfDay: dt.hour * 60 + dt.minute,
    dateKey: day.toISODate() ?? '',
    dayIndex,
  };
}

export function durationMinutes(interval: { start: Instant; end: Instant }): number {
  return Math.round((interval.end - interval.start) / MINUTE);
}

export function overlaps(
  a: { start: Instant; end: Instant },
  b: { start: Instant; end: Instant },
): boolean {
  return a.start < b.end && b.start < a.end;
}

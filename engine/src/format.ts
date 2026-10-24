import { DateTime } from 'luxon';
import type { Frequency, Instant, TimeWindow, Weekday } from './types';

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
  7: 'Вс',
};

/** «в понедельник», «во вторник» … */
export const WEEKDAY_ON: Record<Weekday, string> = {
  1: 'в понедельник',
  2: 'во вторник',
  3: 'в среду',
  4: 'в четверг',
  5: 'в пятницу',
  6: 'в субботу',
  7: 'в воскресенье',
};

export function formatClock(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatWindow(w: TimeWindow): string {
  return `${formatClock(w.start)}–${formatClock(w.end)}`;
}

/** 90 → «1 ч 30 мин», 45 → «45 мин», 120 → «2 ч». */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/** 450 → «7,5 ч». */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${String(hours).replace('.', ',')} ч`;
}

export function formatFrequency(f: Frequency): string {
  switch (f) {
    case 0.5:
      return 'раз в 2 недели';
    case 1:
      return '1 раз в неделю';
    case 2:
      return '2 раза в неделю';
    case 3:
      return '3 раза в неделю';
  }
}

/** «Вт 04.11 18:00» */
export function formatMoment(instant: Instant, zone: string): string {
  const dt = DateTime.fromMillis(instant, { zone });
  return `${WEEKDAY_SHORT[dt.weekday as Weekday]} ${dt.toFormat('dd.LL HH:mm')}`;
}

/** «Вт 04.11, 18:00–19:30» */
export function formatInterval(start: Instant, end: Instant, zone: string): string {
  const s = DateTime.fromMillis(start, { zone });
  const e = DateTime.fromMillis(end, { zone });
  return `${WEEKDAY_SHORT[s.weekday as Weekday]} ${s.toFormat('dd.LL')}, ${s.toFormat('HH:mm')}–${e.toFormat('HH:mm')}`;
}

/** plural(3, ['занятие', 'занятия', 'занятий']) → «занятия» */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export const SESSION_FORMS = ['занятие', 'занятия', 'занятий'] as const;

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

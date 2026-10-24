import { instantAt, type SemesterCalendar } from './time';
import type { BusyEvent, TimeWindow, Weekday } from './types';

/** Время, когда учиться неудобно, — например, пары. Сервис его не занимает и не предлагает. */
export interface InconvenientTime {
  start: number;
  end: number;
  weekdays: Weekday[];
  label: string;
}

/** Неудобное время как занятость — на все дни семестра и неделю после. */
export function inconvenientBusy(
  cal: SemesterCalendar,
  items: readonly InconvenientTime[],
): BusyEvent[] {
  const events: BusyEvent[] = [];
  for (let dayIndex = 0; dayIndex < cal.days.length; dayIndex++) {
    const weekday = ((dayIndex % 7) + 1) as Weekday;
    for (const item of items) {
      if (!item.weekdays.includes(weekday) || item.end <= item.start) continue;
      events.push({
        start: instantAt(cal, dayIndex, item.start),
        end:
          item.end >= 24 * 60
            ? instantAt(cal, dayIndex + 1, 0)
            : instantAt(cal, dayIndex, item.end),
        title: item.label,
        recurringId: `inconvenient/${item.label}/${weekday}/${item.start}`,
        noBuffer: true,
      });
    }
  }
  return events;
}

/** window без всех блоков: [8–12] без [10–13] → [8–10]. */
export function subtractWindows(window: TimeWindow, blocks: readonly TimeWindow[]): TimeWindow[] {
  let pieces: TimeWindow[] = [window];
  for (const b of blocks) {
    pieces = pieces.flatMap((p) => {
      if (b.end <= p.start || b.start >= p.end) return [p];
      const left = { start: p.start, end: Math.max(p.start, b.start) };
      const right = { start: Math.min(p.end, b.end), end: p.end };
      return [left, right].filter((x) => x.end > x.start);
    });
  }
  return pieces;
}

const MIN_COMPROMISE_WINDOW = 30;

/**
 * Окна, которые можно предложить в компромиссе: части дня минус уже выбранные окна
 * и минус неудобное время, действующее во все дни.
 */
export function compromiseWindows(
  dayParts: readonly TimeWindow[],
  studyWindows: readonly TimeWindow[],
  inconvenient: readonly InconvenientTime[],
): TimeWindow[] {
  const blocks = [...studyWindows, ...inconvenient.filter((i) => i.weekdays.length === 7)];
  return dayParts
    .flatMap((p) => subtractWindows(p, blocks))
    .filter((w) => w.end - w.start >= MIN_COMPROMISE_WINDOW);
}

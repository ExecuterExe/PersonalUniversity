import { formatClock, WEEKDAY_SHORT, type Weekday } from '@ou/engine';
import { DateTime } from 'luxon';
import type { Instant, SessionView } from './types';

export {
  formatClock,
  formatDuration,
  formatFrequency,
  formatHours,
  formatPercent,
  formatWindow,
  WEEKDAY_SHORT,
} from '@ou/engine';

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export const local = (instant: Instant, zone: string) => DateTime.fromMillis(instant, { zone });

/** «18:30» */
export const time = (instant: Instant, zone: string) => local(instant, zone).toFormat('HH:mm');

/** «Пн 26.10» */
export function day(instant: Instant, zone: string): string {
  const dt = local(instant, zone);
  return `${WEEKDAY_SHORT[dt.weekday as Weekday]} ${dt.toFormat('dd.LL')}`;
}

/** «Пн 26.10, 10:00–11:30» */
export const range = (start: Instant, end: Instant, zone: string) =>
  `${day(start, zone)}, ${time(start, zone)}–${time(end, zone)}`;

/** Значение для <input type="datetime-local"> и обратно — в часовом поясе настроек. */
export const toInput = (instant: Instant, zone: string) =>
  local(instant, zone).toFormat("yyyy-LL-dd'T'HH:mm");
export const fromInput = (value: string, zone: string) =>
  DateTime.fromISO(value, { zone }).toMillis();

/** Минуты от полуночи ↔ «HH:MM» для <input type="time">. */
export const minutesToInput = (m: number) => (m >= 24 * 60 ? '24:00' : formatClock(m));
export function inputToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** «12:05» или «1:29:37» из миллисекунд. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const STATUS: Record<SessionView['status'], string> = {
  planned: 'запланировано',
  held: 'проведено',
  missed: 'пропущено',
  skipped: 'пропущено заранее',
  cancelled: 'отменено',
};

export const ORIGIN: Record<SessionView['origin'], string> = {
  skeleton: '',
  moved: 'перенесено',
  manual: 'перенесено вручную',
  makeup: 'отработка',
  unplanned: 'внеплановое',
};

export const PRIORITY = { main: 'основная', additional: 'дополнительная' } as const;

/** Понедельник недели, в которой момент, — полночь в часовом поясе. */
export const weekStart = (instant: Instant, zone: string) =>
  local(instant, zone).startOf('week').toMillis();

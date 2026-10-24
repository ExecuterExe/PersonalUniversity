import type { Priority, Settings, TimeWindow } from './types';

export const DAY_PARTS = {
  morning: { start: 8 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 22 * 60 },
} as const satisfies Record<string, TimeWindow>;

/** Шаг сетки времени начала занятий. */
export const SLOT_STEP_MINUTES = 15;

/** Слот берётся в каркас, только если свободен хотя бы в такой доле недель. */
export const MIN_SLOT_ROBUSTNESS = 0.5;

/** Перенос пропущенного занятия ищется в этих пределах. */
export const MAKEUP_HORIZON_DAYS = 7;

export const TARGET_FREQUENCY = { main: 3, additional: 1 } as const satisfies Record<
  Priority,
  number
>;

/** Ниже этого сервис сам не опускается — только через компромисс. */
export const MIN_FREQUENCY = { main: 2, additional: 1 } as const satisfies Record<Priority, number>;

export const ALLOWED_DURATIONS = [30, 45, 60, 75, 90] as const;

export function defaultSettings(
  timezone: string,
  studyWindows: TimeWindow[] = [DAY_PARTS.evening],
): Settings {
  const parts: TimeWindow[] = Object.values(DAY_PARTS);
  return {
    timezone,
    excludedWeekdays: [],
    studyWindows,
    otherWindows: parts.filter((p) => !studyWindows.some((w) => w.start === p.start)),
    bufferMinutes: 15,
    maxDailyMinutes: 180,
    maxWeeklyMinutes: 600,
    maxSessionsPerDay: 2,
  };
}

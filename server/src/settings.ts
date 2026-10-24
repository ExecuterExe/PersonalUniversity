import {
  compromiseWindows,
  DAY_PARTS,
  DEFAULT_POMODORO,
  type InconvenientTime,
  type PomodoroSettings,
  type Settings,
  type TimeWindow,
  type Weekday,
} from '@ou/engine';
import { z } from 'zod';

/** Настройки пользователя. Правила конкретного семестра выводятся из них (см. toEngineSettings). */
export interface AppSettings {
  timezone: string;
  studyWindows: TimeWindow[];
  /** Когда учиться неудобно: сервис туда ничего не ставит и в компромиссах не предлагает. */
  inconvenient: InconvenientTime[];
  excludedWeekdays: Weekday[];
  bufferMinutes: number;
  maxDailyMinutes: number;
  maxWeeklyMinutes: number;
  maxSessionsPerDay: number;
  pomodoro: PomodoroSettings;
  /** Длина нового семестра в полных неделях. */
  defaultSemesterWeeks: number;
}

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
}

export function defaultAppSettings(timezone = systemTimezone()): AppSettings {
  return {
    timezone,
    studyWindows: [{ ...DAY_PARTS.evening }],
    inconvenient: [],
    excludedWeekdays: [],
    bufferMinutes: 15,
    maxDailyMinutes: 180,
    maxWeeklyMinutes: 600,
    maxSessionsPerDay: 2,
    pomodoro: { ...DEFAULT_POMODORO },
    defaultSemesterWeeks: 12,
  };
}

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('ru', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const minuteOfDay = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);
export const windowSchema = z
  .object({ start: minuteOfDay, end: minuteOfDay })
  .refine((w) => w.end > w.start, 'Конец окна должен быть позже начала');
export const weekdaySchema = z
  .number()
  .int()
  .min(1)
  .max(7)
  .transform((d) => d as Weekday);

export const appSettingsSchema = z.object({
  timezone: z.string().refine(isValidZone, 'Неизвестный часовой пояс'),
  studyWindows: z.array(windowSchema).min(1, 'Нужно хотя бы одно окно для учёбы'),
  inconvenient: z.array(
    z
      .object({
        start: minuteOfDay,
        end: minuteOfDay,
        weekdays: z.array(weekdaySchema).min(1, 'Укажи хотя бы один день'),
        label: z.string().trim().min(1, 'Подпиши неудобное время').max(60),
      })
      .refine((w) => w.end > w.start, 'Конец неудобного времени должен быть позже начала'),
  ),
  excludedWeekdays: z.array(weekdaySchema).max(6, 'Хотя бы один день должен остаться для учёбы'),
  bufferMinutes: z.number().int().min(0).max(120),
  maxDailyMinutes: z
    .number()
    .int()
    .min(30)
    .max(12 * 60),
  maxWeeklyMinutes: z
    .number()
    .int()
    .min(30)
    .max(7 * 12 * 60),
  maxSessionsPerDay: z.number().int().min(1).max(4),
  pomodoro: z.object({
    focusMinutes: z.number().int().min(5).max(120),
    breakMinutes: z.number().int().min(1).max(60),
    longBreakMinutes: z.number().int().min(1).max(90),
    cyclesBeforeLongBreak: z.number().int().min(1).max(10),
  }),
  defaultSemesterWeeks: z.number().int().min(1).max(52),
});

/** Правила для движка: настройки пользователя плюс то, на что он согласился в компромиссах семестра. */
export function toEngineSettings(app: AppSettings, patch: Partial<Settings> = {}): Settings {
  return {
    timezone: app.timezone,
    excludedWeekdays: app.excludedWeekdays,
    studyWindows: app.studyWindows,
    otherWindows: compromiseWindows(Object.values(DAY_PARTS), app.studyWindows, app.inconvenient),
    bufferMinutes: app.bufferMinutes,
    maxDailyMinutes: app.maxDailyMinutes,
    maxWeeklyMinutes: app.maxWeeklyMinutes,
    maxSessionsPerDay: app.maxSessionsPerDay,
    pomodoro: app.pomodoro,
    ...patch,
  };
}

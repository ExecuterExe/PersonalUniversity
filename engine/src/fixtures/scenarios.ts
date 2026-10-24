// Тестовые сценарии: искусственные календари для тестов и симулятора.
import { DateTime } from 'luxon';
import type { PlanInput } from '../build';
import { DAY_PARTS, defaultSettings } from '../defaults';
import type { BusyEvent, Discipline, Settings, Weekday } from '../types';

export const ZONE = 'Europe/Moscow';
/** Понедельник. */
export const SEMESTER_START = '2026-11-02';
export const WEEKS = 12;
/** Воскресенье накануне семестра. */
export const NOW = DateTime.fromISO('2026-11-01T12:00', { zone: ZONE }).toMillis();

export const DISCIPLINES = {
  biases: { id: 'biases', name: 'Когнитивные искажения', priority: 'main', durationMinutes: 90 },
  fallacies: { id: 'fallacies', name: 'Логические ошибки', priority: 'main', durationMinutes: 90 },
  thinking: {
    id: 'thinking',
    name: 'Критическое мышление',
    priority: 'additional',
    durationMinutes: 60,
  },
  rhetoric: { id: 'rhetoric', name: 'Риторика', priority: 'additional', durationMinutes: 45 },
} as const satisfies Record<string, Discipline>;

const firstMonday = () => DateTime.fromISO(SEMESTER_START, { zone: ZONE }).startOf('week');

function at(day: DateTime, clock: string): DateTime {
  const [h, m] = clock.split(':').map(Number) as [number, number];
  return day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

/** Событие каждую неделю: weekly([1, 2], '09:00', '18:00', 'Работа'). */
export function weekly(
  weekdays: readonly Weekday[],
  from: string,
  to: string,
  title: string,
  options: { fromWeek?: number; toWeek?: number; recurringId?: string } = {},
): BusyEvent[] {
  const events: BusyEvent[] = [];
  const monday = firstMonday();
  for (let w = options.fromWeek ?? 0; w < (options.toWeek ?? WEEKS); w++) {
    for (const wd of weekdays) {
      const day = monday.plus({ days: w * 7 + wd - 1 });
      events.push({
        start: at(day, from).toMillis(),
        end: at(day, to).toMillis(),
        title,
        recurringId: options.recurringId ?? `${title}/${wd}/${from}`,
      });
    }
  }
  return events;
}

/** Разовое событие: oneOff('2026-11-10', '19:00', '21:00', 'Концерт'). */
export function oneOff(date: string, from: string, to: string, title: string): BusyEvent {
  const day = DateTime.fromISO(date, { zone: ZONE });
  return { start: at(day, from).toMillis(), end: at(day, to).toMillis(), title };
}

/** Момент внутри семестра: moment(4, 1, '08:00') — понедельник пятой недели. */
export function moment(weekIndex: number, weekday: Weekday, clock: string): number {
  return at(firstMonday().plus({ days: weekIndex * 7 + weekday - 1 }), clock).toMillis();
}

export function settings(patch: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(ZONE, patch.studyWindows), ...patch };
}

export function input(patch: Partial<PlanInput> = {}): PlanInput {
  return {
    semester: { startDate: SEMESTER_START, weeks: WEEKS },
    settings: settings(),
    disciplines: [DISCIPLINES.biases, DISCIPLINES.fallacies, DISCIPLINES.thinking],
    busy: weekly([1, 2, 3, 4, 5], '09:00', '18:00', 'Работа'),
    now: NOW,
    ...patch,
  };
}

/** Детерминированный генератор случайных чисел для «рваного» календаря. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Каждая неделя разная: вечерние встречи в случайные дни. */
export function raggedEvenings(seed: number, perWeek = 3): BusyEvent[] {
  const random = seededRandom(seed);
  const events: BusyEvent[] = [];
  const monday = firstMonday();
  for (let w = 0; w < WEEKS; w++) {
    for (let i = 0; i < perWeek; i++) {
      const wd = 1 + Math.floor(random() * 7);
      const startHour = 17 + Math.floor(random() * 4);
      const day = monday.plus({ days: w * 7 + wd - 1 });
      const start = at(day, `${startHour}:${random() < 0.5 ? '00' : '30'}`);
      events.push({
        start: start.toMillis(),
        end: start.plus({ minutes: 60 + Math.floor(random() * 3) * 30 }).toMillis(),
        title: `Встреча ${w + 1}.${i + 1}`,
      });
    }
  }
  return events;
}

export interface Scenario {
  name: string;
  description: string;
  input: PlanInput;
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'free',
    description: 'Работа в будни 9–18, учёба вечером: обычная неделя',
    input: input({ disciplines: Object.values(DISCIPLINES) }),
  },
  {
    name: 'busy-mornings',
    description: 'Хочу учиться только утром, а утро в будни занято работой (пример из обсуждения)',
    input: input({
      settings: settings({ studyWindows: [DAY_PARTS.morning], excludedWeekdays: [6, 7] }),
    }),
  },
  {
    name: 'ragged',
    description: 'Рваный календарь: каждую неделю вечерние встречи в разные дни',
    input: input({
      busy: [...weekly([1, 2, 3, 4, 5], '09:00', '18:00', 'Работа'), ...raggedEvenings(7)],
    }),
  },
  {
    name: 'overload',
    description: 'Перегруз: даже на минимальной частоте не помещается в 10 ч в неделю',
    input: input({
      disciplines: [
        DISCIPLINES.biases,
        DISCIPLINES.fallacies,
        { id: 'models', name: 'Ментальные модели', priority: 'main', durationMinutes: 90 },
        { ...DISCIPLINES.thinking, durationMinutes: 90 },
        { ...DISCIPLINES.rhetoric, durationMinutes: 90 },
      ],
    }),
  },
];

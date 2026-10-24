// Приложение для тестов: база в памяти, управляемые часы и календарь.
import type { BusyEvent } from '@ou/engine';
import { buildApp } from './app';
import { StaticCalendar } from './calendar';
import { loadConfig } from './config';
import { createDeps } from './deps';

/** Московское время (без перехода на летнее): msk('2026-10-26T10:00'). */
export const msk = (iso: string) => Date.parse(`${iso}:00+03:00`);

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

// В тестах удобно читать ответ API как есть, без описания всех типов.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;

/** Настройки как у пользователя: утро с 10:00, неудобно до 10:00 и во время пар. */
export const USER_SETTINGS = {
  timezone: 'Europe/Moscow',
  studyWindows: [{ start: 10 * 60, end: 13 * 60 }],
  inconvenient: [
    { start: 8 * 60, end: 10 * 60, weekdays: ALL_DAYS, label: 'Рано' },
    { start: 18 * 60 + 50, end: 22 * 60, weekdays: ALL_DAYS, label: 'Пары' },
  ],
  excludedWeekdays: [],
  bufferMinutes: 30,
  maxDailyMinutes: 180,
  maxWeeklyMinutes: 600,
  maxSessionsPerDay: 2,
  pomodoro: { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLongBreak: 4 },
  defaultSemesterWeeks: 12,
};

/**
 * Приложение с базой в памяти. С fetch — подключён (поддельный) Google и занятость берётся из него;
 * без — из списка events.
 */
export function testApp(start: number, events: BusyEvent[] = [], google?: { fetch: typeof fetch }) {
  let now = start;
  let counter = 0;
  const calendar = new StaticCalendar(events);
  const config = google
    ? loadConfig({
        GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'secret',
      })
    : loadConfig({});
  const deps = createDeps({
    dbPath: ':memory:',
    ...(google ? { config, fetch: google.fetch } : { calendar }),
    now: () => now,
    newId: () => `id${++counter}`,
  });
  const app = buildApp(config, deps);

  async function call(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<{ status: number; body: AnyJson; text: string; location?: string }> {
    const res = await app.inject({
      method,
      url,
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const json = res.headers['content-type']?.toString().includes('application/json');
    const location = res.headers.location?.toString();
    return {
      status: res.statusCode,
      body: json ? res.json() : null,
      text: res.body,
      ...(location ? { location } : {}),
    };
  }

  return {
    app,
    deps,
    calendar,
    call,
    setNow: (t: number) => {
      now = t;
    },
    advance: (minutes: number) => {
      now += minutes * 60_000;
    },
  };
}

export type TestApp = ReturnType<typeof testApp>;

export async function createDiscipline(
  t: TestApp,
  name: string,
  priority: 'main' | 'additional' = 'main',
  durationMinutes = 90,
) {
  const res = await t.call('POST', '/api/disciplines', {
    name,
    priority,
    durationMinutes,
    goal: `Разобраться в «${name}»`,
    metrics: 'Могу объяснить основы своими словами',
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string; name: string };
}

/** Настройки пользователя + две дисциплины + подтверждённый семестр с 25.10.2026. */
export async function userSemester(t: TestApp) {
  await t.call('PUT', '/api/settings', USER_SETTINGS);
  const tf = await createDiscipline(t, 'Трендфоркастинг');
  const sql = await createDiscipline(t, 'SQL');
  const draft = await t.call('POST', '/api/semesters/draft', {
    startDate: '2026-10-25',
    disciplineIds: [tf.id, sql.id],
  });
  if (draft.status !== 201) throw new Error(JSON.stringify(draft.body));
  const confirmed = await t.call('POST', '/api/semesters/draft/confirm');
  if (confirmed.status !== 200) throw new Error(JSON.stringify(confirmed.body));
  return { tf, sql, draft: draft.body, semester: confirmed.body };
}

/** Занятия в промежутке [from, to). */
export async function sessionsBetween(t: TestApp, from: number, to: number) {
  const res = await t.call('GET', `/api/schedule?from=${from}&to=${to}`);
  return res.body as {
    id: string;
    disciplineId: string;
    disciplineName: string;
    start: number;
    end: number;
    status: string;
    origin: string;
    moveReason?: string;
    acceptedViolations?: string[];
  }[];
}

export async function sessionAt(t: TestApp, iso: string) {
  const at = msk(iso);
  const [s] = await sessionsBetween(t, at, at + 60_000);
  if (!s) throw new Error(`Нет занятия в ${iso}`);
  return s;
}

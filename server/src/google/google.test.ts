import { describe, expect, it } from 'vitest';
import { createDiscipline, msk, sessionAt, testApp, USER_SETTINGS, type TestApp } from '../testing';
import { GOOGLE_SCOPES, type GoogleEvent } from './api';
import { FakeGoogle } from './fake';
import { toBusy } from './source';

const SATURDAY_EVENING = msk('2026-10-24T21:10');

function timed(
  day: string,
  from: string,
  to: string,
  summary: string,
  extra: Partial<GoogleEvent> = {},
) {
  return {
    summary,
    start: { dateTime: `${day}T${from}:00+03:00` },
    end: { dateTime: `${day}T${to}:00+03:00` },
    ...extra,
  };
}

function setup() {
  const google = new FakeGoogle();
  return { google, t: testApp(SATURDAY_EVENING, [], { fetch: google.fetch }) };
}

async function connect(t: TestApp) {
  const start = await t.call('GET', '/auth/google');
  const state = new URL(start.location!).searchParams.get('state')!;
  const back = await t.call('GET', `/auth/google/callback?code=good-code&state=${state}`);
  expect(back.location).toBe('http://localhost:5173/?google=connected');
}

/** Настройки пользователя, две дисциплины и черновик с 25.10.2026. */
async function draft(t: TestApp) {
  await t.call('PUT', '/api/settings', USER_SETTINGS);
  const tf = await createDiscipline(t, 'Трендфоркастинг');
  const sql = await createDiscipline(t, 'SQL');
  const res = await t.call('POST', '/api/semesters/draft', {
    startDate: '2026-10-25',
    disciplineIds: [tf.id, sql.id],
  });
  return res.body;
}

async function activeSemester(t: TestApp) {
  await draft(t);
  await t.call('POST', '/api/semesters/draft/confirm');
}

const moveEvent = (
  google: FakeGoogle,
  sessionId: string,
  day: string,
  from: string,
  to: string,
) => {
  const event = google.eventOf(sessionId)!;
  event.start = { dateTime: `${day}T${from}:00+03:00` };
  event.end = { dateTime: `${day}T${to}:00+03:00` };
};

const deleteEvent = (google: FakeGoogle, sessionId: string) => {
  const own = google.ownCalendar()!;
  google.events.get(own.id)!.delete(google.eventOf(sessionId)!.id);
};

describe('вход через Google', () => {
  it('минимальные права, постоянный доступ и защита от подделки', async () => {
    const { t } = setup();
    const start = await t.call('GET', '/auth/google');
    expect(start.status).toBe(302);
    const url = new URL(start.location!);
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(GOOGLE_SCOPES);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4100/auth/google/callback');

    const forged = await t.call('GET', '/auth/google/callback?code=good-code&state=чужой');
    expect(forged.location).toBe('http://localhost:5173/?google=expired');
    const denied = await t.call('GET', '/auth/google/callback?error=access_denied');
    expect(denied.location).toBe('http://localhost:5173/?google=denied');
    expect((await t.call('GET', '/api/google/status')).body.connected).toBe(false);

    await connect(t);
    expect((await t.call('GET', '/api/google/status')).body).toMatchObject({
      configured: true,
      connected: true,
      email: 'me@gmail.com',
      needsReauth: false,
    });
  });

  it('без ключей вход объясняет, что делать', async () => {
    const t = testApp(SATURDAY_EVENING);
    const res = await t.call('GET', '/auth/google');
    expect(res.status).toBe(400);
    expect(res.text).toContain('docs/google-setup.md');
  });
});

/** Событие в 10:00–13:00 в каждый такой день недели семестра (+ неделя после). */
function everyWeek(
  google: FakeGoogle,
  calendarId: string,
  weekday: number,
  summary: string,
  extra: Partial<GoogleEvent> = {},
) {
  const firstMonday = Date.UTC(2026, 9, 19); // 19.10.2026
  for (let w = 0; w < 14; w++) {
    const day = new Date(firstMonday + (w * 7 + weekday - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    google.addEvent(calendarId, timed(day, '10:00', '13:00', summary, extra));
  }
}

const weekdays = (skeleton: { weekday: number }[]) =>
  [...new Set(skeleton.map((s) => s.weekday))].sort();

describe('занятость из Google', () => {
  it('разбор событий: занятость — только то, что Google считает занятым', () => {
    const tz = 'Europe/Moscow';
    expect(toBusy({ id: '1', ...timed('2026-11-02', '10:00', '11:00', 'Встреча') }, tz)).toEqual({
      start: msk('2026-11-02T10:00'),
      end: msk('2026-11-02T11:00'),
      title: 'Встреча',
    });
    const free = {
      id: '2',
      ...timed('2026-11-02', '10:00', '11:00', 'Свободно'),
      transparency: 'transparent',
    };
    expect(toBusy(free, tz)).toBeNull();
    const declined = {
      id: '3',
      ...timed('2026-11-02', '10:00', '11:00', 'Отклонил'),
      attendees: [{ self: true, responseStatus: 'declined' }],
    };
    expect(toBusy(declined, tz)).toBeNull();
    expect(
      toBusy(
        { id: '4', ...timed('2026-11-02', '10:00', '11:00', 'Отмена'), status: 'cancelled' },
        tz,
      ),
    ).toBeNull();
    const location = {
      id: '5',
      ...timed('2026-11-02', '09:00', '18:00', 'Офис'),
      eventType: 'workingLocation',
    };
    expect(toBusy(location, tz)).toBeNull();
    const vacation = {
      id: '6',
      summary: 'Отпуск',
      start: { date: '2026-11-07' },
      end: { date: '2026-11-08' },
    };
    expect(toBusy(vacation, tz)).toEqual({
      start: msk('2026-11-07T00:00'),
      end: msk('2026-11-08T00:00'),
      title: 'Отпуск',
    });
    const repeated = {
      id: '7',
      ...timed('2026-11-02', '10:00', '11:00', 'Пара'),
      recurringEventId: 'r1',
    };
    expect(toBusy(repeated, tz)?.recurringId).toBe('r1');
  });

  it('свободное и отклонённое не мешает, занятое — мешает; календари можно выбрать', async () => {
    const { google, t } = setup();
    const me = 'me@gmail.com';
    for (let wd = 1; wd <= 7; wd++) {
      everyWeek(google, me, wd, 'Свободное время', { transparency: 'transparent' });
      everyWeek(google, me, wd, 'Отклонённая встреча', {
        attendees: [{ self: true, responseStatus: 'declined' }],
      });
    }
    everyWeek(google, me, 1, 'Встреча');
    google.addCalendar({ id: 'work@group', summary: 'Работа', accessRole: 'reader' });
    everyWeek(google, 'work@group', 2, 'Совещание');
    google.addCalendar({ id: 'colleague@x', summary: 'Коллега', accessRole: 'freeBusyReader' });
    await connect(t);

    const built = await draft(t);
    expect(built.failure).toBeNull();
    expect(weekdays(built.skeleton)).toEqual([3, 4, 5, 6, 7]); // без понедельника и вторника

    const calendars = (await t.call('GET', '/api/google/calendars')).body;
    expect(
      calendars.map((c: { summary: string; usable: boolean }) => [c.summary, c.usable]),
    ).toEqual([
      ['me@gmail.com', true],
      ['Работа', true],
      ['Коллега', false],
    ]);
    await t.call('PUT', '/api/google/calendars', { busyCalendarIds: [me] });
    const refreshed = (await t.call('POST', '/api/semesters/draft/refresh')).body;
    expect(weekdays(refreshed.skeleton)).toContain(2); // вторник освободился
    expect(weekdays(refreshed.skeleton)).not.toContain(1);
  });
});

describe('часовой пояс Google', () => {
  it('пояс основного календаря запоминается и обновляется — по нему видно расхождение с сервисом', async () => {
    const { google, t } = setup();
    const primary = google.calendars.get('me@gmail.com')!;
    primary.timeZone = 'Europe/Kaliningrad';
    await connect(t);
    expect((await t.call('GET', '/api/google/status')).body.calendarTimezone).toBe(
      'Europe/Kaliningrad',
    );

    // Пользователь поправил пояс в Google — сервис узнаёт об этом при следующем чтении занятости.
    primary.timeZone = 'Europe/Moscow';
    await draft(t);
    expect((await t.call('GET', '/api/google/status')).body.calendarTimezone).toBe('Europe/Moscow');

    await t.call('POST', '/api/google/disconnect');
    expect((await t.call('GET', '/api/google/status')).body.calendarTimezone).toBeNull();
  });
});

describe('календарь «Мой университет»', () => {
  it('после подтверждения семестра: свой календарь, события без напоминаний, повтор ничего не дублирует', async () => {
    const { google, t } = setup();
    await connect(t);
    await activeSemester(t);

    const first = (await t.call('POST', '/api/google/sync')).body;
    expect(first.report).toMatchObject({ created: 72, updated: 0, deleted: 0 });
    expect(google.ownCalendar()).toMatchObject({
      summary: 'Мой университет',
      timeZone: 'Europe/Moscow',
    });
    const events = google.ownEvents();
    expect(events).toHaveLength(72);
    expect(
      events.every((e) => e.reminders?.useDefault === false && e.reminders.overrides?.length === 0),
    ).toBe(true);
    expect(new Set(events.map((e) => e.summary))).toEqual(new Set(['Трендфоркастинг', 'SQL']));
    expect((await t.call('POST', '/api/google/sync')).body.report).toMatchObject({
      created: 0,
      updated: 0,
      deleted: 0,
    });
    // Свои занятия не считаются занятостью.
    expect((await t.call('GET', '/api/decisions')).body).toEqual([]);

    const friday = await sessionAt(t, '2026-10-30T10:00');
    await t.call('POST', `/api/sessions/${friday.id}/move`, { start: msk('2026-10-30T11:00') });
    expect((await t.call('POST', '/api/google/sync')).body.report.updated).toBe(1);
    expect(Date.parse(google.eventOf(friday.id)!.start!.dateTime!)).toBe(msk('2026-10-30T11:00'));

    const saturday = await sessionAt(t, '2026-10-31T10:00');
    await t.call('POST', `/api/sessions/${saturday.id}/skip`);
    expect((await t.call('POST', '/api/google/sync')).body.report.deleted).toBe(1);
    expect(google.eventOf(saturday.id)).toBeUndefined();
  });

  it('календарь удалили в Google — создаётся заново со всеми занятиями', async () => {
    const { google, t } = setup();
    await connect(t);
    await activeSemester(t);
    await t.call('POST', '/api/google/sync');
    google.removeCalendar(google.ownCalendar()!.id);

    expect((await t.call('POST', '/api/google/sync')).body.report.created).toBe(72);
    expect(google.ownEvents()).toHaveLength(72);
  });
});

describe('правки прямо в Google', () => {
  it('перенос принимается; если нарушает правила — вопрос «оставить или вернуть»', async () => {
    const { google, t } = setup();
    await connect(t);
    await activeSemester(t);
    await t.call('POST', '/api/google/sync');

    const monday = await sessionAt(t, '2026-11-02T10:00');
    moveEvent(google, monday.id, '2026-11-02', '11:00', '12:30');
    expect((await t.call('POST', '/api/google/sync')).body.report.movedInGoogle).toBe(1);
    expect(await sessionAt(t, '2026-11-02T11:00')).toMatchObject({
      id: monday.id,
      origin: 'manual',
      moveReason: 'перенесено в Google Календаре',
    });
    expect((await t.call('GET', '/api/decisions')).body).toEqual([]);

    const tuesday = await sessionAt(t, '2026-11-03T10:00');
    moveEvent(google, tuesday.id, '2026-11-03', '15:00', '16:30');
    await t.call('POST', '/api/google/sync');
    const [question] = (await t.call('GET', '/api/decisions')).body;
    expect(question.kind).toBe('calendar-edit');
    expect(question.title).toContain('вне окон для учёбы');
    expect(question.actions).toEqual(['keep', 'revert']);

    await t.call('POST', `/api/decisions/${question.id}/resolve`, { action: 'revert' });
    expect((await sessionAt(t, '2026-11-03T10:00')).id).toBe(tuesday.id);
    await t.call('POST', '/api/google/sync');
    expect(Date.parse(google.eventOf(tuesday.id)!.start!.dateTime!)).toBe(msk('2026-11-03T10:00'));
  });

  it('удаление в Google — вопрос; пока нет ответа, событие не возвращается', async () => {
    const { google, t } = setup();
    await connect(t);
    await activeSemester(t);
    await t.call('POST', '/api/google/sync');

    const wednesday = await sessionAt(t, '2026-11-04T10:00');
    deleteEvent(google, wednesday.id);
    expect((await t.call('POST', '/api/google/sync')).body.report.deletedInGoogle).toBe(1);
    await t.call('POST', '/api/google/sync');
    expect(google.eventOf(wednesday.id)).toBeUndefined();

    const [question] = (await t.call('GET', '/api/decisions')).body;
    expect(question.title).toContain('удалено из Google Календаря');
    await t.call('POST', `/api/decisions/${question.id}/resolve`, { action: 'skip' });
    expect((await sessionAt(t, '2026-11-04T10:00')).status).toBe('skipped');
    await t.call('POST', '/api/google/sync');
    expect(google.eventOf(wednesday.id)).toBeUndefined();

    const thursday = await sessionAt(t, '2026-11-05T10:00');
    deleteEvent(google, thursday.id);
    await t.call('POST', '/api/google/sync');
    const [again] = (await t.call('GET', '/api/decisions')).body;
    await t.call('POST', `/api/decisions/${again.id}/resolve`, { action: 'restore' });
    await t.call('POST', '/api/google/sync');
    expect(google.eventOf(thursday.id)).toBeDefined();
  });
});

describe('когда Google недоступен', () => {
  it('доступ истёк: «войти заново», а пока — последние данные календаря', async () => {
    const { google, t } = setup();
    everyWeek(google, 'me@gmail.com', 1, 'Встреча');
    await connect(t);
    expect(weekdays((await draft(t)).skeleton)).not.toContain(1);
    const fetchedAt = (await t.call('GET', '/api/google/status')).body.busyUpdatedAt;

    google.revoked = true;
    t.advance(120);
    const refreshed = (await t.call('POST', '/api/semesters/draft/refresh')).body;
    expect(weekdays(refreshed.skeleton)).not.toContain(1); // понедельники по-прежнему заняты
    expect((await t.call('GET', '/api/google/status')).body).toMatchObject({
      connected: true,
      needsReauth: true,
      lastSyncError: 'Доступ к Google истёк — войди заново',
      busyUpdatedAt: fetchedAt,
    });
    expect((await t.call('POST', '/api/google/sync')).body.report).toBeNull();

    google.revoked = false;
    await connect(t);
    expect((await t.call('GET', '/api/google/status')).body.needsReauth).toBe(false);
  });

  it('нет интернета: последние данные и честное «не обновлялся с …»', async () => {
    const { google, t } = setup();
    everyWeek(google, 'me@gmail.com', 1, 'Встреча');
    await connect(t);
    expect(weekdays((await draft(t)).skeleton)).not.toContain(1);
    const fetchedAt = (await t.call('GET', '/api/google/status')).body.busyUpdatedAt;

    google.online = false;
    t.advance(10);
    const refreshed = (await t.call('POST', '/api/semesters/draft/refresh')).body;
    expect(weekdays(refreshed.skeleton)).not.toContain(1);
    expect((await t.call('GET', '/api/google/status')).body).toMatchObject({
      lastSyncError: 'Нет связи с Google',
      busyUpdatedAt: fetchedAt,
    });
  });

  it('отключение отзывает доступ', async () => {
    const { google, t } = setup();
    await connect(t);
    const status = (await t.call('POST', '/api/google/disconnect')).body;
    expect(status).toMatchObject({ connected: false, email: null });
    expect(google.revoked).toBe(true);
  });
});

// Поддельный Google для тестов: вход, продление доступа, календари и события — без сети.
import { GOOGLE_SCOPES, type GoogleCalendarEntry, type GoogleEvent } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function timeOf(t: GoogleEvent['start']): number {
  if (t?.dateTime) return Date.parse(t.dateTime);
  if (t?.date) return Date.parse(`${t.date}T00:00:00Z`);
  return NaN;
}

export class FakeGoogle {
  accessToken = 'access-1';
  readonly refreshToken = 'refresh-1';
  revoked = false;
  online = true;
  /** Сколько запросов к календарям пришло — чтобы проверять, когда сервис ходит в Google. */
  requests = 0;
  /** Задержка ответа, как у настоящей сети: так видны гонки между запросами. */
  latencyMs = 0;
  calendars = new Map<string, GoogleCalendarEntry & { timeZone?: string }>();
  events = new Map<string, Map<string, GoogleEvent>>();
  private seq = 0;

  constructor() {
    this.addCalendar({
      id: 'me@gmail.com',
      summary: 'me@gmail.com',
      primary: true,
      accessRole: 'owner',
    });
  }

  addCalendar(c: GoogleCalendarEntry & { timeZone?: string }): void {
    this.calendars.set(c.id, c);
    this.events.set(c.id, this.events.get(c.id) ?? new Map());
  }

  removeCalendar(id: string): void {
    this.calendars.delete(id);
    this.events.delete(id);
  }

  addEvent(calendarId: string, event: Omit<GoogleEvent, 'id'>): GoogleEvent {
    const created = { ...event, id: `ev-${++this.seq}` };
    this.events.get(calendarId)!.set(created.id, created);
    return created;
  }

  /** Календарь, который создал сервис. */
  ownCalendar(): (GoogleCalendarEntry & { timeZone?: string }) | undefined {
    return [...this.calendars.values()].find((c) => c.summary === 'Мой университет');
  }

  ownEvents(): GoogleEvent[] {
    const own = this.ownCalendar();
    return own ? [...this.events.get(own.id)!.values()] : [];
  }

  /** Событие занятия в «Мой университет». */
  eventOf(sessionId: string): GoogleEvent | undefined {
    return this.ownEvents().find((e) => e.extendedProperties?.private?.ouSession === sessionId);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    if (!this.online) throw new TypeError('fetch failed');
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : '';

    if (url.host === 'oauth2.googleapis.com') {
      const form = new URLSearchParams(body);
      if (url.pathname === '/revoke') {
        this.revoked = true;
        return json(200, {});
      }
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'good-code') return json(400, { error: 'invalid_grant' });
        return json(200, {
          access_token: this.accessToken,
          expires_in: 3600,
          refresh_token: this.refreshToken,
          scope: GOOGLE_SCOPES.join(' '),
        });
      }
      if (this.revoked || form.get('refresh_token') !== this.refreshToken) {
        return json(400, { error: 'invalid_grant' });
      }
      this.accessToken = `access-${++this.seq}`;
      return json(200, { access_token: this.accessToken, expires_in: 3600 });
    }

    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${this.accessToken}`) return json(401, { error: { code: 401 } });
    this.requests++;
    const parts = url.pathname.replace('/calendar/v3/', '').split('/').map(decodeURIComponent);

    if (parts[0] === 'users' && parts[2] === 'calendarList') {
      return json(200, { items: [...this.calendars.values()] });
    }
    if (parts[0] === 'calendars' && parts.length === 1 && method === 'POST') {
      const data = JSON.parse(body) as { summary: string; timeZone: string };
      const id = `cal-${++this.seq}@group.calendar.google.com`;
      this.addCalendar({ id, summary: data.summary, accessRole: 'owner', timeZone: data.timeZone });
      return json(200, { id, summary: data.summary });
    }

    const [, calendarId, , eventId] = parts;
    const events = this.events.get(calendarId!);
    if (!events) return json(404, { error: { code: 404 } });

    if (method === 'GET') {
      const min = Date.parse(url.searchParams.get('timeMin')!);
      const max = Date.parse(url.searchParams.get('timeMax')!);
      const [key, value] = (url.searchParams.get('privateExtendedProperty') ?? '').split('=');
      const items = [...events.values()].filter(
        (e) =>
          timeOf(e.start) < max &&
          timeOf(e.end) > min &&
          (!key || e.extendedProperties?.private?.[key] === value),
      );
      return json(200, { items });
    }
    if (method === 'POST') return json(200, this.addEvent(calendarId!, JSON.parse(body)));
    const existing = events.get(eventId!);
    if (!existing) return json(404, { error: { code: 404 } });
    if (method === 'PATCH') {
      const updated = { ...existing, ...(JSON.parse(body) as Partial<GoogleEvent>) };
      events.set(eventId!, updated);
      return json(200, updated);
    }
    events.delete(eventId!);
    return new Response(null, { status: 204 });
  };
}

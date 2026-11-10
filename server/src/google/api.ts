import type { GoogleTokens, Store } from '../db/store';

/** Минимальные права: читать события и список календарей, писать только в свой календарь. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API_URL = 'https://www.googleapis.com/calendar/v3';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type GoogleErrorKind = 'not-connected' | 'auth' | 'network' | 'api';

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly kind: GoogleErrorKind,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface GoogleCalendarEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
  /** Часовой пояс календаря; у основного — пояс, в котором Google показывает события. */
  timeZone?: string;
}

interface GoogleTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  transparency?: string;
  eventType?: string;
  recurringEventId?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
  reminders?: { useDefault: boolean; overrides?: unknown[] };
}

interface Page<T> {
  items?: T[];
  nextPageToken?: string;
}

/** Запросы к Google: вход и Calendar API. Сеть — через переданный fetch, чтобы в тестах подменить. */
export class GoogleApi {
  constructor(
    private readonly options: {
      store: Store;
      config: GoogleConfig;
      fetch: typeof fetch;
      now: () => number;
    },
  ) {}

  authUrl(state: string): string {
    const { config } = this.options;
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${AUTH_URL}?${params}`;
  }

  private async postForm(url: string, form: Record<string, string>): Promise<Response> {
    try {
      return await this.options.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      });
    } catch {
      throw new GoogleError('Нет связи с Google', 'network');
    }
  }

  /** Обмен кода из адреса возврата на доступ. */
  async exchangeCode(code: string): Promise<GoogleTokens> {
    const { config, now } = this.options;
    const res = await this.postForm(TOKEN_URL, {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    });
    if (!res.ok)
      throw new GoogleError('Google не подтвердил вход — попробуй ещё раз', 'auth', res.status);
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      scope: string;
    };
    if (!data.refresh_token) {
      throw new GoogleError('Google не выдал постоянный доступ — попробуй войти ещё раз', 'auth');
    }
    return {
      accessToken: data.access_token,
      expiresAt: now() + data.expires_in * 1000,
      refreshToken: data.refresh_token,
      scope: data.scope,
    };
  }

  /** Действующий доступ; если истёк — продлевается. Если продлить нельзя — нужен повторный вход. */
  private async accessToken(force = false): Promise<string> {
    const { store, config, now } = this.options;
    const account = store.getGoogleAccount();
    if (!account.tokens) throw new GoogleError('Google Календарь не подключён', 'not-connected');
    if (account.needsReauth) throw new GoogleError('Доступ к Google истёк — войди заново', 'auth');
    if (!force && account.tokens.expiresAt - 60_000 > now()) return account.tokens.accessToken;

    const res = await this.postForm(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: account.tokens.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'invalid_grant') {
        store.updateGoogleAccount({ needsReauth: true });
        throw new GoogleError('Доступ к Google истёк — войди заново', 'auth', res.status);
      }
      throw new GoogleError(`Google не продлил доступ (${res.status})`, 'api', res.status);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    const tokens = {
      ...account.tokens,
      accessToken: data.access_token,
      expiresAt: now() + data.expires_in * 1000,
    };
    store.updateGoogleAccount({ tokens, needsReauth: false });
    return tokens.accessToken;
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { query?: Record<string, string>; body?: unknown; allow?: number[] } = {},
  ): Promise<T> {
    const query = options.query ? `?${new URLSearchParams(options.query)}` : '';
    let token = await this.accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.options.fetch(`${API_URL}${path}${query}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
      } catch {
        throw new GoogleError('Нет связи с Google', 'network');
      }
      if (res.status === 401 && attempt === 0) {
        token = await this.accessToken(true);
        continue;
      }
      if (options.allow?.includes(res.status)) return undefined as T;
      if (!res.ok) throw new GoogleError(`Google ответил ошибкой ${res.status}`, 'api', res.status);
      return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    }
    throw new GoogleError('Google не принял доступ — войди заново', 'auth', 401);
  }

  private async paged<T>(path: string, query: Record<string, string>): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
      const page: Page<T> = await this.call('GET', path, {
        query: { ...query, ...(pageToken ? { pageToken } : {}) },
      });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  listCalendars(): Promise<GoogleCalendarEntry[]> {
    return this.paged('/users/me/calendarList', { maxResults: '250' });
  }

  listEvents(
    calendarId: string,
    range: { start: number; end: number } | null,
    privateProperty?: string,
  ): Promise<GoogleEvent[]> {
    return this.paged(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      ...(range
        ? {
            timeMin: new Date(range.start).toISOString(),
            timeMax: new Date(range.end).toISOString(),
          }
        : {}),
      singleEvents: 'true',
      maxResults: '2500',
      ...(privateProperty ? { privateExtendedProperty: privateProperty } : {}),
    });
  }

  createCalendar(summary: string, timeZone: string): Promise<{ id: string }> {
    return this.call('POST', '/calendars', { body: { summary, timeZone } });
  }

  insertEvent(calendarId: string, event: Omit<GoogleEvent, 'id'>): Promise<GoogleEvent> {
    return this.call('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, {
      body: event,
    });
  }

  patchEvent(
    calendarId: string,
    eventId: string,
    patch: Partial<GoogleEvent>,
  ): Promise<GoogleEvent> {
    return this.call(
      'PATCH',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { body: patch },
    );
  }

  /** Удалённое раньше событие — не ошибка. */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.call(
      'DELETE',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { allow: [404, 410] },
    );
  }

  /** Отозвать доступ — по возможности; без сети просто забываем его. */
  async revoke(refreshToken: string): Promise<void> {
    await this.postForm(REVOKE_URL, { token: refreshToken }).catch(() => undefined);
  }
}

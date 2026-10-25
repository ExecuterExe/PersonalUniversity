import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config';
import type { Deps } from '../domain/context';
import { conflict } from '../errors';
import { GoogleError } from './api';
import { syncGoogle } from './sync';

const STATE_TTL_MS = 10 * 60_000;

export interface GoogleStatus {
  /** Ключи Google заданы в .env. */
  configured: boolean;
  connected: boolean;
  email: string | null;
  /** Доступ истёк — показать кнопку «Войти заново». */
  needsReauth: boolean;
  calendarCreated: boolean;
  busyCalendarIds: string[] | null;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  /** Когда последний раз удалось получить занятость — «календарь не обновлялся с …». */
  busyUpdatedAt: number | null;
  /** Часовой пояс основного календаря Google — в нём Google показывает занятия. */
  calendarTimezone: string | null;
}

export function googleStatus(deps: Deps): GoogleStatus {
  const account = deps.store.getGoogleAccount();
  return {
    configured: deps.google !== undefined,
    connected: account.tokens !== null,
    email: account.email,
    needsReauth: account.needsReauth,
    calendarCreated: account.calendarId !== null,
    busyCalendarIds: account.busyCalendarIds,
    lastSyncAt: account.lastSyncAt,
    lastSyncError: account.lastSyncError,
    busyUpdatedAt: deps.store.getBusyCache()?.fetchedAt ?? null,
    calendarTimezone: account.calendarTimezone,
  };
}

function requireGoogle(deps: Deps) {
  if (!deps.google) throw conflict('Ключи Google не заданы — см. docs/google-setup.md');
  if (!deps.store.getGoogleAccount().tokens) throw conflict('Google Календарь не подключён');
  return deps.google;
}

export function registerGoogleRoutes(app: FastifyInstance, deps: Deps, config: Config): void {
  // Защита входа от подделки: Google возвращает тот же state, что мы ему передали.
  const states = new Map<string, number>();

  app.get('/auth/google', (_req, reply) => {
    if (!deps.google) {
      return reply
        .status(400)
        .type('text/plain; charset=utf-8')
        .send('Ключи Google не заданы — см. docs/google-setup.md');
    }
    const state = randomUUID();
    states.set(state, deps.now() + STATE_TTL_MS);
    return reply.redirect(deps.google.api.authUrl(state));
  });

  app.get('/auth/google/callback', async (req, reply) => {
    const query = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(req.query);
    const back = (result: string, detail = '') => {
      // В журнал — только исход входа, без кодов и ключей.
      console.log(`Вход в Google: ${result}${detail ? ` (${detail})` : ''}`);
      return reply.redirect(`${config.appUrl}/?google=${result}`);
    };
    if (query.error) return back('denied', query.error);
    const expires = query.state ? states.get(query.state) : undefined;
    if (!query.state || expires === undefined || expires < deps.now()) {
      return back('expired', 'ссылка входа устарела или сервер перезапускался');
    }
    states.delete(query.state);
    if (!query.code || !deps.google) return back('error');

    try {
      const tokens = await deps.google.api.exchangeCode(query.code);
      deps.store.updateGoogleAccount({ tokens, needsReauth: false, lastSyncError: null });
      const primary = (await deps.google.api.listCalendars()).find((c) => c.primary);
      deps.store.updateGoogleAccount({
        email: primary?.id ?? null,
        calendarTimezone: primary?.timeZone ?? null,
      });
      deps.store.clearBusyCache();
      deps.afterChange?.();
      return back('connected');
    } catch (error) {
      if (error instanceof GoogleError)
        return back('error', `${error.message}, ${error.status ?? 'без кода'}`);
      throw error;
    }
  });

  app.get('/api/google/status', () => googleStatus(deps));

  app.get('/api/google/calendars', async () => {
    const google = requireGoogle(deps);
    const account = deps.store.getGoogleAccount();
    return (await google.api.listCalendars())
      .filter((c) => c.id !== account.calendarId)
      .map((c) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary === true,
        // Календари «только занятость» не показывают события — их не прочитать.
        usable: c.accessRole !== 'freeBusyReader',
        selected: account.busyCalendarIds === null || account.busyCalendarIds.includes(c.id),
      }));
  });

  app.put('/api/google/calendars', (req) => {
    requireGoogle(deps);
    const { busyCalendarIds } = z
      .object({ busyCalendarIds: z.array(z.string()).nullable() })
      .parse(req.body);
    deps.store.updateGoogleAccount({ busyCalendarIds });
    deps.store.clearBusyCache();
    return googleStatus(deps);
  });

  /** Что сервис видит как занятость в ближайшие дни — чтобы можно было проверить. */
  app.get('/api/google/busy', async (req) => {
    const google = requireGoogle(deps);
    const { days } = z
      .object({ days: z.coerce.number().int().min(1).max(60).default(14) })
      .parse(req.query);
    const start = deps.now();
    const events = await google.source.refresh({ start, end: start + days * 86_400_000 });
    return { from: start, days, events };
  });

  app.post('/api/google/sync', async () => {
    requireGoogle(deps);
    return { report: await syncGoogle(deps), status: googleStatus(deps) };
  });

  app.post('/api/google/disconnect', async () => {
    const account = deps.store.getGoogleAccount();
    if (account.tokens && deps.google) await deps.google.api.revoke(account.tokens.refreshToken);
    deps.store.updateGoogleAccount({
      tokens: null,
      email: null,
      needsReauth: false,
      calendarTimezone: null,
    });
    deps.store.clearBusyCache();
    return googleStatus(deps);
  });
}

import type { BusyEvent, Instant } from '@ou/engine';
import { DateTime } from 'luxon';
import type { CalendarSource } from '../calendar';
import type { Store } from '../db/store';
import { GoogleError, type GoogleApi, type GoogleEvent } from './api';

/** Сколько считать занятость из Google свежей, прежде чем спросить снова. */
const CACHE_TTL_MS = 5 * 60_000;

function eventTime(time: GoogleEvent['start'], timezone: string): Instant | null {
  if (time?.dateTime) return Date.parse(time.dateTime);
  // Событие на весь день: границы — местная полночь.
  if (time?.date) return DateTime.fromISO(time.date, { zone: timezone }).toMillis();
  return null;
}

/**
 * Занято ли время: учитываются только события, которые сам Google считает занятостью —
 * без «свободен», отклонённых встреч, отменённых и служебных (рабочее место, дни рождения).
 */
export function toBusy(e: GoogleEvent, timezone: string): BusyEvent | null {
  if (e.status === 'cancelled' || e.transparency === 'transparent') return null;
  if (e.eventType === 'workingLocation' || e.eventType === 'birthday') return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  const start = eventTime(e.start, timezone);
  const end = eventTime(e.end, timezone);
  if (start === null || end === null || end <= start) return null;
  return {
    start,
    end,
    title: e.summary || 'Занято',
    ...(e.recurringEventId ? { recurringId: e.recurringEventId } : {}),
  };
}

const within = (events: BusyEvent[], range: { start: Instant; end: Instant }) =>
  events.filter((e) => e.end > range.start && e.start < range.end);

/**
 * Занятость из Google Календаря. Последний удачный ответ хранится в базе:
 * без интернета или с истёкшим доступом сервис работает с ним.
 */
export class GoogleCalendarSource implements CalendarSource {
  constructor(
    private readonly api: GoogleApi,
    private readonly store: Store,
    private readonly now: () => Instant,
    private readonly timezone: () => string,
  ) {}

  async busy(range: { start: Instant; end: Instant }): Promise<BusyEvent[]> {
    if (!this.store.getGoogleAccount().tokens) return [];
    const cache = this.store.getBusyCache();
    const covers = cache !== null && cache.rangeStart <= range.start && cache.rangeEnd >= range.end;
    if (covers && this.now() - cache.fetchedAt < CACHE_TTL_MS) return within(cache.events, range);
    return this.refresh(range);
  }

  /** Спросить Google сейчас; при неудаче — последний известный ответ. */
  async refresh(range: { start: Instant; end: Instant }): Promise<BusyEvent[]> {
    try {
      const events = await this.fetch(range);
      this.store.saveBusyCache({
        rangeStart: range.start,
        rangeEnd: range.end,
        fetchedAt: this.now(),
        events,
      });
      this.store.updateGoogleAccount({ lastSyncError: null });
      return events;
    } catch (error) {
      if (!(error instanceof GoogleError)) throw error;
      if (error.kind === 'not-connected') return [];
      this.store.updateGoogleAccount({ lastSyncError: error.message });
      const cache = this.store.getBusyCache();
      return cache ? within(cache.events, range) : [];
    }
  }

  private async fetch(range: { start: Instant; end: Instant }): Promise<BusyEvent[]> {
    const account = this.store.getGoogleAccount();
    const timezone = this.timezone();
    const calendars = (await this.api.listCalendars()).filter(
      (c) =>
        c.id !== account.calendarId &&
        c.accessRole !== 'freeBusyReader' &&
        (account.busyCalendarIds === null || account.busyCalendarIds.includes(c.id)),
    );
    const events: BusyEvent[] = [];
    for (const c of calendars) {
      for (const e of await this.api.listEvents(c.id, range)) {
        const busy = toBusy(e, timezone);
        if (busy) events.push(busy);
      }
    }
    return events;
  }
}

import { randomUUID } from 'node:crypto';
import { noCalendar, type CalendarSource } from './calendar';
import { checkGoogleConfig, type Config } from './config';
import { openDatabase } from './db/database';
import { Store } from './db/store';
import { appSettings, type Deps } from './domain/context';
import { GoogleApi } from './google/api';
import { GoogleCalendarSource } from './google/source';

export function createDeps(options: {
  dbPath: string;
  /** С ключами Google занятость берётся из Google Календаря. */
  config?: Config;
  fetch?: typeof fetch;
  calendar?: CalendarSource;
  now?: () => number;
  newId?: () => string;
}): Deps {
  const store = new Store(openDatabase(options.dbPath));
  const now = options.now ?? Date.now;
  const deps: Deps = {
    store,
    calendar: options.calendar ?? noCalendar,
    now,
    newId: options.newId ?? randomUUID,
  };
  if (options.config && checkGoogleConfig(options.config).length === 0) {
    const api = new GoogleApi({
      store,
      config: options.config.google,
      fetch: options.fetch ?? fetch,
      now,
    });
    const source = new GoogleCalendarSource(api, store, now, () => appSettings(store).timezone);
    deps.google = { api, source };
    if (!options.calendar) deps.calendar = source;
  }
  return deps;
}

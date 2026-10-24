import { randomUUID } from 'node:crypto';
import { noCalendar, type CalendarSource } from './calendar';
import { openDatabase } from './db/database';
import { Store } from './db/store';
import type { Deps } from './domain/context';

export function createDeps(options: {
  dbPath: string;
  calendar?: CalendarSource;
  now?: () => number;
  newId?: () => string;
}): Deps {
  return {
    store: new Store(openDatabase(options.dbPath)),
    calendar: options.calendar ?? noCalendar,
    now: options.now ?? Date.now,
    newId: options.newId ?? randomUUID,
  };
}

import {
  inconvenientBusy,
  makeCalendar,
  makeRuleContext,
  type BusyEvent,
  type Discipline,
  type Instant,
  type PlanState,
  type RuleContext,
  type SemesterSpec,
  type Settings,
} from '@ou/engine';
import type { CalendarSource } from '../calendar';
import type { GoogleApi } from '../google/api';
import type { GoogleCalendarSource } from '../google/source';
import type { SemesterRecord, Store } from '../db/store';
import { conflict, notFound } from '../errors';
import { defaultAppSettings, toEngineSettings, type AppSettings } from '../settings';

/** Всё, от чего зависит логика сервера: база, календарь, часы, генератор id. */
export interface Deps {
  store: Store;
  calendar: CalendarSource;
  now: () => Instant;
  newId: () => string;
  /** Есть, если ключи Google заданы. */
  google?: { api: GoogleApi; source: GoogleCalendarSource };
  /** Вызывается после любого изменения через API — например, чтобы отправить план в Google. */
  afterChange?: () => void;
}

export function appSettings(store: Store): AppSettings {
  return store.getSettings() ?? defaultAppSettings();
}

export function specOf(sem: SemesterRecord): SemesterSpec {
  return { startDate: sem.startDate, weeks: sem.weeks };
}

export function engineSettingsFor(store: Store, sem: SemesterRecord): Settings {
  return toEngineSettings(appSettings(store), sem.settingsPatch);
}

/** Дисциплины семестра для движка: карточка плюс то, о чём договорились в компромиссах. */
export function engineDisciplines(store: Store, sem: SemesterRecord): Discipline[] {
  return sem.disciplineIds.map((id) => {
    const d = store.getDiscipline(id);
    if (!d) throw notFound(`Дисциплина ${id}`);
    const patch = sem.disciplinePatches[id] ?? {};
    return {
      id: d.id,
      name: d.name,
      priority: d.priority,
      durationMinutes: patch.durationMinutes ?? d.durationMinutes,
      ...(patch.extraWindows ? { extraWindows: patch.extraWindows } : {}),
    };
  });
}

export function loadState(store: Store, sem: SemesterRecord): PlanState {
  return {
    semester: specOf(sem),
    settings: engineSettingsFor(store, sem),
    disciplines: engineDisciplines(store, sem),
    frequencies: sem.frequencies,
    skeleton: store.loadSkeleton(sem.id),
    sessions: store.loadSessions(sem.id),
  };
}

export interface BusyOptions {
  /** Только уже известная занятость, без запроса к Google (фоновые проверки). */
  cachedBusy?: boolean;
}

/** Занятость на весь семестр: календарь плюс неудобное время из настроек. */
export async function busyFor(
  deps: Deps,
  sem: SemesterRecord,
  options: BusyOptions = {},
): Promise<BusyEvent[]> {
  const settings = engineSettingsFor(deps.store, sem);
  const cal = makeCalendar(specOf(sem), settings.timezone);
  const range = { start: cal.days[0]!.start, end: cal.days[cal.days.length - 1]!.end };
  const external = options.cachedBusy
    ? await deps.calendar.cached(range)
    : await deps.calendar.busy(range);
  return [...external, ...inconvenientBusy(cal, appSettings(deps.store).inconvenient)];
}

export interface PlanContext {
  sem: SemesterRecord;
  state: PlanState;
  busy: BusyEvent[];
  ctx: RuleContext;
}

export async function planContext(
  deps: Deps,
  sem: SemesterRecord,
  options: BusyOptions = {},
): Promise<PlanContext> {
  const state = loadState(deps.store, sem);
  const busy = await busyFor(deps, sem, options);
  return {
    sem,
    state,
    busy,
    ctx: makeRuleContext(state.semester, state.settings, state.disciplines, busy),
  };
}

export function requireActive(store: Store): SemesterRecord {
  const sem = store.findSemester('active');
  if (!sem) throw conflict('Семестр ещё не начат — сначала составь и подтверди расписание');
  return sem;
}

/** Сохраняет план, который вернул движок, вместе с изменившимися частотами и длиной семестра. */
export function saveState(store: Store, sem: SemesterRecord, state: PlanState): SemesterRecord {
  const next: SemesterRecord = {
    ...sem,
    frequencies: state.frequencies,
    weeks: state.semester.weeks,
  };
  store.transaction(() => {
    store.saveSemester(next);
    store.replacePlan(sem.id, state.skeleton, state.sessions);
  });
  return next;
}

/** Местная дата YYYY-MM-DD. */
export function localDate(instant: Instant, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** День недели по ISO для даты YYYY-MM-DD: 1 — понедельник. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

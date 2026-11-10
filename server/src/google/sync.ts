import { checkPlacement, makeCalendar, MINUTE, type Instant, type Session } from '@ou/engine';
import type { SemesterRecord } from '../db/store';
import { appSettings, planContext, specOf, type Deps, type PlanContext } from '../domain/context';
import { GoogleError, type GoogleEvent } from './api';
import { conflict } from '../errors';

export const CALENDAR_NAME = 'Мой университет';

export interface SyncReport {
  created: number;
  updated: number;
  deleted: number;
  /** Занятия, которые пользователь сам передвинул в Google. */
  movedInGoogle: number;
  /** Лишние копии событий (от прошлых сбоев), которые убраны. */
  copiesRemoved: number;
  /** Занятия, которые пользователь сам удалил в Google. */
  deletedInGoogle: number;
}

function semesterRange(sem: SemesterRecord, timezone: string) {
  const cal = makeCalendar(specOf(sem), timezone);
  return { start: cal.days[0]!.start, end: cal.days[cal.days.length - 1]!.end };
}

/**
 * Где искать свои события: весь семестр и всё, что связано с его занятиями. Занятие вне расписания
 * может быть и до первой недели семестра — если его не найти, оно создавалось бы заново при
 * каждой синхронизации.
 */
function listingRange(deps: Deps, sem: SemesterRecord, timezone: string) {
  const range = semesterRange(sem, timezone);
  const spans = [...deps.store.loadSessions(sem.id), ...deps.store.listLinks(sem.id)];
  for (const s of spans) {
    range.start = Math.min(range.start, s.start);
    range.end = Math.max(range.end, s.end);
  }
  return range;
}

/** Что сервис отправляет в Google. Если это не изменилось, синхронизировать после правки незачем. */
export function calendarFingerprint(deps: Deps): string {
  const { store } = deps;
  const sem = store.findSemester('active');
  if (!sem) return 'без семестра';
  const names = sem.disciplineIds.map((id) => `${id}=${store.getDiscipline(id)?.name ?? ''}`);
  const awaiting = store
    .listDecisions('open')
    .filter((d) => d.kind === 'calendar-edit')
    .map((d) => d.id);
  const sessions = store
    .loadSessions(sem.id)
    .map((s) => `${s.id}@${s.start}-${s.end}:${s.status}`)
    .sort();
  return [sem.id, appSettings(store).timezone, ...names, ...awaiting, ...sessions].join('|');
}

interface SyncState {
  /** Синхронизации идут строго по очереди: две одновременные создавали копии событий. */
  queue: Promise<unknown>;
  /** Отпечаток расписания после последней удачной синхронизации. */
  pushed: string | null;
}

const states = new WeakMap<Deps, SyncState>();

function stateOf(deps: Deps): SyncState {
  let state = states.get(deps);
  if (!state) {
    state = { queue: Promise.resolve(), pushed: null };
    states.set(deps, state);
  }
  return state;
}

const iso = (t: Instant) => new Date(t).toISOString();

function eventBody(
  sem: SemesterRecord,
  s: Session,
  summary: string,
  goal: string,
  timezone: string,
) {
  return {
    summary,
    description: goal
      ? `Цель: ${goal}\n\nЗанятие из «${CALENDAR_NAME}».`
      : `Занятие из «${CALENDAR_NAME}».`,
    start: { dateTime: iso(s.start), timeZone: timezone },
    end: { dateTime: iso(s.end), timeZone: timezone },
    // Напоминаний нет — так договорились.
    reminders: { useDefault: false, overrides: [] },
    transparency: 'opaque',
    extendedProperties: { private: { ouSemester: sem.id, ouSession: s.id } },
  };
}

async function ensureCalendar(deps: Deps, timezone: string): Promise<string> {
  const account = deps.store.getGoogleAccount();
  if (account.calendarId) return account.calendarId;
  const { id } = await deps.google!.api.createCalendar(CALENDAR_NAME, timezone);
  deps.store.updateGoogleAccount({ calendarId: id });
  return id;
}

const isEditable = (s: Session, now: Instant) => s.status === 'planned' && s.start > now;

/**
 * Правки пользователя прямо в Google (раздел 7): перенос принимается как ручной;
 * если так нарушаются правила или занятие удалили — появляется вопрос.
 */
async function pullEdits(
  deps: Deps,
  sem: SemesterRecord,
  calendarId: string,
  events: GoogleEvent[],
  report: SyncReport,
): Promise<void> {
  const { store } = deps;
  const now = deps.now();
  const bySession = new Map(
    events
      .filter((e) => e.status !== 'cancelled')
      .map((e) => [e.extendedProperties?.private?.ouSession, e] as const),
  );
  const sessions = new Map(store.loadSessions(sem.id).map((s) => [s.id, s]));
  let plan: PlanContext | null = null;

  for (const link of store.listLinks(sem.id)) {
    const s = sessions.get(link.sessionId);
    if (!s) continue;
    const event = bySession.get(link.sessionId);

    if (!event) {
      store.deleteLink(sem.id, link.sessionId);
      if (isEditable(s, now)) {
        report.deletedInGoogle++;
        store.ensureDecision(
          deps.newId(),
          `calendar-edit:${sem.id}:${s.id}:deleted:${s.start}`,
          'calendar-edit',
          { type: 'deleted', sessionId: s.id },
          now,
        );
      }
      continue;
    }

    const start = event.start?.dateTime ? Date.parse(event.start.dateTime) : NaN;
    const end = event.end?.dateTime ? Date.parse(event.end.dateTime) : NaN;
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    if ((start === link.start && end === link.end) || !isEditable(s, now)) continue;

    plan ??= await planContext(deps, sem);
    const discipline = plan.state.disciplines.find((d) => d.id === s.disciplineId);
    const custom = s.customDuration || end - start !== (discipline?.durationMinutes ?? 0) * MINUTE;
    const others = plan.state.sessions.filter((x) => x.id !== s.id);
    const violations = checkPlacement(
      plan.ctx,
      {
        id: s.id,
        disciplineId: s.disciplineId,
        start,
        end,
        ...(custom ? { customDuration: true } : {}),
      },
      others,
    );
    const moved: Session = {
      ...s,
      start,
      end,
      origin: s.origin === 'skeleton' ? 'manual' : s.origin,
      originalStart: s.originalStart ?? s.start,
      moveReason: 'перенесено в Google Календаре',
      ...(custom ? { customDuration: true } : {}),
    };
    if (violations.length > 0) {
      moved.acceptedViolations = [
        ...new Set([...(s.acceptedViolations ?? []), ...violations.map((v) => v.code)]),
      ];
    }
    store.saveSession(sem.id, moved);
    store.saveLink({ ...link, start, end });
    plan.state.sessions = [...others, moved];
    report.movedInGoogle++;
    if (violations.length > 0) {
      store.ensureDecision(
        deps.newId(),
        `calendar-edit:${sem.id}:${s.id}:moved:${start}`,
        'calendar-edit',
        {
          type: 'moved',
          sessionId: s.id,
          previousStart: s.start,
          previousEnd: s.end,
          violations: violations.map((v) => v.message),
        },
        now,
      );
    }
  }
}

/** План → календарь «Мой университет»: создать, поправить или удалить события. */
async function pushPlan(
  deps: Deps,
  sem: SemesterRecord,
  calendarId: string,
  timezone: string,
  report: SyncReport,
): Promise<void> {
  const { store } = deps;
  const api = deps.google!.api;
  const links = new Map(store.listLinks(sem.id).map((l) => [l.sessionId, l]));
  // Пока пользователь не ответил, что делать с удалённым в Google, событие не возвращаем.
  const awaiting = new Set(
    store
      .listDecisions('open')
      .filter((d) => d.kind === 'calendar-edit' && d.payload.type === 'deleted')
      .map((d) => d.payload.sessionId as string),
  );
  const disciplines = new Map(
    sem.disciplineIds.map((id) => [id, store.getDiscipline(id)] as const),
  );

  for (const s of store.loadSessions(sem.id)) {
    const link = links.get(s.id);
    links.delete(s.id);
    const want = (s.status === 'planned' || s.status === 'held') && !awaiting.has(s.id);
    const d = disciplines.get(s.disciplineId);
    const summary = d?.name ?? 'Занятие';
    try {
      if (want && !link) {
        const event = await api.insertEvent(
          calendarId,
          eventBody(sem, s, summary, d?.goal ?? '', timezone),
        );
        store.saveLink({
          semesterId: sem.id,
          sessionId: s.id,
          eventId: event.id,
          start: s.start,
          end: s.end,
          summary,
        });
        report.created++;
      } else if (
        want &&
        link &&
        (link.start !== s.start || link.end !== s.end || link.summary !== summary)
      ) {
        const body = eventBody(sem, s, summary, d?.goal ?? '', timezone);
        await api.patchEvent(calendarId, link.eventId, {
          summary,
          start: body.start,
          end: body.end,
        });
        store.saveLink({ ...link, start: s.start, end: s.end, summary });
        report.updated++;
      } else if (!want && link) {
        await api.deleteEvent(calendarId, link.eventId);
        store.deleteLink(sem.id, s.id);
        report.deleted++;
      }
    } catch (error) {
      // Событие удалили между чтением и записью — разберёмся в следующий раз.
      if (error instanceof GoogleError && error.status === 404 && link) {
        store.deleteLink(sem.id, s.id);
        continue;
      }
      throw error;
    }
  }

  // Занятий больше нет в плане (например, дисциплину убрали) — их события тоже убираем.
  for (const link of links.values()) {
    await api.deleteEvent(calendarId, link.eventId);
    store.deleteLink(sem.id, link.sessionId);
    report.deleted++;
  }
}

/**
 * Своё событие без связи с занятием — копия от прошлого сбоя (например, двух синхронизаций
 * сразу): удаляем, иначе в календаре в одно время стоят несколько одинаковых занятий.
 */
async function removeCopies(
  deps: Deps,
  sem: SemesterRecord,
  calendarId: string,
  events: GoogleEvent[],
  report: SyncReport,
): Promise<GoogleEvent[]> {
  const linked = new Set(deps.store.listLinks(sem.id).map((l) => l.eventId));
  const kept: GoogleEvent[] = [];
  for (const event of events) {
    if (event.status === 'cancelled' || linked.has(event.id)) {
      kept.push(event);
      continue;
    }
    await deps.google!.api.deleteEvent(calendarId, event.id);
    report.copiesRemoved++;
  }
  return kept;
}

async function syncOnce(deps: Deps): Promise<SyncReport | null> {
  const { store } = deps;
  const google = deps.google;
  const account = store.getGoogleAccount();
  if (!google || !account.tokens || account.needsReauth) return null;
  const report: SyncReport = {
    created: 0,
    updated: 0,
    deleted: 0,
    movedInGoogle: 0,
    copiesRemoved: 0,
    deletedInGoogle: 0,
  };
  const sem = store.findSemester('active');
  const timezone = appSettings(store).timezone;
  // После частичного удаления не возвращаем уже удалённые события при следующей синхронизации.
  if (sem && store.getMeta(`semesterDeletion:${sem.id}`) === 'pending') return null;

  try {
    if (sem) {
      let calendarId = await ensureCalendar(deps, timezone);
      let events: GoogleEvent[];
      try {
        events = await google.api.listEvents(
          calendarId,
          listingRange(deps, sem, timezone),
          `ouSemester=${sem.id}`,
        );
      } catch (error) {
        // Календарь «Мой университет» удалили в Google — создаём заново и переносим всё туда.
        if (!(error instanceof GoogleError) || error.status !== 404) throw error;
        store.updateGoogleAccount({ calendarId: null });
        for (const link of store.listLinks(sem.id)) store.deleteLink(sem.id, link.sessionId);
        calendarId = await ensureCalendar(deps, timezone);
        events = [];
      }
      events = await removeCopies(deps, sem, calendarId, events, report);
      await pullEdits(deps, sem, calendarId, events, report);
      await pushPlan(deps, sem, calendarId, timezone, report);
    }
    store.updateGoogleAccount({ lastSyncAt: deps.now(), lastSyncError: null });
    stateOf(deps).pushed = calendarFingerprint(deps);
  } catch (error) {
    if (!(error instanceof GoogleError)) throw error;
    store.updateGoogleAccount({ lastSyncError: error.message });
    return report;
  }

  if (sem) await google.source.refresh(semesterRange(sem, timezone));
  return report;
}

/**
 * Синхронизация с Google (раздел 7 и план, этап 3): правки пользователя → план → календарь,
 * затем свежая занятость. Ошибки не роняют сервис: он работает с последними данными.
 * Запуски встают в очередь: следующий начнётся, только когда закончится предыдущий.
 */
export function syncGoogle(deps: Deps): Promise<SyncReport | null> {
  const state = stateOf(deps);
  const run = state.queue.then(() => syncOnce(deps));
  state.queue = run.catch(() => undefined);
  return run;
}

/** Удаление стоит в той же очереди, чтобы синхронизация не вернула события обратно. */
export function deleteSemester(deps: Deps, id: string): Promise<void> {
  const state = stateOf(deps);
  const run = state.queue.then(async () => {
    const { store, google } = deps;
    const sem = store.getSemester(id);
    // Ответ на прежнее удаление мог потеряться. Повтор подтверждает результат,
    // не обращаясь к Google и не затрагивая новый семестр.
    if (!sem) return;
    let removedFromGoogle = false;
    const account = store.getGoogleAccount();
    const links = store.listLinks(id);
    if (account.calendarId && (sem.status !== 'draft' || links.length > 0)) {
      if (!google || !account.tokens || account.needsReauth) {
        throw conflict(
          'Чтобы удалить события семестра из Google Календаря, сначала войди в Google заново',
        );
      }
      store.setMeta(`semesterDeletion:${id}`, 'pending');
      try {
        let events: GoogleEvent[];
        try {
          // Без границ дат: пользователь мог перенести событие за пределы семестра.
          events = await google.api.listEvents(account.calendarId, null, `ouSemester=${id}`);
        } catch (error) {
          if (!(error instanceof GoogleError) || ![404, 410].includes(error.status ?? 0))
            throw error;
          events = [];
        }
        const eventIds = new Set([...events.map((e) => e.id), ...links.map((l) => l.eventId)]);
        for (const eventId of eventIds) await google.api.deleteEvent(account.calendarId, eventId);
        removedFromGoogle = true;
      } catch (error) {
        if (!(error instanceof GoogleError)) throw error;
        store.updateGoogleAccount({ lastSyncError: error.message });
        throw conflict(
          `Удаление семестра не завершено: ${error.message}. Повтори удаление после восстановления доступа к Google`,
        );
      }
    } else if (links.length > 0) {
      throw conflict(
        'Не найден связанный Google Календарь — восстанови подключение перед удалением семестра',
      );
    }
    store.transaction(() => {
      store.deleteSemester(id);
      if (removedFromGoogle)
        store.updateGoogleAccount({ lastSyncAt: deps.now(), lastSyncError: null });
    });
    resetCalendarSync(deps);
  });
  state.queue = run.catch(() => undefined);
  return run;
}

/**
 * После правки в сервисе: синхронизировать, только если поменялось то, что видно в Google, —
 * занятия, их время, названия дисциплин, пояс. Пауза таймера или итог занятия Google не трогают.
 */
export function syncIfPlanChanged(deps: Deps): Promise<SyncReport | null> {
  if (calendarFingerprint(deps) === stateOf(deps).pushed) return Promise.resolve(null);
  return syncGoogle(deps);
}

/** Забыть, что уже отправлено: после входа в Google всё нужно сверить заново. */
export function resetCalendarSync(deps: Deps): void {
  stateOf(deps).pushed = null;
}

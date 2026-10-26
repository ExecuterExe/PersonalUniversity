import {
  autoPauseTimer,
  checkManualMove,
  countPausedTime,
  DEFAULT_POMODORO,
  durationMinutes,
  finishTimer,
  MINUTE,
  pauseTimer,
  plannedEndAt,
  resumeTimer,
  startTimer,
  timerView,
  type Instant,
  type Session,
  type TimerView,
  type Violation,
} from '@ou/engine';
import { z } from 'zod';
import type { SemesterRecord, SourceRecord, SummaryRecord } from '../db/store';
import { conflict, notFound } from '../errors';
import { appSettings, planContext, requireActive, type Deps } from './context';

/** Начать занятие можно за полчаса до него и до конца его времени. */
const EARLY_START_MINUTES = 30;

export interface SessionView extends Session {
  disciplineName: string;
  /** Итог записан. */
  hasSummary: boolean;
  /** Идёт прямо сейчас. */
  running: boolean;
}

function toView(deps: Deps, sem: SemesterRecord, s: Session): SessionView {
  const timer = deps.store.getTimer();
  return {
    ...s,
    disciplineName: deps.store.getDiscipline(s.disciplineId)?.name ?? s.disciplineId,
    hasSummary: deps.store.getSummary(sem.id, s.id) !== null,
    running: timer?.semesterId === sem.id && timer.state.sessionId === s.id,
  };
}

function requireSession(deps: Deps, sem: SemesterRecord, id: string): Session {
  const s = deps.store.getSession(sem.id, id);
  if (!s) throw notFound('Занятие');
  return s;
}

/** Проведённое занятие без итога — пока оно есть, новое не начать (методология, раздел 8). */
export function pendingSummary(deps: Deps, sem: SemesterRecord): Session | null {
  return (
    deps.store
      .loadSessions(sem.id)
      .filter((s) => s.status === 'held' && deps.store.getSummary(sem.id, s.id) === null)
      .sort((a, b) => (b.finishedAt ?? b.end) - (a.finishedAt ?? a.end))[0] ?? null
  );
}

export const scheduleQuery = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
});

/** Занятия в промежутке (по умолчанию — текущая неделя ± день). */
export function schedule(deps: Deps, from?: Instant, to?: Instant): SessionView[] {
  const sem = requireActive(deps.store);
  const now = deps.now();
  const start = from ?? now - 7 * 24 * 60 * MINUTE;
  const end = to ?? now + 7 * 24 * 60 * MINUTE;
  return deps.store.sessionsBetween(sem.id, start, end).map((s) => toView(deps, sem, s));
}

export interface SessionDetails {
  session: SessionView;
  goal: string;
  metrics: string;
  continueHint: string;
  sources: SourceRecord[];
  summary: SummaryRecord | null;
}

export function sessionDetails(deps: Deps, id: string): SessionDetails {
  const sem = requireActive(deps.store);
  const s = requireSession(deps, sem, id);
  const d = deps.store.getDiscipline(s.disciplineId);
  return {
    session: toView(deps, sem, s),
    goal: d?.goal ?? '',
    metrics: d?.metrics ?? '',
    continueHint: d?.continueHint ?? '',
    sources: deps.store.listSources(s.disciplineId),
    summary: deps.store.getSummary(sem.id, s.id),
  };
}

function ensureCanStart(deps: Deps, sem: SemesterRecord): void {
  if (deps.store.getTimer()) throw conflict('Уже идёт другое занятие — сначала заверши его');
  const pending = pendingSummary(deps, sem);
  if (pending) {
    throw conflict('Сначала запиши итог прошлого занятия', { sessionId: pending.id });
  }
}

export function startSession(deps: Deps, id: string): TimerView {
  const { store } = deps;
  const sem = requireActive(store);
  const s = requireSession(deps, sem, id);
  const now = deps.now();
  if (s.status !== 'planned') throw conflict('Это занятие уже не в плане');
  // Сначала то, что мешает в любом случае: идущее занятие и незаписанный итог.
  ensureCanStart(deps, sem);
  if (now < s.start - EARLY_START_MINUTES * MINUTE) {
    throw conflict(`Начать можно не раньше чем за ${EARLY_START_MINUTES} минут до занятия`);
  }
  if (now >= s.end) {
    throw conflict('Время этого занятия прошло — можно позаниматься внепланово');
  }
  // Начал позже — занятие всё равно заканчивается по расписанию: дальше буфер и другие дела.
  // Начал раньше — полная длительность, закончится раньше расписания.
  const minutes = Math.min(durationMinutes(s), (s.end - now) / MINUTE);
  const state = startTimer(s.id, minutes, now);
  store.transaction(() => {
    store.setTimer({ semesterId: sem.id, state });
    store.saveSession(sem.id, { ...s, startedAt: now });
  });
  return timerView(state, now, appSettings(store).pomodoro);
}

export const unplannedInput = z.object({ disciplineId: z.string() });

/** Захотелось позаниматься вне расписания: занятие идёт в статистику, план не меняется. */
export function startUnplanned(deps: Deps, disciplineId: string): TimerView {
  const { store } = deps;
  const sem = requireActive(store);
  if (!sem.disciplineIds.includes(disciplineId)) throw notFound('Дисциплина семестра');
  ensureCanStart(deps, sem);
  const d = store.getDiscipline(disciplineId)!;
  const now = deps.now();
  const minutes = sem.disciplinePatches[disciplineId]?.durationMinutes ?? d.durationMinutes;
  const session: Session = {
    id: `unplanned.${deps.newId()}`,
    disciplineId,
    start: now,
    end: now + minutes * MINUTE,
    status: 'planned',
    origin: 'unplanned',
    startedAt: now,
  };
  const state = startTimer(session.id, minutes, now);
  store.transaction(() => {
    store.saveSession(sem.id, session);
    store.setTimer({ semesterId: sem.id, state });
  });
  return timerView(state, now, appSettings(store).pomodoro);
}

export function currentTimer(deps: Deps): TimerView | null {
  const t = deps.store.getTimer();
  return t ? timerView(t.state, deps.now(), appSettings(deps.store).pomodoro) : null;
}

function requireTimer(deps: Deps) {
  const t = deps.store.getTimer();
  if (!t) throw conflict('Сейчас ничего не идёт');
  return t;
}

export function pause(deps: Deps): TimerView {
  const t = requireTimer(deps);
  const state = pauseTimer(t.state, deps.now());
  deps.store.setTimer({ ...t, state });
  return timerView(state, deps.now(), appSettings(deps.store).pomodoro);
}

export const resumeInput = z.object({ countPaused: z.boolean().default(false) });

/** Продолжить; `countPaused` — «я занимался — засчитать»: время паузы идёт в учёбу. */
export function resume(deps: Deps, countPaused = false): TimerView {
  const t = requireTimer(deps);
  const state = countPaused ? countPausedTime(t.state) : resumeTimer(t.state, deps.now());
  deps.store.setTimer({ ...t, state });
  return timerView(state, deps.now(), appSettings(deps.store).pomodoro);
}

/**
 * Компьютер спал или был выключен с `from` до `to`: таймер встаёт на паузу с момента,
 * когда сервис перестал работать, — сон не считается учёбой, пока ты сам не скажешь иначе.
 */
export function pauseForSleep(deps: Deps, from: Instant, to: Instant): void {
  const t = deps.store.getTimer();
  if (!t || t.state.pausedAt !== undefined) return;
  deps.store.setTimer({ ...t, state: autoPauseTimer(t.state, 'sleep', from, to) });
}

/**
 * Время занятия вышло, а страница давно закрыта (`lastSeen` — последний запрос от неё):
 * таймер встаёт на конце занятия, а не тикает до утра.
 */
export function pauseIfAway(deps: Deps, lastSeen: Instant, awayMs: number): void {
  const t = deps.store.getTimer();
  if (!t || t.state.pausedAt !== undefined) return;
  const now = deps.now();
  const end = plannedEndAt(t.state);
  if (now <= end || now - lastSeen < awayMs) return;
  deps.store.setTimer({
    ...t,
    state: autoPauseTimer(t.state, 'away', Math.max(lastSeen, end)),
  });
}

export interface FinishResult {
  session: SessionView;
  focusMinutes: number;
  activeMinutes: number;
  endedEarly: boolean;
}

/** Завершить можно в любой момент — записывается, сколько было на самом деле. Дальше — итог. */
export function finish(deps: Deps): FinishResult {
  const { store } = deps;
  const t = requireTimer(deps);
  const sem = store.getSemester(t.semesterId);
  if (!sem) throw notFound('Семестр');
  const s = requireSession(deps, sem, t.state.sessionId);
  const now = deps.now();
  const result = finishTimer(t.state, now, appSettings(store).pomodoro ?? DEFAULT_POMODORO);
  const held: Session = {
    ...s,
    status: 'held',
    actualMinutes: result.focusMinutes,
    elapsedMinutes: result.activeMinutes,
    finishedAt: now,
    // Внеплановое занятие в календаре занимает столько, сколько длилось на самом деле.
    ...(s.origin === 'unplanned' ? { end: Math.max(s.start + MINUTE, now) } : {}),
  };
  store.transaction(() => {
    store.saveSession(sem.id, held);
    store.clearTimer();
  });
  return { session: toView(deps, sem, held), ...result };
}

export const summaryInput = z
  .object({
    keyConcepts: z.string().trim().max(10_000).default(''),
    retelling: z.string().trim().max(20_000).default(''),
    continueFrom: z.string().trim().max(2000).default(''),
  })
  .refine((v) => v.keyConcepts.length > 0 || v.retelling.length > 0, {
    message: 'Запиши хотя бы ключевые понятия или короткий пересказ',
  });

/** Итог занятия: без него следующее не начнётся. «С чего продолжить» покажется в следующий раз. */
export function saveSummary(
  deps: Deps,
  id: string,
  input: z.infer<typeof summaryInput>,
): SummaryRecord {
  const { store } = deps;
  const sem = requireActive(store);
  const s = requireSession(deps, sem, id);
  if (s.status !== 'held') throw conflict('Итог записывается после занятия');
  if (store.getSummary(sem.id, id)) throw conflict('Итог этого занятия уже записан');
  const summary: SummaryRecord = {
    semesterId: sem.id,
    sessionId: id,
    disciplineId: s.disciplineId,
    ...input,
    createdAt: deps.now(),
  };
  store.transaction(() => {
    store.saveSummary(summary);
    if (input.continueFrom) {
      const d = store.getDiscipline(s.disciplineId);
      if (d) store.saveDiscipline({ ...d, continueHint: input.continueFrom });
    }
  });
  return summary;
}

export const moveInput = z.object({
  start: z.number().int(),
  /** Подтверждаю, хоть правила и нарушаются. */
  confirm: z.boolean().default(false),
});

export interface MoveResult {
  session: SessionView;
  violations: Violation[];
}

/** Ручной перенос: сначала проверка правил; нарушения применяются только с подтверждения. */
export async function moveSession(
  deps: Deps,
  id: string,
  input: z.infer<typeof moveInput>,
): Promise<MoveResult> {
  const { store } = deps;
  const sem = requireActive(store);
  const s = requireSession(deps, sem, id);
  const now = deps.now();
  if (s.status !== 'planned' || s.start <= now)
    throw conflict('Переносить можно только будущие занятия');
  if (input.start <= now) throw conflict('Нельзя перенести занятие в прошлое');
  const { ctx, state } = await planContext(deps, sem);
  const violations = checkManualMove(ctx, state.sessions, id, input.start);
  if (violations.length > 0 && !input.confirm) {
    throw conflict('Так нарушаются правила расписания', { violations });
  }
  const moved: Session = {
    ...s,
    start: input.start,
    end: input.start + (s.end - s.start),
    origin: s.origin === 'skeleton' ? 'manual' : s.origin,
    originalStart: s.originalStart ?? s.start,
    moveReason: 'перенесено вручную',
    ...(violations.length > 0
      ? { acceptedViolations: [...new Set(violations.map((v) => v.code))] }
      : {}),
  };
  if (violations.length === 0) delete moved.acceptedViolations;
  store.saveSession(sem.id, moved);
  return { session: toView(deps, sem, moved), violations };
}

/** Пропустить будущее занятие заранее — не пропуск и не долг. */
export function skipSession(deps: Deps, id: string): SessionView {
  const sem = requireActive(deps.store);
  const s = requireSession(deps, sem, id);
  if (s.status !== 'planned') throw conflict('Пропустить можно только запланированное занятие');
  const timer = deps.store.getTimer();
  if (timer?.state.sessionId === id) throw conflict('Это занятие уже идёт — его можно завершить');
  const skipped: Session = { ...s, status: 'skipped' };
  deps.store.saveSession(sem.id, skipped);
  return toView(deps, sem, skipped);
}

export function sessionView(deps: Deps, sem: SemesterRecord, s: Session): SessionView {
  return toView(deps, sem, s);
}

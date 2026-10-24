import { MINUTE } from './time';
import type { Instant, PomodoroSettings } from './types';

export const DEFAULT_POMODORO: PomodoroSettings = {
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
};

/**
 * Состояние идущего занятия. Время считается только по отметкам, поэтому
 * перезагрузка страницы или закрытый браузер ничего не сбивают.
 */
export interface TimerState {
  sessionId: string;
  plannedMinutes: number;
  startedAt: Instant;
  /** Есть — значит, на паузе с этого момента. */
  pausedAt?: Instant;
  /** Сколько уже простояло на паузе до текущей паузы. */
  pausedMs: number;
}

export type PhaseKind = 'focus' | 'break' | 'long-break';

export interface TimerView {
  sessionId: string;
  paused: boolean;
  phase: PhaseKind;
  /** Номер текущего цикла фокуса, с 1. */
  cycle: number;
  phaseLengthMs: number;
  phaseElapsedMs: number;
  /** Время занятия без пауз. */
  activeMs: number;
  /** Чистое время учёбы — без перерывов и пауз. */
  focusMs: number;
  plannedMs: number;
  /** До конца запланированного времени; 0 — время вышло. */
  remainingMs: number;
  overtime: boolean;
}

export function startTimer(sessionId: string, plannedMinutes: number, now: Instant): TimerState {
  return { sessionId, plannedMinutes, startedAt: now, pausedMs: 0 };
}

export function pauseTimer(t: TimerState, now: Instant): TimerState {
  return t.pausedAt === undefined ? { ...t, pausedAt: now } : t;
}

export function resumeTimer(t: TimerState, now: Instant): TimerState {
  if (t.pausedAt === undefined) return t;
  const { pausedAt, ...rest } = t;
  return { ...rest, pausedMs: t.pausedMs + Math.max(0, now - pausedAt) };
}

export function activeMs(t: TimerState, now: Instant): number {
  const pausedNow = t.pausedAt === undefined ? 0 : Math.max(0, now - t.pausedAt);
  return Math.max(0, now - t.startedAt - t.pausedMs - pausedNow);
}

/** Где мы в цикле Помодоро после active миллисекунд занятия. */
function locate(active: number, pomodoro: PomodoroSettings) {
  const focus = pomodoro.focusMinutes * MINUTE;
  if (focus <= 0) throw new Error('Длительность фокуса в Помодоро должна быть больше нуля');
  let t = 0;
  let focusMs = 0;
  for (let cycle = 1; ; cycle++) {
    if (active < t + focus) {
      return {
        phase: 'focus' as const,
        cycle,
        length: focus,
        elapsed: active - t,
        focusMs: focusMs + active - t,
      };
    }
    focusMs += focus;
    t += focus;
    const long = cycle % pomodoro.cyclesBeforeLongBreak === 0;
    const rest = (long ? pomodoro.longBreakMinutes : pomodoro.breakMinutes) * MINUTE;
    if (active < t + rest) {
      return {
        phase: long ? ('long-break' as const) : ('break' as const),
        cycle,
        length: rest,
        elapsed: active - t,
        focusMs,
      };
    }
    t += rest;
  }
}

export function timerView(
  t: TimerState,
  now: Instant,
  pomodoro: PomodoroSettings = DEFAULT_POMODORO,
): TimerView {
  const active = activeMs(t, now);
  const where = locate(active, pomodoro);
  const plannedMs = t.plannedMinutes * MINUTE;
  return {
    sessionId: t.sessionId,
    paused: t.pausedAt !== undefined,
    phase: where.phase,
    cycle: where.cycle,
    phaseLengthMs: where.length,
    phaseElapsedMs: where.elapsed,
    activeMs: active,
    focusMs: where.focusMs,
    plannedMs,
    remainingMs: Math.max(0, plannedMs - active),
    overtime: active > plannedMs,
  };
}

export interface TimerResult {
  /** Чистое время учёбы, минуты — идёт в статистику. */
  focusMinutes: number;
  /** Время занятия без пауз, минуты — для калибровки длительности. */
  activeMinutes: number;
  endedEarly: boolean;
}

/** Завершение занятия в любой момент: записывается, сколько было на самом деле. */
export function finishTimer(
  t: TimerState,
  now: Instant,
  pomodoro: PomodoroSettings = DEFAULT_POMODORO,
): TimerResult {
  const view = timerView(t, now, pomodoro);
  return {
    focusMinutes: Math.round(view.focusMs / MINUTE),
    activeMinutes: Math.round(view.activeMs / MINUTE),
    endedEarly: view.activeMs < view.plannedMs - MINUTE,
  };
}

/** Сколько чистой учёбы помещается в занятие такой длительности. */
export function plannedFocusMinutes(
  durationMinutes: number,
  pomodoro: PomodoroSettings = DEFAULT_POMODORO,
): number {
  return Math.round(locate(durationMinutes * MINUTE, pomodoro).focusMs / MINUTE);
}

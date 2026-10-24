import { describe, expect, it } from 'vitest';
import { MINUTE } from './time';
import {
  finishTimer,
  pauseTimer,
  plannedFocusMinutes,
  resumeTimer,
  startTimer,
  timerView,
} from './timer';

const T0 = Date.UTC(2026, 10, 2, 7, 0);
const at = (minutes: number) => T0 + minutes * MINUTE;

describe('таймер Помодоро', () => {
  it('25 минут фокуса, 5 перерыва, после 4 циклов — длинный перерыв', () => {
    const t = startTimer('s1', 180, T0);
    expect(timerView(t, at(10))).toMatchObject({ phase: 'focus', cycle: 1 });
    expect(timerView(t, at(27))).toMatchObject({ phase: 'break', cycle: 1 });
    expect(timerView(t, at(31))).toMatchObject({ phase: 'focus', cycle: 2 });
    // 4 × (25 + 5) − 5 = 115: конец четвёртого фокуса
    expect(timerView(t, at(116))).toMatchObject({ phase: 'long-break', cycle: 4 });
    expect(timerView(t, at(131))).toMatchObject({ phase: 'focus', cycle: 5 });
  });

  it('считает чистое время учёбы без перерывов', () => {
    const t = startTimer('s1', 90, T0);
    expect(timerView(t, at(90)).focusMs).toBe(75 * MINUTE);
    expect(timerView(t, at(40)).focusMs).toBe(35 * MINUTE);
  });

  it('пауза не идёт ни в занятие, ни в учёбу', () => {
    let t = startTimer('s1', 90, T0);
    t = pauseTimer(t, at(10));
    expect(timerView(t, at(40))).toMatchObject({ paused: true, activeMs: 10 * MINUTE });
    t = resumeTimer(t, at(40));
    expect(timerView(t, at(45))).toMatchObject({ paused: false, activeMs: 15 * MINUTE });
    // повторная пауза и повторное продолжение ничего не ломают
    expect(pauseTimer(pauseTimer(t, at(50)), at(55)).pausedAt).toBe(at(50));
    expect(resumeTimer(t, at(60))).toBe(t);
  });

  it('досрочное завершение записывает, сколько было на самом деле', () => {
    const t = startTimer('s1', 90, T0);
    expect(finishTimer(t, at(30))).toEqual({
      focusMinutes: 25,
      activeMinutes: 30,
      endedEarly: true,
    });
    expect(finishTimer(t, at(90))).toEqual({
      focusMinutes: 75,
      activeMinutes: 90,
      endedEarly: false,
    });
  });

  it('после запланированного времени показывает переработку', () => {
    const t = startTimer('s1', 30, T0);
    expect(timerView(t, at(35))).toMatchObject({ overtime: true, remainingMs: 0 });
  });

  it('плановое чистое время для разных длительностей', () => {
    expect([30, 45, 60, 75, 90].map((m) => plannedFocusMinutes(m))).toEqual([25, 40, 50, 65, 75]);
  });

  it('настраиваемый Помодоро', () => {
    const custom = {
      focusMinutes: 50,
      breakMinutes: 10,
      longBreakMinutes: 20,
      cyclesBeforeLongBreak: 2,
    };
    expect(plannedFocusMinutes(90, custom)).toBe(80);
    expect(timerView(startTimer('s', 90, T0), at(55), custom)).toMatchObject({ phase: 'break' });
  });
});

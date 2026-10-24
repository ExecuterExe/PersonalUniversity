import { describe, expect, it } from 'vitest';
import { buildPlan } from './build';
import { formatClock } from './format';
import { checkpointDue } from './analytics';
import { contextFor, planViolations } from './fixtures/check';
import { input, moment, oneOff, settings } from './fixtures/scenarios';
import {
  addMakeup,
  applyMove,
  checkManualMove,
  detectMissed,
  findMoveOptions,
  loadPreview,
  resolveConflictsAutomatically,
} from './moves';
import { checkPlacement, occupiesTime } from './rules';
import { DAY, localInfo, MINUTE } from './time';
import type { PlanState, Session } from './types';

function basePlan(maxWeeklyMinutes = 600) {
  const planInput = input({ settings: settings({ maxWeeklyMinutes }) });
  const result = buildPlan(planInput);
  if (!result.ok) throw new Error(result.failure.message);
  return { state: result.state, busy: planInput.busy };
}

/** Первое занятие дисциплины в указанную неделю. */
function sessionOf(state: PlanState, disciplineId: string, week: number): Session {
  const cal = contextFor(state, []).cal;
  return state.sessions.find(
    (s) => s.disciplineId === disciplineId && localInfo(cal, s.start).weekIndex === week,
  )!;
}

const dateOf = (state: PlanState, s: Session) =>
  localInfo(contextFor(state, []).cal, s.start).dateKey;
const clockOf = (state: PlanState, instant: number) =>
  formatClock(localInfo(contextFor(state, []).cal, instant).minuteOfDay);

describe('переносы при конфликте', () => {
  it('варианты от дешёвого к дорогому, каждый проходит правила, первым — тот же день', () => {
    const { state, busy } = basePlan();
    const target = sessionOf(state, 'biases', 3);
    const start = clockOf(state, target.start);
    // Событие на 45 минут поверх занятия: тем же вечером место ещё есть.
    const [h, m] = start.split(':').map(Number) as [number, number];
    const end = formatClock(h * 60 + m + 45);
    const event = oneOff(dateOf(state, target), start, end, 'Звонок');
    const ctx = contextFor(state, [...busy, event]);

    const options = findMoveOptions(ctx, state.sessions, target.id, target.start - DAY, 'conflict');
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(3);
    expect(options.map((o) => o.cost)).toEqual(
      [...options.map((o) => o.cost)].sort((a, b) => a - b),
    );
    expect(options[0]!.kind).toBe('same-day');
    for (const o of options) {
      const moved = { ...target, start: o.start, end: o.end };
      expect(checkPlacement(ctx, moved, state.sessions)).toEqual([]);
      // Внутри недели нагрузка не меняется, на следующую — переезжает туда.
      expect(o.weekLoadAfter).toBe(o.weekLoadBefore + (o.kind === 'next-week' ? 90 : 0));
    }
  });

  it('при недельной нагрузке на лимите на следующую неделю не переносит', () => {
    const { state, busy } = basePlan(); // ровно 10 ч из 10
    const target = sessionOf(state, 'thinking', 2);
    const cal = contextFor(state, []).cal;
    const week = localInfo(cal, target.start).weekIndex;
    const blocked = state.sessions
      .filter((s) => localInfo(cal, s.start).weekIndex === week)
      .map((s) => oneOff(dateOf(state, s), '17:00', '22:00', 'Отпуск'));
    const ctx = contextFor(state, [...busy, ...blocked]);
    expect(findMoveOptions(ctx, state.sessions, target.id, target.start - DAY, 'conflict')).toEqual(
      [],
    );
  });

  it('при переносе на другую неделю показывает рост нагрузки', () => {
    const { state, busy } = basePlan(900);
    const target = sessionOf(state, 'thinking', 2);
    const cal = contextFor(state, []).cal;
    const week = localInfo(cal, target.start).weekIndex;
    // Вся неделя занята вечерами — остаётся только следующая.
    const blocked = state.sessions
      .filter((s) => localInfo(cal, s.start).weekIndex === week)
      .map((s) => oneOff(dateOf(state, s), '17:00', '22:00', 'Отпуск'));
    const ctx = contextFor(state, [...busy, ...blocked, ...weekendBlock(state, week)]);
    const options = findMoveOptions(ctx, state.sessions, target.id, target.start - DAY, 'conflict');
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.kind === 'next-week')).toBe(true);
    for (const o of options) expect(o.weekLoadAfter).toBe(o.weekLoadBefore + 60);
  });

  it('применённый перенос помнит исходное место и причину', () => {
    const { state } = basePlan();
    const target = sessionOf(state, 'biases', 1);
    const moved = applyMove(
      state.sessions,
      target.id,
      { start: target.start + 60 * MINUTE, end: target.end + 60 * MINUTE },
      'событие «Звонок»',
    );
    const after = moved.find((s) => s.id === target.id)!;
    expect(after).toMatchObject({
      origin: 'moved',
      originalStart: target.start,
      moveReason: 'событие «Звонок»',
    });
    // Повторный перенос не теряет самое первое место.
    const again = applyMove(
      moved,
      target.id,
      { start: target.start + 90 * MINUTE, end: target.end + 90 * MINUTE },
      'ещё раз',
    );
    expect(again.find((s) => s.id === target.id)!.originalStart).toBe(target.start);
  });

  it('автоматический перенос черновика: основные выбирают первыми, нерешённое возвращается', () => {
    const { state, busy } = basePlan();
    const target = sessionOf(state, 'fallacies', 4);
    const ctx = contextFor(state, [
      ...busy,
      oneOff(dateOf(state, target), '17:00', '22:00', 'Свадьба'),
    ]);
    const result = resolveConflictsAutomatically(ctx, state.sessions, target.start - DAY);
    expect(result.moved).toBe(1);
    expect(result.unresolved).toEqual([]);
    const after = result.sessions.find((s) => s.id === target.id)!;
    expect(after.moveReason).toBe('событие «Свадьба»');
    expect(checkPlacement(ctx, after, result.sessions)).toEqual([]);
  });
});

describe('пропуски и отработки', () => {
  it('пропуск — занятие не начато до конца своего времени', () => {
    const { state } = basePlan();
    const first = state.sessions[0]!;
    expect(detectMissed(state.sessions, first.end - MINUTE)).toEqual([]);
    expect(detectMissed(state.sessions, first.end)).toEqual([first.id]);
    const held = state.sessions.map((s) =>
      s.id === first.id ? { ...s, status: 'held' as const } : s,
    );
    expect(detectMissed(held, first.end)).toEqual([]);
  });

  it('отработка — только в ближайшие 7 дней и по всем правилам', () => {
    const { state, busy } = basePlan();
    const missedOne = sessionOf(state, 'biases', 2);
    const now = missedOne.end + 60 * MINUTE;
    const sessions = state.sessions.map((s) =>
      s.id === missedOne.id ? { ...s, status: 'missed' as const } : s,
    );
    const ctx = contextFor(state, busy);
    const options = findMoveOptions(ctx, sessions, missedOne.id, now, 'makeup');
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(o.kind).toBe('makeup');
      expect(o.start).toBeGreaterThan(now);
      expect(o.start).toBeLessThan(now + 8 * DAY);
      expect(o.weekLoadAfter).toBe(o.weekLoadBefore + 90);
      const makeup = { id: 'x', disciplineId: 'biases', start: o.start, end: o.end };
      expect(checkPlacement(ctx, makeup, sessions.filter(occupiesTime))).toEqual([]);
    }

    const withMakeup = addMakeup(sessions, missedOne.id, options[0]!);
    const makeup = withMakeup.find((s) => s.origin === 'makeup')!;
    expect(makeup).toMatchObject({
      id: `${missedOne.id}.makeup`,
      status: 'planned',
      originalStart: missedOne.start,
    });
    expect(withMakeup.find((s) => s.id === missedOne.id)!.status).toBe('missed');
  });
});

describe('серия пропусков', () => {
  it('три пропуска подряд: каждый отмечен, отработки по одной, итог нагрузки виден, сработал ранний сигнал', () => {
    const { state, busy } = basePlan(900);
    const ctx = contextFor(state, busy);
    const missedIds = state.sessions.slice(0, 3).map((s) => s.id);
    const now = state.sessions[2]!.end + 30 * MINUTE;
    expect(detectMissed(state.sessions, now)).toEqual(missedIds);

    let sessions = state.sessions.map((s) =>
      missedIds.includes(s.id) ? { ...s, status: 'missed' as const } : s,
    );
    const marked = sessions;
    // Варианты для каждого следующего пропуска ищутся уже с учётом выбранных отработок.
    // Если места не осталось — вариантов нет, а не нарушение правил.
    const madeUp: string[] = [];
    for (const id of missedIds) {
      const [option] = findMoveOptions(ctx, sessions, id, now, 'makeup');
      if (!option) continue;
      sessions = addMakeup(sessions, id, option);
      madeUp.push(id);
    }
    expect(madeUp.length).toBeGreaterThan(0);
    expect(planViolations(ctx, sessions)).toEqual([]);

    const preview = loadPreview(ctx, marked, sessions);
    const added = preview.reduce((sum, w) => sum + w.afterMinutes - w.beforeMinutes, 0);
    const expected = madeUp
      .map((id) => state.sessions.find((x) => x.id === id)!)
      .reduce((sum, s) => sum + (s.end - s.start) / MINUTE, 0);
    expect(added).toBe(expected);
    expect(preview.every((w) => w.capMinutes === 900)).toBe(true);

    expect(
      checkpointDue({ ...state, sessions: marked }, now, { midDone: false, endDone: false }),
    ).toBe('early');
  });
});

describe('ручной перенос', () => {
  it('на событие — с объяснением, на свободное место — без замечаний', () => {
    const { state, busy } = basePlan();
    const target = sessionOf(state, 'thinking', 1);
    const ctx = contextFor(state, busy);
    const atWork = moment(1, 2, '12:00'); // вторник, разгар рабочего дня
    const violations = checkManualMove(ctx, state.sessions, target.id, atWork);
    expect(violations.map((v) => v.code)).toEqual(
      expect.arrayContaining(['busy', 'outside-window']),
    );
    expect(checkManualMove(ctx, state.sessions, target.id, target.start + 15 * MINUTE)).toEqual([]);
  });
});

/** Вечера выходных недели — для сценария «переносить можно только на следующую неделю». */
function weekendBlock(state: PlanState, week: number) {
  const cal = contextFor(state, []).cal;
  return [5, 6].map((offset) => {
    const day = cal.firstMonday.plus({ days: week * 7 + offset });
    return oneOff(day.toISODate()!, '17:00', '22:00', 'Поездка');
  });
}

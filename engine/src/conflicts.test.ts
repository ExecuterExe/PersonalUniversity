import { describe, expect, it } from 'vitest';
import { buildPlan } from './build';
import { applyConflictCompromise, applySkeletonChange, detectConflicts } from './conflicts';
import { contextFor, planViolations } from './fixtures/check';
import { formatClock } from './format';
import { input, moment, oneOff, weekly } from './fixtures/scenarios';
import { fitsWeek, isActiveAt } from './skeleton';
import { localInfo } from './time';

function basePlan() {
  const planInput = input();
  const result = buildPlan(planInput);
  if (!result.ok) throw new Error(result.failure.message);
  return { state: result.state, busy: planInput.busy };
}

describe('конфликты после построения', () => {
  it('новое разовое событие → вопрос с вариантами; «оставить как есть» больше не спрашивается', () => {
    const { state, busy } = basePlan();
    const ctx0 = contextFor(state, busy);
    const target = state.sessions.find((s) => localInfo(ctx0.cal, s.start).weekIndex === 3)!;
    const info = localInfo(ctx0.cal, target.start);
    const event = oneOff(
      info.dateKey,
      formatClock(info.minuteOfDay),
      formatClock(info.minuteOfDay + 30),
      'Врач',
    );
    const ctx = contextFor(state, [...busy, event]);
    const now = moment(0, 1, '08:00');

    const conflicts = detectConflicts(ctx, state, now);
    expect(conflicts.map((c) => c.sessionId)).toEqual([target.id]);
    expect(conflicts[0]!.events[0]!.title).toBe('Врач');
    expect(conflicts[0]!.options.length).toBeGreaterThan(0);
    expect(conflicts[0]!.skeletonChange).toBeUndefined();

    const kept = {
      ...state,
      sessions: state.sessions.map((s) =>
        s.id === target.id ? { ...s, acceptedViolations: ['busy' as const] } : s,
      ),
    };
    expect(detectConflicts(ctx, kept, now)).toEqual([]);
  });

  it('прошлые и уже проведённые занятия конфликтами не считаются', () => {
    const { state, busy } = basePlan();
    const ctx0 = contextFor(state, busy);
    const first = state.sessions[0]!;
    const info = localInfo(ctx0.cal, first.start);
    const ctx = contextFor(state, [
      ...busy,
      oneOff(
        info.dateKey,
        formatClock(info.minuteOfDay),
        formatClock(info.minuteOfDay + 30),
        'Врач',
      ),
    ]);
    expect(detectConflicts(ctx, state, first.end)).toEqual([]);
  });

  it('переносить некуда → компромиссы для одного занятия, и после выбора правила считаются соблюдёнными', () => {
    const { state, busy } = basePlan(); // неделя ровно 10 ч из 10
    const ctx0 = contextFor(state, busy);
    const target = state.sessions.find(
      (s) => s.disciplineId === 'thinking' && localInfo(ctx0.cal, s.start).weekIndex === 2,
    )!;
    // Все вечера недели заняты, на следующую — не пускает недельный лимит.
    const evenings = [0, 1, 2, 3, 4, 5, 6].map((offset) =>
      oneOff(
        ctx0.cal.firstMonday.plus({ days: 14 + offset }).toISODate()!,
        '17:00',
        '22:00',
        'Сборы',
      ),
    );
    const ctx = contextFor(state, [...busy, ...evenings]);
    const now = moment(1, 7, '12:00');

    const conflict = detectConflicts(ctx, state, now).find((c) => c.sessionId === target.id)!;
    expect(conflict.options).toEqual([]);
    const titles = conflict.compromises.map((c) => c.title);
    expect(titles.some((t) => t.startsWith('Один раз выйти за окна для учёбы'))).toBe(true);
    expect(titles.some((t) => t.startsWith('Один раз превысить недельный лимит'))).toBe(true);

    const outside = conflict.compromises.find((c) =>
      c.acceptedViolations.includes('outside-window'),
    )!;
    const sessions = applyConflictCompromise(state.sessions, target.id, outside, 'событие «Сборы»');
    const moved = sessions.find((s) => s.id === target.id)!;
    expect(moved.acceptedViolations).toEqual(['outside-window']);
    expect(moved.originalStart).toBe(target.start);
    const others = new Set(sessions.filter((s) => s.id !== target.id).map((s) => s.id));
    expect(planViolations(ctx, sessions, others)).toEqual([]);
  });

  it('повторяющееся событие на слот каркаса → предложение перенести слот насовсем', () => {
    const { state, busy } = basePlan();
    const slot = state.skeleton.find((s) => s.disciplineId === 'fallacies')!;
    const courses = weekly(
      [slot.weekday],
      formatClock(slot.startMinute),
      formatClock(slot.startMinute + slot.durationMinutes),
      'Курсы',
      { fromWeek: 5, recurringId: 'courses' },
    );
    const ctx = contextFor(state, [...busy, ...courses]);
    const now = moment(4, 7, '12:00'); // воскресенье пятой недели

    const conflicts = detectConflicts(ctx, state, now);
    const ofSlot = conflicts.filter(
      (c) => state.sessions.find((s) => s.id === c.sessionId)!.skeletonSlotId === slot.id,
    );
    expect(ofSlot).toHaveLength(7); // недели 6–12
    const proposal = ofSlot[0]!.skeletonChange!;
    expect(proposal).toBeDefined();
    expect(proposal.slotId).toBe(slot.id);
    expect(proposal.newSlot.fromWeek).toBe(5);
    expect(proposal.description).toMatch(/^Перенести «Логические ошибки» насовсем: /);
    const others = state.skeleton.filter((s) => s.id !== slot.id && isActiveAt(s, 5));
    expect(fitsWeek(others, proposal.newSlot, state.settings)).toBe(true);

    const applied = applySkeletonChange(ctx, state, proposal, now);
    const next = applied.state;
    // Старый слот закрыт, его будущих занятий по каркасу больше нет.
    expect(next.skeleton.find((s) => s.id === slot.id)!.toWeek).toBe(5);
    expect(next.sessions.filter((s) => s.skeletonSlotId === slot.id && s.start > now)).toEqual([]);
    // Прошлое не тронуто.
    const past = (sessions: typeof state.sessions) => sessions.filter((s) => s.start <= now);
    expect(past(next.sessions)).toEqual(past(state.sessions));
    // Курсы больше не мешают «Логическим ошибкам», и правила соблюдены.
    const remaining = detectConflicts(ctx, next, now).filter(
      (c) => next.sessions.find((s) => s.id === c.sessionId)!.disciplineId === 'fallacies',
    );
    expect(remaining).toEqual([]);
    const unresolved = new Set(applied.conflicts.map((c) => c.sessionId));
    expect(
      planViolations(
        ctx,
        next.sessions.filter((s) => s.start > now),
        unresolved,
      ),
    ).toEqual([]);
  });
});

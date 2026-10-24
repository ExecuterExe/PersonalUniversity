import { describe, expect, it } from 'vitest';
import { buildPlan } from './build';
import { addDiscipline, extendSemester, makeBiweekly, removeDiscipline } from './changes';
import { localInfo } from './time';
import { contextFor, planViolations } from './fixtures/check';
import { DISCIPLINES, input, moment, settings } from './fixtures/scenarios';
import type { Discipline, PlanState } from './types';

/** «Когнитивные искажения» и «Логические ошибки» по 3 раза, «Критическое мышление» 1 раз — 10 ч. */
function basePlan(maxWeeklyMinutes = 600) {
  const planInput = input({ settings: settings({ maxWeeklyMinutes }) });
  const result = buildPlan(planInput);
  if (!result.ok) throw new Error(result.failure.message);
  return { state: result.state, busy: planInput.busy };
}

const NOW = moment(4, 1, '08:00'); // понедельник пятой недели
const past = (state: PlanState) => state.sessions.filter((s) => s.start <= NOW);
const future = (state: PlanState) => state.sessions.filter((s) => s.start > NOW);
const models: Discipline = {
  id: 'models',
  name: 'Ментальные модели',
  priority: 'main',
  durationMinutes: 90,
};

describe('новая дисциплина посреди семестра', () => {
  it('прошлое не трогается, старые занятия на месте, новые — только в будущем', () => {
    const { state, busy } = basePlan(660);
    const result = addDiscipline(state, DISCIPLINES.rhetoric, busy, NOW);
    expect(result.ok).toBe(true);
    const next = result.state!;

    expect(past(next)).toEqual(past(state));
    for (const s of future(state)) expect(next.sessions).toContainEqual(s);
    const added = next.sessions.filter((s) => s.disciplineId === 'rhetoric');
    expect(added).toHaveLength(result.addedSessions);
    expect(added.every((s) => s.start > NOW)).toBe(true);
    expect(result.frequencyChanges).toEqual([{ disciplineId: 'rhetoric', to: 1 }]);
    expect(result.removedSessions).toBe(0);
    expect(planViolations(contextFor(next, busy), future(next))).toEqual([]);
  });

  it('не хватает места — понижает сначала новую основную, потом старые 3 → 2 и показывает было → станет', () => {
    const { state, busy } = basePlan();
    const result = addDiscipline(state, models, busy, NOW);
    expect(result.ok).toBe(true);
    expect(result.before.peakMinutes).toBe(600);
    expect(result.after!.peakMinutes).toBeLessThanOrEqual(600);
    expect(result.frequencyChanges).toEqual(
      expect.arrayContaining([
        { disciplineId: 'models', to: 2 },
        { disciplineId: 'biases', from: 3, to: 2 },
        { disciplineId: 'fallacies', from: 3, to: 2 },
      ]),
    );
    const next = result.state!;
    expect(result.removedSessions).toBe(2 * 8); // по одному слоту у двух дисциплин, недели 5–12
    expect(past(next)).toEqual(past(state));
    for (const id of ['biases', 'fallacies', 'models']) {
      const week6 = next.sessions.filter(
        (s) =>
          s.disciplineId === id &&
          s.start >= moment(5, 1, '00:00') &&
          s.start < moment(6, 1, '00:00'),
      );
      expect(week6).toHaveLength(2);
    }
    expect(planViolations(contextFor(next, busy), future(next))).toEqual([]);
  });

  it('совсем не помещается — объясняет и предлагает компромиссы только для новой дисциплины', () => {
    const { state, busy } = basePlan(540);
    const result = addDiscipline(state, models, busy, NOW);
    expect(result.ok).toBe(false);
    expect(result.failure).toContain('«Ментальные модели»');
    const titles = result.compromises.map((c) => c.title);
    expect(titles).toContain('«Ментальные модели» — занятия по 1 ч');
    expect(titles).toContain('Поднять недельный лимит до 10 ч');
    expect(result.compromises.every((c) => c.relaxation.kind !== 'postpone')).toBe(true);
  });
});

describe('действия контрольной точки', () => {
  it('продлить семестр: каркас продолжается, прошлое и план не меняются', () => {
    const { state, busy } = basePlan();
    const result = extendSemester(state, 2, busy, NOW);
    const next = result.state!;
    expect(next.semester.weeks).toBe(14);
    expect(result.addedSessions).toBe(2 * state.skeleton.length);
    for (const s of state.sessions) expect(next.sessions).toContainEqual(s);
    expect(planViolations(contextFor(next, busy), future(next))).toEqual([]);
  });

  it('дополнительную — раз в 2 недели со следующей недели', () => {
    const { state, busy } = basePlan();
    const result = makeBiweekly(state, 'thinking', NOW);
    expect(result.ok).toBe(true);
    const next = result.state!;
    expect(next.frequencies.thinking).toBe(0.5);
    expect(result.frequencyChanges).toEqual([{ disciplineId: 'thinking', from: 1, to: 0.5 }]);
    expect(result.removedSessions).toBe(3); // уходят 7-я, 9-я и 11-я недели (счёт с 1)
    const cal = contextFor(next, busy).cal;
    const weeks = next.sessions
      .filter((s) => s.disciplineId === 'thinking')
      .map((s) => localInfo(cal, s.start).weekIndex);
    expect(weeks).toEqual([0, 1, 2, 3, 4, 5, 7, 9, 11]);
    expect(result.after!.peakMinutes).toBe(600); // самая тяжёлая неделя — та, где занятие есть
    expect(result.after!.averageMinutes).toBe(570);

    // При продлении каркас продолжает чередование.
    const extended = extendSemester(next, 2, busy, NOW).state!;
    const later = extended.sessions
      .filter((s) => s.disciplineId === 'thinking')
      .map((s) => localInfo(cal, s.start).weekIndex);
    expect(later).toEqual([0, 1, 2, 3, 4, 5, 7, 9, 11, 13]);
  });

  it('раз в 2 недели нельзя сделать основную, которая идёт 3 раза', () => {
    const { state } = basePlan();
    expect(makeBiweekly(state, 'biases', NOW).ok).toBe(false);
  });
});

describe('удаление дисциплины', () => {
  it('будущие занятия исчезают, прошлые и чужие остаются', () => {
    const { state } = basePlan();
    const result = removeDiscipline(state, 'thinking', NOW);
    const next = result.state!;
    expect(next.frequencies.thinking).toBeUndefined();
    expect(next.sessions.some((s) => s.disciplineId === 'thinking' && s.start > NOW)).toBe(false);
    expect(past(next)).toEqual(past(state));
    expect(next.sessions.filter((s) => s.disciplineId !== 'thinking')).toEqual(
      state.sessions.filter((s) => s.disciplineId !== 'thinking'),
    );
    expect(result.after!.peakMinutes).toBe(result.before.peakMinutes - 60);
    expect(result.removedSessions).toBe(8); // недели 5–12
  });
});

import { describe, expect, it } from 'vitest';
import { buildPlan, type PlanInput } from './build';
import { CandidateCache } from './candidates';
import { applyRelaxation } from './compromises';
import { DAY_PARTS, MIN_FREQUENCY } from './defaults';
import { contextFor, planViolations } from './fixtures/check';
import {
  DISCIPLINES,
  input,
  NOW,
  oneOff,
  SCENARIOS,
  settings,
  weekly,
  WEEKS,
} from './fixtures/scenarios';
import { makeRuleContext } from './rules';
import { cyclicGaps } from './rhythm';
import { localInfo } from './time';

const scenario = (name: string): PlanInput => SCENARIOS.find((s) => s.name === name)!.input;

function buildOk(planInput: PlanInput) {
  const result = buildPlan(planInput);
  if (!result.ok) throw new Error(`Ожидался план, а получилось: ${result.failure.message}`);
  return result;
}

describe('построение семестра', () => {
  it('обычная неделя: всё встаёт и ни одно правило не нарушено', () => {
    const planInput = scenario('free');
    const result = buildOk(planInput);
    const { state } = result;

    // 3 + 3 + 1 + 1 не помещается в 10 ч → одна основная понижена до 2
    expect(Object.values(state.frequencies).sort()).toEqual([1, 1, 2, 3]);
    expect(result.warnings.map((w) => w.code)).toContain('reduced');
    expect(result.budget.peakMinutes).toBeLessThanOrEqual(planInput.settings.maxWeeklyMinutes);

    const ctx = contextFor(state, planInput.busy);
    expect(planViolations(ctx, state.sessions)).toEqual([]);
    expect(state.sessions.every((s) => s.start > NOW)).toBe(true);
    expect(state.sessions).toHaveLength(WEEKS * state.skeleton.length);
  });

  it('ритм: дни одной дисциплины не идут подряд, время одно и то же', () => {
    const { state } = buildOk(scenario('free'));
    for (const d of state.disciplines) {
      const own = state.skeleton.filter((s) => s.disciplineId === d.id);
      expect(own).toHaveLength(state.frequencies[d.id]!);
      if (own.length >= 2) {
        expect(cyclicGaps(own.map((s) => s.weekday))).not.toContain(1);
        expect(new Set(own.map((s) => s.startMinute)).size).toBe(1);
      }
    }
  });

  it('одна дисциплина в день, пока хватает дней', () => {
    const { state } = buildOk(scenario('free'));
    const perDay = new Map<number, number>();
    for (const s of state.skeleton) perDay.set(s.weekday, (perDay.get(s.weekday) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBe(1);
  });

  it('основные получают не меньше минимума, приоритет — реальный', () => {
    const { state, budget } = buildOk(scenario('ragged'));
    for (const d of state.disciplines) {
      expect(state.frequencies[d.id]).toBeGreaterThanOrEqual(MIN_FREQUENCY[d.priority]);
    }
    expect(budget.mainMinutes).toBeGreaterThan(budget.additionalMinutes);
  });

  it('рваный календарь: конфликты переносятся рядом, без нарушений', () => {
    const planInput = scenario('ragged');
    const result = buildOk(planInput);
    expect(result.moved).toBeGreaterThan(0);
    const ctx = contextFor(result.state, planInput.busy);
    const unresolved = new Set(result.conflicts.map((c) => c.sessionId));
    expect(planViolations(ctx, result.state.sessions, unresolved)).toEqual([]);
    for (const s of result.state.sessions.filter((x) => x.origin === 'moved')) {
      const from = localInfo(ctx.cal, s.originalStart!).weekIndex;
      const to = localInfo(ctx.cal, s.start).weekIndex;
      expect(to - from).toBeGreaterThanOrEqual(0);
      expect(to - from).toBeLessThanOrEqual(1);
      expect(s.moveReason).toMatch(/^событие «Встреча/);
    }
  });

  it('предупреждает, когда неделя заполнена до лимита', () => {
    const result = buildOk(scenario('ragged'));
    expect(result.warnings.some((w) => w.message.includes('отрабатывать пропуски'))).toBe(true);
  });

  it('пример «утро занято»: объясняет и предлагает разрешить вечер', () => {
    const planInput = scenario('busy-mornings');
    const result = buildPlan(planInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('placement');
    const evening = result.compromises.find(
      (c) =>
        c.relaxation.kind === 'allow-window' &&
        c.relaxation.window.start === DAY_PARTS.evening.start,
    );
    expect(evening?.title).toMatch(/^Разрешить 17:00–22:00 для /);
    expect(buildPlan(applyRelaxation(planInput, evening!.relaxation)).ok).toBe(true);
  });

  it('перегруз: честно называет нужные часы, каждый компромисс действительно помогает', () => {
    const planInput = scenario('overload');
    const result = buildPlan(planInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: 'budget', neededMinutes: 720 });
    expect(result.compromises.map((c) => c.title)).toContain('Поднять недельный лимит до 12 ч');
    for (const c of result.compromises) {
      expect(buildPlan(applyRelaxation(planInput, c.relaxation), { compromises: false }).ok).toBe(
        true,
      );
    }
  });

  it('согласованное «раз в 2 недели» не меняется и чередуется по неделям', () => {
    const { state } = buildOk(input({ frequencyOverrides: { thinking: 0.5 } }));
    expect(state.frequencies.thinking).toBe(0.5);
    const weeks = state.sessions
      .filter((s) => s.disciplineId === 'thinking')
      .map((s) => localInfo(contextFor(state, []).cal, s.start).weekIndex);
    expect(weeks).toHaveLength(WEEKS / 2);
    expect(new Set(weeks.map((w) => w % 2)).size).toBe(1);
  });

  it('место, занятое в большинстве недель, в каркас не берётся', () => {
    const planInput = input({
      busy: [
        ...weekly([1, 2, 3, 4, 5], '09:00', '18:00', 'Работа'),
        ...weekly([6], '17:00', '22:00', 'Подработка', { toWeek: 7 }), // 7 из 12 суббот
        ...weekly([7], '17:00', '22:00', 'Встречи', { toWeek: 5 }), // 5 из 12 воскресений
      ],
    });
    const ctx = makeRuleContext(
      planInput.semester,
      planInput.settings,
      planInput.disciplines,
      planInput.busy,
    );
    const cache = new CandidateCache(ctx, { now: NOW, fromWeek: 0, toWeek: WEEKS });
    const days = new Set(cache.candidates(DISCIPLINES.biases).map((c) => c.weekday));
    expect(days.has(6)).toBe(false);
    expect(days.has(7)).toBe(true);
  });

  it('прошлое не планируется: семестр, начатый посреди недели', () => {
    const now = oneOff('2026-11-04', '12:00', '12:01', '').start; // среда первой недели
    const { state } = buildOk(input({ now }));
    expect(state.sessions.every((s) => s.start > now)).toBe(true);
  });

  it('пустой список дисциплин — пустой план', () => {
    const result = buildOk(input({ disciplines: [] }));
    expect(result.state.sessions).toEqual([]);
  });

  it('один и тот же вход — один и тот же план', () => {
    expect(buildOk(scenario('ragged')).state).toEqual(buildOk(scenario('ragged')).state);
  });

  it('окна, выбранные пользователем, меняют предложения компромиссов', () => {
    const s = settings({ studyWindows: [DAY_PARTS.morning] });
    expect(s.otherWindows).toContainEqual(DAY_PARTS.evening);
    expect(s.otherWindows).not.toContainEqual(DAY_PARTS.morning);
  });
});

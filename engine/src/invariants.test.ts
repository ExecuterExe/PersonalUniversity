// Свойства, которые должны выполняться на любом календаре: случайные, но воспроизводимые сценарии.
import { describe, expect, it } from 'vitest';
import { buildPlan, type PlanInput } from './build';
import { CandidateCache } from './candidates';
import { applyRelaxation } from './compromises';
import { detectConflicts } from './conflicts';
import { ALLOWED_DURATIONS, DAY_PARTS, MIN_FREQUENCY, MIN_SLOT_ROBUSTNESS } from './defaults';
import { contextFor, planViolations } from './fixtures/check';
import {
  input,
  oneOff,
  raggedEvenings,
  seededRandom,
  settings,
  weekly,
  WEEKS,
} from './fixtures/scenarios';
import { checkPlacement, occupiesTime } from './rules';
import { localInfo } from './time';
import type { Discipline, TimeWindow, Weekday } from './types';

const PARTS: TimeWindow[] = Object.values(DAY_PARTS);

function randomInput(seed: number): PlanInput {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

  const studyWindows = PARTS.filter(() => random() < 0.5);
  if (studyWindows.length === 0) studyWindows.push(pick(PARTS));
  const excluded = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter(() => random() < 0.15);

  const count = 1 + Math.floor(random() * 5);
  const disciplines: Discipline[] = Array.from({ length: count }, (_, i) => ({
    id: `d${i}`,
    name: `Дисциплина ${i + 1}`,
    priority: random() < 0.55 ? 'main' : 'additional',
    durationMinutes: pick(ALLOWED_DURATIONS),
  }));

  const work = pick([
    [],
    weekly([1, 2, 3, 4, 5], '09:00', '18:00', 'Работа'),
    weekly([1, 2, 3, 4, 5], '10:00', '19:00', 'Работа'),
    weekly([1, 3, 5], '08:00', '13:00', 'Учёба'),
  ]);
  return input({
    settings: settings({
      studyWindows,
      excludedWeekdays: excluded,
      bufferMinutes: pick([0, 10, 15, 20]),
      maxDailyMinutes: pick([120, 180, 240]),
      maxWeeklyMinutes: pick([300, 450, 600, 900]),
    }),
    disciplines,
    busy: [...work, ...raggedEvenings(seed, Math.floor(random() * 5))],
  });
}

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

describe('инварианты на случайных календарях', () => {
  it.each(SEEDS)('сценарий %i: план не нарушает правил, а отказ объясним', (seed) => {
    const planInput = randomInput(seed);
    const result = buildPlan(planInput);

    if (!result.ok) {
      expect(result.failure.message.length).toBeGreaterThan(0);
      // Каждый предложенный компромисс действительно решает проблему.
      for (const c of result.compromises) {
        expect(buildPlan(applyRelaxation(planInput, c.relaxation), { compromises: false }).ok).toBe(
          true,
        );
      }
      return;
    }

    const { state, budget } = result;
    const ctx = contextFor(state, planInput.busy);
    const unresolved = new Set(result.conflicts.map((c) => c.sessionId));

    expect(planViolations(ctx, state.sessions, unresolved)).toEqual([]);
    expect(budget.peakMinutes).toBeLessThanOrEqual(planInput.settings.maxWeeklyMinutes);
    expect(state.sessions.every((s) => s.start > planInput.now)).toBe(true);
    for (const d of state.disciplines) {
      expect(state.frequencies[d.id]).toBeGreaterThanOrEqual(MIN_FREQUENCY[d.priority]);
    }

    // Каждое место каркаса свободно хотя бы в половине недель.
    const cache = new CandidateCache(ctx, { now: planInput.now, fromWeek: 0, toWeek: WEEKS });
    for (const slot of state.skeleton) {
      expect(
        cache.robustness(slot.weekday, slot.startMinute, slot.durationMinutes, slot.parity),
      ).toBeGreaterThanOrEqual(MIN_SLOT_ROBUSTNESS);
    }

    // Новые события → любые предложенные переносы проходят все правила.
    const random = seededRandom(seed * 101);
    const targets = state.sessions.filter(() => random() < 0.08).slice(0, 4);
    const events = targets.map((s) => {
      const info = localInfo(ctx.cal, s.start);
      return oneOff(info.dateKey, '00:00', '23:59', `Событие ${s.id}`);
    });
    const ctx2 = contextFor(state, [...planInput.busy, ...events]);
    for (const conflict of detectConflicts(ctx2, state, planInput.now)) {
      const session = state.sessions.find((s) => s.id === conflict.sessionId)!;
      for (const o of conflict.options) {
        const moved = { ...session, start: o.start, end: o.end };
        expect(checkPlacement(ctx2, moved, state.sessions.filter(occupiesTime))).toEqual([]);
      }
    }
  });
});

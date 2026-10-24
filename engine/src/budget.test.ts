import { describe, expect, it } from 'vitest';
import { computeBudget, initialFrequencies, nextReduction, peakWeekMinutes } from './budget';
import { DISCIPLINES } from './fixtures/scenarios';
import { combinations, cyclicGaps, rhythmPenalty } from './rhythm';

const { biases, fallacies, thinking, rhetoric } = DISCIPLINES;
const all = [biases, fallacies, thinking, rhetoric];

describe('бюджет времени', () => {
  it('цели: основные 3 раза, дополнительные 1 раз; согласованное — как договорились', () => {
    expect(initialFrequencies(all)).toEqual({ biases: 3, fallacies: 3, thinking: 1, rhetoric: 1 });
    expect(initialFrequencies(all, { thinking: 0.5 })).toMatchObject({ thinking: 0.5 });
  });

  it('«раз в 2 недели» раскладываются по разным неделям', () => {
    const peak = peakWeekMinutes(all, { biases: 2, fallacies: 2, thinking: 0.5, rhetoric: 0.5 });
    expect(peak).toBe(360 + 60);
  });

  it('понижает только основные с 3 до 2: сначала не вставшую, иначе самую длинную', () => {
    const long = { ...fallacies, durationMinutes: 90 };
    const short = { ...biases, durationMinutes: 60 };
    const freq = { biases: 3, fallacies: 3, thinking: 1 } as const;
    expect(nextReduction([short, long, thinking], freq, new Set())).toBe('fallacies');
    expect(nextReduction([short, long, thinking], freq, new Set(), 'biases')).toBe('biases');
    expect(nextReduction([short, long, thinking], freq, new Set(), 'thinking')).toBe('fallacies');
    expect(nextReduction([short, long], { biases: 2, fallacies: 2 }, new Set())).toBeNull();
    expect(nextReduction([long], { fallacies: 3 }, new Set(['fallacies']))).toBeNull();
  });

  it('показывает доли основных и дополнительных и резерв', () => {
    const budget = computeBudget(all, { biases: 2, fallacies: 3, thinking: 1, rhetoric: 1 }, 600);
    expect(budget).toMatchObject({
      mainMinutes: 450,
      additionalMinutes: 105,
      averageMinutes: 555,
      peakMinutes: 555,
      reserveMinutes: 45,
    });
  });
});

describe('ритм', () => {
  it('интервалы по кругу недели', () => {
    expect(cyclicGaps([1, 3, 5])).toEqual([2, 2, 3]);
    expect(cyclicGaps([4])).toEqual([7]);
  });

  it('через день лучше, чем подряд', () => {
    expect(rhythmPenalty([1, 3, 5], 3)).toBeLessThan(rhythmPenalty([1, 2, 4], 3));
    expect(rhythmPenalty([1, 2, 4], 3)).toBeLessThan(rhythmPenalty([1, 2, 3], 3));
    expect(rhythmPenalty([1, 4], 2)).toBeLessThan(rhythmPenalty([1, 3], 2));
    expect(rhythmPenalty([1, 3], 2)).toBeLessThan(rhythmPenalty([1, 2], 2));
  });

  it('для одного раза в неделю ритм не важен', () => {
    expect(rhythmPenalty([3], 1)).toBe(0);
  });

  it('перебирает все сочетания дней', () => {
    expect(combinations([1, 2, 3, 4, 5, 6, 7], 3)).toHaveLength(35);
    expect(combinations([1, 2], 3)).toEqual([]);
  });
});

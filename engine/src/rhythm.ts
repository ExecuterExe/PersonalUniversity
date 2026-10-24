import type { Frequency, Weekday } from './types';

/** Интервалы между днями по кругу недели: [Пн, Ср, Пт] → [2, 2, 3]. */
export function cyclicGaps(days: readonly Weekday[]): number[] {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length <= 1) return [7];
  return sorted.map((d, i) => (i === sorted.length - 1 ? sorted[0]! + 7 - d : sorted[i + 1]! - d));
}

/** Максимальный перерыв без штрафа (методология, раздел 5). */
export function maxGapDays(f: Frequency): number {
  if (f >= 3) return 4;
  if (f >= 2) return 5;
  if (f >= 1) return 10;
  return 17;
}

/**
 * Штраф ритма в условных единицах, 0 — идеально.
 * Растёт с отклонением от равномерного шага, за соседние дни и за слишком длинный перерыв.
 */
export function rhythmPenalty(days: readonly Weekday[], f: Frequency): number {
  if (f <= 1 || days.length <= 1) return 0;
  const ideal = 7 / f;
  const limit = maxGapDays(f);
  return cyclicGaps(days).reduce(
    (sum, g) => sum + (g - ideal) ** 2 + (g === 1 ? 1 : 0) + Math.max(0, g - limit) * 2.5,
    0,
  );
}

export function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items as [T, ...T[]];
  return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)];
}

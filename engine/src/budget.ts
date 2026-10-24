import { MIN_FREQUENCY, TARGET_FREQUENCY } from './defaults';
import type { Discipline, Frequency } from './types';

export interface BudgetItem {
  disciplineId: string;
  frequency: Frequency;
  /** Средняя нагрузка в неделю. */
  weeklyMinutes: number;
}

export interface Budget {
  capMinutes: number;
  /** Средняя нагрузка в неделю. */
  averageMinutes: number;
  /** Самая загруженная неделя — с учётом дисциплин «раз в 2 недели». */
  peakMinutes: number;
  mainMinutes: number;
  additionalMinutes: number;
  reserveMinutes: number;
  items: BudgetItem[];
}

export function initialFrequencies(
  disciplines: readonly Discipline[],
  overrides: Readonly<Record<string, Frequency>> = {},
): Record<string, Frequency> {
  return Object.fromEntries(
    disciplines.map((d) => [d.id, overrides[d.id] ?? (TARGET_FREQUENCY[d.priority] as Frequency)]),
  );
}

/** Дисциплины «раз в 2 недели» раскладываются по чётным и нечётным неделям поровну. */
export function peakWeekMinutes(
  disciplines: readonly Discipline[],
  frequencies: Readonly<Record<string, Frequency>>,
): number {
  let weekly = 0;
  const biweekly: number[] = [];
  for (const d of disciplines) {
    const f = frequencies[d.id];
    if (f === undefined) continue;
    if (f === 0.5) biweekly.push(d.durationMinutes);
    else weekly += f * d.durationMinutes;
  }
  const parity = [0, 0];
  for (const minutes of biweekly.sort((a, b) => b - a)) {
    parity[parity[0]! <= parity[1]! ? 0 : 1]! += minutes;
  }
  return weekly + Math.max(parity[0]!, parity[1]!);
}

export function computeBudget(
  disciplines: readonly Discipline[],
  frequencies: Readonly<Record<string, Frequency>>,
  capMinutes: number,
): Budget {
  const items: BudgetItem[] = [];
  let mainMinutes = 0;
  let additionalMinutes = 0;
  for (const d of disciplines) {
    const frequency = frequencies[d.id];
    if (frequency === undefined) continue;
    const weeklyMinutes = frequency * d.durationMinutes;
    items.push({ disciplineId: d.id, frequency, weeklyMinutes });
    if (d.priority === 'main') mainMinutes += weeklyMinutes;
    else additionalMinutes += weeklyMinutes;
  }
  const peakMinutes = peakWeekMinutes(disciplines, frequencies);
  return {
    capMinutes,
    averageMinutes: mainMinutes + additionalMinutes,
    peakMinutes,
    mainMinutes,
    additionalMinutes,
    reserveMinutes: capMinutes - peakMinutes,
    items,
  };
}

/**
 * Какую дисциплину понизить следующей, если не помещается: основную с 3 до 2,
 * начиная с предпочтительной (той, что не встала) или самой длинной.
 * fixed — частоты, согласованные пользователем: их сервис сам не трогает.
 */
export function nextReduction(
  disciplines: readonly Discipline[],
  frequencies: Readonly<Record<string, Frequency>>,
  fixed: ReadonlySet<string>,
  prefer?: string,
): string | null {
  const reducible = disciplines.filter((d) => {
    const f = frequencies[d.id];
    return d.priority === 'main' && f !== undefined && f > MIN_FREQUENCY.main && !fixed.has(d.id);
  });
  if (reducible.length === 0) return null;
  if (prefer && reducible.some((d) => d.id === prefer)) return prefer;
  return reducible.reduce((a, b) => (b.durationMinutes > a.durationMinutes ? b : a)).id;
}

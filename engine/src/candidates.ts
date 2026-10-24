import { MIN_SLOT_ROBUSTNESS, SLOT_STEP_MINUTES } from './defaults';
import { allowedWindows, type RuleContext } from './rules';
import { slotInterval } from './time';
import { WEEKDAYS, type Discipline, type Instant, type Weekday } from './types';

/** Возможное место дисциплины в типичной неделе. */
export interface Candidate {
  weekday: Weekday;
  startMinute: number;
  durationMinutes: number;
  /** Доля недель, в которые место вместе с буферами свободно. */
  robustness: number;
  freeWeeks: number;
  totalWeeks: number;
}

export interface CandidateRange {
  now: Instant;
  fromWeek: number;
  toWeek: number;
}

export function gridStart(minute: number): number {
  return Math.ceil(minute / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
}

/** Считает устойчивость мест по неделям семестра и запоминает результат. */
export class CandidateCache {
  private readonly availabilityCache = new Map<string, { free: number; total: number }>();

  constructor(
    readonly ctx: RuleContext,
    readonly range: CandidateRange,
  ) {}

  /** В скольких неделях диапазона место свободно; parity — только чётные/нечётные недели. */
  availability(
    weekday: Weekday,
    startMinute: number,
    durationMinutes: number,
    parity?: 0 | 1,
  ): { free: number; total: number } {
    const key = `${weekday}/${startMinute}/${durationMinutes}/${parity ?? '-'}`;
    const cached = this.availabilityCache.get(key);
    if (cached) return cached;

    const { cal, busy } = this.ctx;
    const earliest = Math.max(this.range.now, cal.rangeStart);
    let free = 0;
    let total = 0;
    for (let w = this.range.fromWeek; w < this.range.toWeek; w++) {
      if (parity !== undefined && w % 2 !== parity) continue;
      const { start, end } = slotInterval(cal, w, weekday, startMinute, durationMinutes);
      if (start <= earliest || end > cal.rangeEnd) continue;
      total++;
      if (busy.isFree(start, end)) free++;
    }
    const result = { free, total };
    this.availabilityCache.set(key, result);
    return result;
  }

  robustness(weekday: Weekday, startMinute: number, durationMinutes: number, parity?: 0 | 1) {
    const { free, total } = this.availability(weekday, startMinute, durationMinutes, parity);
    return total === 0 ? 0 : free / total;
  }

  /** Все места для дисциплины, достаточно устойчивые для каркаса. */
  candidates(discipline: Discipline, parity?: 0 | 1): Candidate[] {
    const { settings } = this.ctx;
    const duration = discipline.durationMinutes;
    const seen = new Set<string>();
    const result: Candidate[] = [];
    for (const weekday of WEEKDAYS) {
      if (settings.excludedWeekdays.includes(weekday)) continue;
      for (const w of allowedWindows(this.ctx, discipline)) {
        for (let m = gridStart(w.start); m + duration <= w.end; m += SLOT_STEP_MINUTES) {
          const key = `${weekday}/${m}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const { free, total } = this.availability(weekday, m, duration, parity);
          if (total === 0 || free / total < MIN_SLOT_ROBUSTNESS) continue;
          result.push({
            weekday,
            startMinute: m,
            durationMinutes: duration,
            robustness: free / total,
            freeWeeks: free,
            totalWeeks: total,
          });
        }
      }
    }
    return result;
  }
}

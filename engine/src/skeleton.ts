import type { Candidate, CandidateCache } from './candidates';
import { combinations, rhythmPenalty } from './rhythm';
import type { Discipline, Frequency, Settings, SkeletonSlot, Weekday } from './types';

/** Веса мягких целей (методология, раздел 3). */
export const SCORE = {
  robustness: 100,
  roundHour: 3,
  roundHalfHour: 1.5,
  secondInDay: 25,
  spreadPerHour: 8,
  rhythm: 20,
} as const;

const MAX_PATTERNS = 15;
const LOCAL_SEARCH_ROUNDS = 4;

export function slotId(
  disciplineId: string,
  weekday: Weekday,
  startMinute: number,
  fromWeek: number,
): string {
  return `${disciplineId}/${weekday}/${startMinute}/${fromWeek}`;
}

export function parityOverlaps(a?: 0 | 1, b?: 0 | 1): boolean {
  return a === undefined || b === undefined || a === b;
}

export function isActiveAt(slot: SkeletonSlot, week: number): boolean {
  return slot.fromWeek <= week && (slot.toWeek === undefined || week < slot.toWeek);
}

export interface SlotShape {
  disciplineId: string;
  weekday: Weekday;
  startMinute: number;
  durationMinutes: number;
  parity?: 0 | 1;
}

/** Встаёт ли место в типичную неделю рядом с уже стоящими: жёсткие правила на уровне каркаса. */
export function fitsWeek(slots: readonly SlotShape[], c: SlotShape, settings: Settings): boolean {
  const sameDay = slots.filter(
    (s) => s.weekday === c.weekday && parityOverlaps(s.parity, c.parity),
  );
  if (sameDay.length >= settings.maxSessionsPerDay) return false;
  if (sameDay.some((s) => s.disciplineId === c.disciplineId)) return false;
  const buffer = settings.bufferMinutes;
  const end = c.startMinute + c.durationMinutes;
  const tooClose = sameDay.some(
    (s) =>
      s.startMinute < end + buffer && s.startMinute + s.durationMinutes + buffer > c.startMinute,
  );
  if (tooClose) return false;
  const dayTotal = sameDay.reduce((sum, s) => sum + s.durationMinutes, 0) + c.durationMinutes;
  return dayTotal <= settings.maxDailyMinutes;
}

/** Нагрузка чётной и нечётной недели. */
export function parityLoads(slots: readonly SlotShape[]): [number, number] {
  const loads: [number, number] = [0, 0];
  for (const s of slots) {
    if (s.parity !== 1) loads[0] += s.durationMinutes;
    if (s.parity !== 0) loads[1] += s.durationMinutes;
  }
  return loads;
}

function roundBonus(startMinute: number): number {
  if (startMinute % 60 === 0) return SCORE.roundHour;
  if (startMinute % 30 === 0) return SCORE.roundHalfHour;
  return 0;
}

export function localScore(robustness: number, startMinute: number, dayHasOther: boolean): number {
  return (
    SCORE.robustness * robustness + roundBonus(startMinute) - (dayHasOther ? SCORE.secondInDay : 0)
  );
}

/** Штраф за разное время одной дисциплины в разные дни. */
export function spreadPenalty(starts: readonly number[]): number {
  if (starts.length <= 1) return 0;
  const mean = starts.reduce((a, b) => a + b, 0) / starts.length;
  return (SCORE.spreadPerHour * starts.reduce((sum, s) => sum + Math.abs(s - mean), 0)) / 60;
}

/** Общая оценка каркаса — чем больше, тем лучше. */
export function scoreSkeleton(
  slots: readonly SkeletonSlot[],
  cache: CandidateCache,
  frequencies: Readonly<Record<string, Frequency>>,
): number {
  const byDiscipline = new Map<string, SkeletonSlot[]>();
  for (const s of slots) {
    const list = byDiscipline.get(s.disciplineId) ?? [];
    list.push(s);
    byDiscipline.set(s.disciplineId, list);
  }
  let total = 0;
  for (const [id, own] of byDiscipline) {
    for (const s of own) {
      const dayHasOther = slots.some(
        (o) => o !== s && o.weekday === s.weekday && parityOverlaps(o.parity, s.parity),
      );
      const r = cache.robustness(s.weekday, s.startMinute, s.durationMinutes, s.parity);
      total += localScore(r, s.startMinute, dayHasOther);
    }
    total -= spreadPenalty(own.map((s) => s.startMinute));
    total -=
      SCORE.rhythm *
      rhythmPenalty(
        own.map((s) => s.weekday),
        frequencies[id] ?? 1,
      );
  }
  return total;
}

/**
 * Лучшие места для одной дисциплины при уже стоящих слотах.
 * Перебирает рисунки дней (от лучшего ритма) и «опорное» время, чтобы дисциплина
 * по возможности стояла в одно и то же время. null — не помещается.
 */
export function bestPlacementFor(
  discipline: Discipline,
  frequency: Frequency,
  fixed: readonly SkeletonSlot[],
  cache: CandidateCache,
  settings: Settings,
  fromWeek: number,
): SkeletonSlot[] | null {
  const k = frequency === 0.5 ? 1 : frequency;
  const parities: (0 | 1 | undefined)[] = frequency === 0.5 ? [0, 1] : [undefined];
  const [load0, load1] = parityLoads(fixed);
  const added = discipline.durationMinutes * k;
  let best: { score: number; slots: SkeletonSlot[] } | null = null;

  for (const parity of parities) {
    const after0 = load0 + (parity !== 1 ? added : 0);
    const after1 = load1 + (parity !== 0 ? added : 0);
    if (after0 > settings.maxWeeklyMinutes || after1 > settings.maxWeeklyMinutes) continue;

    const byDay = new Map<Weekday, Candidate[]>();
    for (const c of cache.candidates(discipline, parity)) {
      const shape: SlotShape = {
        disciplineId: discipline.id,
        weekday: c.weekday,
        startMinute: c.startMinute,
        durationMinutes: c.durationMinutes,
        parity,
      };
      if (!fitsWeek(fixed, shape, settings)) continue;
      const list = byDay.get(c.weekday) ?? [];
      list.push(c);
      byDay.set(c.weekday, list);
    }
    const days = [...byDay.keys()].sort((a, b) => a - b);
    if (days.length < k) continue;

    const occupied = new Set(
      fixed.filter((s) => parityOverlaps(s.parity, parity)).map((s) => s.weekday),
    );
    const patterns = combinations(days, k)
      .map((pattern) => ({ pattern, penalty: rhythmPenalty(pattern, frequency) }))
      .sort((a, b) => a.penalty - b.penalty)
      .slice(0, MAX_PATTERNS);

    for (const { pattern, penalty } of patterns) {
      const anchors = new Set<number>();
      for (const day of pattern) for (const c of byDay.get(day)!) anchors.add(c.startMinute);

      for (const anchor of anchors) {
        let sum = -SCORE.rhythm * penalty;
        const chosen: Candidate[] = [];
        for (const day of pattern) {
          let pick: Candidate | null = null;
          let pickScore = -Infinity;
          for (const c of byDay.get(day)!) {
            const score =
              localScore(c.robustness, c.startMinute, occupied.has(day)) -
              (SCORE.spreadPerHour * Math.abs(c.startMinute - anchor)) / 60;
            if (score > pickScore) {
              pickScore = score;
              pick = c;
            }
          }
          chosen.push(pick!);
          sum += pickScore;
        }
        if (!best || sum > best.score) {
          best = {
            score: sum,
            slots: chosen.map((c) => ({
              id: slotId(discipline.id, c.weekday, c.startMinute, fromWeek),
              disciplineId: discipline.id,
              weekday: c.weekday,
              startMinute: c.startMinute,
              durationMinutes: c.durationMinutes,
              ...(parity === undefined ? {} : { parity }),
              fromWeek,
            })),
          };
        }
      }
    }
  }
  return best?.slots ?? null;
}

/** Порядок размещения: основные раньше; внутри — сначала «тяжёлые»; front — вперёд своей группы. */
export function placementOrder(
  disciplines: readonly Discipline[],
  frequencies: Readonly<Record<string, Frequency>>,
  front: readonly string[] = [],
): Discipline[] {
  const rank = (d: Discipline) => (d.priority === 'main' ? 0 : 1);
  const frontRank = (d: Discipline) => {
    const i = front.indexOf(d.id);
    return i === -1 ? front.length : i;
  };
  return disciplines
    .filter((d) => frequencies[d.id] !== undefined)
    .map((d, index) => ({ d, index }))
    .sort(
      (a, b) =>
        rank(a.d) - rank(b.d) ||
        frontRank(a.d) - frontRank(b.d) ||
        frequencies[b.d.id]! - frequencies[a.d.id]! ||
        b.d.durationMinutes - a.d.durationMinutes ||
        a.index - b.index,
    )
    .map(({ d }) => d);
}

export interface PlaceResult {
  slots: SkeletonSlot[];
  unplaced: string[];
}

/** Жадное размещение по порядку и затем локальное улучшение. */
export function placeSkeleton(
  order: readonly Discipline[],
  frequencies: Readonly<Record<string, Frequency>>,
  cache: CandidateCache,
  settings: Settings,
  fixed: readonly SkeletonSlot[] = [],
  fromWeek = 0,
): PlaceResult {
  let slots = [...fixed];
  const unplaced: string[] = [];
  for (const d of order) {
    const placement = bestPlacementFor(d, frequencies[d.id]!, slots, cache, settings, fromWeek);
    if (placement) slots.push(...placement);
    else unplaced.push(d.id);
  }
  if (unplaced.length > 0) return { slots, unplaced };

  // Локальный поиск: по очереди переставляем каждую дисциплину целиком, пока это улучшает оценку.
  const fixedIds = new Set(fixed.map((s) => s.id));
  let score = scoreSkeleton(slots, cache, frequencies);
  for (let round = 0; round < LOCAL_SEARCH_ROUNDS; round++) {
    let improved = false;
    for (const d of order) {
      const others = slots.filter((s) => s.disciplineId !== d.id || fixedIds.has(s.id));
      const replacement = bestPlacementFor(
        d,
        frequencies[d.id]!,
        others,
        cache,
        settings,
        fromWeek,
      );
      if (!replacement) continue;
      const candidate = [...others, ...replacement];
      const candidateScore = scoreSkeleton(candidate, cache, frequencies);
      if (candidateScore > score + 1e-6) {
        slots = candidate;
        score = candidateScore;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return { slots, unplaced };
}

/** Остаётся ли в типичной неделе место хотя бы для одного переноса самой длинной дисциплины. */
export function hasReserve(
  slots: readonly SkeletonSlot[],
  disciplines: readonly Discipline[],
  cache: CandidateCache,
  settings: Settings,
): boolean {
  if (disciplines.length === 0) return true;
  const longest = disciplines.reduce((a, b) => (b.durationMinutes > a.durationMinutes ? b : a));
  return cache.candidates(longest).some((c) =>
    fitsWeek(
      slots,
      {
        disciplineId: '__reserve__',
        weekday: c.weekday,
        startMinute: c.startMinute,
        durationMinutes: c.durationMinutes,
      },
      settings,
    ),
  );
}

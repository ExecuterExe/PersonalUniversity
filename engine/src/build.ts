import {
  computeBudget,
  initialFrequencies,
  nextReduction,
  peakWeekMinutes,
  type Budget,
} from './budget';
import { CandidateCache } from './candidates';
import {
  applyRelaxation,
  pickCompromises,
  relaxationCandidates,
  type Compromise,
  type FailureInfo,
} from './compromises';
import { TARGET_FREQUENCY } from './defaults';
import { expandSkeleton } from './expand';
import { formatFrequency, formatHours, plural, SESSION_FORMS } from './format';
import { resolveConflictsAutomatically } from './moves';
import { makeRuleContext } from './rules';
import { hasReserve, placementOrder, placeSkeleton, type PlaceResult } from './skeleton';
import type {
  BusyEvent,
  Discipline,
  Frequency,
  Instant,
  PlanState,
  SemesterSpec,
  Settings,
  SkeletonSlot,
} from './types';

export interface PlanInput {
  semester: SemesterSpec;
  settings: Settings;
  disciplines: Discipline[];
  busy: BusyEvent[];
  now: Instant;
  /** Частоты, согласованные пользователем через компромисс. */
  frequencyOverrides?: Record<string, Frequency>;
}

export interface PlanFailure extends FailureInfo {
  message: string;
}

export interface PlanWarning {
  code: 'reduced' | 'tight' | 'unresolved';
  message: string;
}

/** Занятие черновика, которое не удалось перенести автоматически. */
export interface DraftConflict {
  sessionId: string;
  events: BusyEvent[];
}

export type BuildResult =
  | {
      ok: true;
      state: PlanState;
      budget: Budget;
      /** Сколько занятий черновика перенесено с каркаса из-за событий. */
      moved: number;
      conflicts: DraftConflict[];
      warnings: PlanWarning[];
    }
  | { ok: false; failure: PlanFailure; compromises: Compromise[] };

export interface BuildOptions {
  /** Искать компромиссы при неудаче (по умолчанию да). */
  compromises?: boolean;
  /** Разворачивать каркас в занятия (по умолчанию да). */
  expand?: boolean;
}

/** Строит черновик семестра по методологии (раздел 6). */
export function buildPlan(input: PlanInput, options: BuildOptions = {}): BuildResult {
  const { settings, disciplines, now } = input;
  const ctx = makeRuleContext(input.semester, settings, disciplines, input.busy);
  const cache = new CandidateCache(ctx, { now, fromWeek: 0, toWeek: ctx.cal.weeks });
  const overrides = input.frequencyOverrides ?? {};
  const fixed = new Set(Object.keys(overrides));
  const frequencies = initialFrequencies(disciplines, overrides);
  const name = (id: string) => disciplines.find((d) => d.id === id)?.name ?? id;

  let skeleton: SkeletonSlot[] | null = null;
  let failure: PlanFailure | null = null;
  while (!skeleton && !failure) {
    const peak = peakWeekMinutes(disciplines, frequencies);
    if (peak > settings.maxWeeklyMinutes) {
      const reduce = nextReduction(disciplines, frequencies, fixed);
      if (reduce) {
        frequencies[reduce] = 2;
        continue;
      }
      failure = {
        kind: 'budget',
        disciplineIds: [],
        neededMinutes: peak,
        message: `Даже на минимальной частоте нужно ${formatHours(peak)} в неделю, а лимит — ${formatHours(settings.maxWeeklyMinutes)}`,
      };
      break;
    }

    const attempt = placeWithRetries(disciplines, frequencies, cache, settings);
    if (attempt.unplaced.length === 0) {
      skeleton = attempt.slots;
      break;
    }
    const reduce = nextReduction(disciplines, frequencies, fixed, attempt.unplaced[0]);
    if (reduce) {
      frequencies[reduce] = 2;
      continue;
    }
    failure = {
      kind: 'placement',
      disciplineIds: attempt.unplaced,
      message: `Не помещается в твои окна и календарь: ${attempt.unplaced.map((id) => `«${name(id)}»`).join(', ')}`,
    };
  }

  if (!skeleton) {
    const f = failure!;
    return {
      ok: false,
      failure: f,
      compromises: options.compromises === false ? [] : findCompromises(input, f),
    };
  }

  const budget = computeBudget(disciplines, frequencies, settings.maxWeeklyMinutes);
  const warnings: PlanWarning[] = [];
  for (const d of disciplines) {
    const f = frequencies[d.id]!;
    if (!fixed.has(d.id) && f < TARGET_FREQUENCY[d.priority]) {
      warnings.push({
        code: 'reduced',
        message: `«${d.name}»: ${formatFrequency(f)} — чаще не помещается`,
      });
    }
  }
  if (!hasReserve(skeleton, disciplines, cache, settings)) {
    warnings.push({
      code: 'tight',
      message: 'Расписание плотное: в типичной неделе не осталось свободного места для переносов',
    });
  }
  const shortest = Math.min(...disciplines.map((d) => d.durationMinutes));
  if (disciplines.length > 0 && budget.reserveMinutes < shortest) {
    warnings.push({
      code: 'tight',
      message: `Неделя заполнена почти до лимита (${formatHours(budget.peakMinutes)} из ${formatHours(budget.capMinutes)}): отрабатывать пропуски будет некогда`,
    });
  }

  const state: PlanState = {
    semester: input.semester,
    settings,
    disciplines,
    frequencies,
    skeleton,
    sessions: [],
  };
  if (options.expand === false)
    return { ok: true, state, budget, moved: 0, conflicts: [], warnings };

  const resolved = resolveConflictsAutomatically(ctx, expandSkeleton(ctx.cal, skeleton, now), now, {
    frequencies,
  });
  state.sessions = resolved.sessions;
  const conflicts = resolved.unresolved;
  if (conflicts.length > 0) {
    warnings.push({
      code: 'unresolved',
      message: `${conflicts.length} ${plural(conflicts.length, SESSION_FORMS)} не удалось перенести автоматически — нужно твоё решение`,
    });
  }
  return { ok: true, state, budget, moved: resolved.moved, conflicts, warnings };
}

/** Если кто-то не встал — пробуем поставить его раньше остальных своей группы. */
function placeWithRetries(
  disciplines: readonly Discipline[],
  frequencies: Readonly<Record<string, Frequency>>,
  cache: CandidateCache,
  settings: Settings,
): PlaceResult {
  const front: string[] = [];
  let best: PlaceResult | null = null;
  for (let attempt = 0; attempt <= disciplines.length; attempt++) {
    const result = placeSkeleton(
      placementOrder(disciplines, frequencies, front),
      frequencies,
      cache,
      settings,
    );
    if (!best || result.unplaced.length < best.unplaced.length) best = result;
    if (result.unplaced.length === 0) break;
    const next = result.unplaced.find((id) => !front.includes(id));
    if (!next) break;
    front.push(next);
  }
  return best!;
}

/** Пробует ослабления по одному и оставляет только те, что решают проблему (раздел 9). */
export function findCompromises(input: PlanInput, failure: FailureInfo): Compromise[] {
  return pickCompromises(
    relaxationCandidates(input, failure),
    (relaxation) => {
      const attempt = buildPlan(applyRelaxation(input, relaxation), {
        compromises: false,
        expand: false,
      });
      return attempt.ok ? attempt.budget.peakMinutes : null;
    },
    input.disciplines,
  );
}

import type { DraftConflict } from './build';
import { computeBudget, nextReduction, peakWeekMinutes, type Budget } from './budget';
import { CandidateCache } from './candidates';
import {
  applyRelaxation,
  pickCompromises,
  relaxationCandidates,
  type Compromise,
  type RelaxableInput,
} from './compromises';
import { TARGET_FREQUENCY } from './defaults';
import { expandSkeleton } from './expand';
import { formatHours } from './format';
import { resolveConflictsAutomatically } from './moves';
import { rhythmPenalty } from './rhythm';
import { makeRuleContext } from './rules';
import { isActiveAt, placeSkeleton, slotId } from './skeleton';
import { localInfo } from './time';
import type { BusyEvent, Discipline, Frequency, Instant, PlanState, SkeletonSlot } from './types';

export interface FrequencyChange {
  disciplineId: string;
  from?: Frequency;
  to?: Frequency;
}

/** «Было → станет» для изменения посреди семестра (методология, раздел 4). */
export interface ChangeResult {
  ok: boolean;
  before: Budget;
  after?: Budget;
  state?: PlanState;
  frequencyChanges: FrequencyChange[];
  addedSessions: number;
  removedSessions: number;
  conflicts: DraftConflict[];
  failure?: string;
  compromises: Compromise[];
}

function currentWeek(state: PlanState, now: Instant): number {
  const ctx = makeRuleContext(state.semester, state.settings, state.disciplines, []);
  return Math.min(Math.max(localInfo(ctx.cal, now).weekIndex, 0), state.semester.weeks);
}

function diffFrequencies(
  before: Readonly<Record<string, Frequency>>,
  after: Readonly<Record<string, Frequency>>,
): FrequencyChange[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...ids]
    .filter((id) => before[id] !== after[id])
    .map((id) => ({
      disciplineId: id,
      ...(before[id] === undefined ? {} : { from: before[id] }),
      ...(after[id] === undefined ? {} : { to: after[id] }),
    }));
}

/**
 * Добавляет дисциплину посреди семестра. Существующие слоты не двигаются; если места
 * не хватает — сначала понижается новая основная, потом другие основные с 3 до 2.
 * Меняются только будущие занятия.
 */
export function addDiscipline(
  state: PlanState,
  discipline: Discipline,
  busy: readonly BusyEvent[],
  now: Instant,
  options: { frequency?: Frequency; compromises?: boolean } = {},
): ChangeResult {
  const { settings } = state;
  const disciplines = [...state.disciplines.filter((d) => d.id !== discipline.id), discipline];
  const ctx = makeRuleContext(state.semester, settings, disciplines, busy);
  const fromWeek = currentWeek(state, now);
  const before = computeBudget(state.disciplines, state.frequencies, settings.maxWeeklyMinutes);
  const frequencies: Record<string, Frequency> = {
    ...state.frequencies,
    [discipline.id]: options.frequency ?? (TARGET_FREQUENCY[discipline.priority] as Frequency),
  };
  const fixed = new Set(options.frequency === undefined ? [] : [discipline.id]);
  const removedSlots = new Set<string>();
  const cache = new CandidateCache(ctx, { now, fromWeek, toWeek: ctx.cal.weeks });
  const active = () =>
    state.skeleton.filter((s) => isActiveAt(s, fromWeek) && !removedSlots.has(s.id));

  const reduce = (): boolean => {
    const target = nextReduction(disciplines, frequencies, fixed, discipline.id);
    if (!target) return false;
    frequencies[target] = 2;
    if (target !== discipline.id) removedSlots.add(slotToDrop(active(), target));
    return true;
  };

  let placed: SkeletonSlot[] | null = null;
  let failure: { kind: 'budget' | 'placement'; message: string; neededMinutes?: number } | null =
    null;
  while (!placed && !failure) {
    const peak = peakWeekMinutes(disciplines, frequencies);
    if (peak > settings.maxWeeklyMinutes) {
      if (reduce()) continue;
      failure = {
        kind: 'budget',
        neededMinutes: peak,
        message: `С «${discipline.name}» нужно ${formatHours(peak)} в неделю, а лимит — ${formatHours(settings.maxWeeklyMinutes)}`,
      };
      break;
    }
    const result = placeSkeleton([discipline], frequencies, cache, settings, active(), fromWeek);
    if (result.unplaced.length === 0) {
      placed = result.slots.filter((s) => s.disciplineId === discipline.id);
      break;
    }
    if (reduce()) continue;
    failure = {
      kind: 'placement',
      message: `«${discipline.name}» не помещается в оставшиеся окна`,
    };
  }

  if (!placed) {
    const f = failure!;
    return {
      ok: false,
      before,
      frequencyChanges: [],
      addedSessions: 0,
      removedSessions: 0,
      conflicts: [],
      failure: f.message,
      compromises:
        options.compromises === false
          ? []
          : addCompromises(state, discipline, busy, now, {
              kind: f.kind,
              disciplineIds: [discipline.id],
              ...(f.neededMinutes === undefined ? {} : { neededMinutes: f.neededMinutes }),
            }),
    };
  }

  const skeleton = state.skeleton
    .map((s) => (removedSlots.has(s.id) ? { ...s, toWeek: fromWeek } : s))
    .concat(placed);
  const kept = state.sessions.filter(
    (s) =>
      !(
        s.skeletonSlotId &&
        removedSlots.has(s.skeletonSlotId) &&
        s.status === 'planned' &&
        s.start > now
      ),
  );
  const added = expandSkeleton(ctx.cal, placed, now);
  const resolved = resolveConflictsAutomatically(ctx, [...kept, ...added], now, {
    onlyIds: new Set(added.map((s) => s.id)),
    frequencies,
  });
  return {
    ok: true,
    before,
    after: computeBudget(disciplines, frequencies, settings.maxWeeklyMinutes),
    state: { ...state, disciplines, frequencies, skeleton, sessions: resolved.sessions },
    frequencyChanges: diffFrequencies(state.frequencies, frequencies),
    addedSessions: added.length,
    removedSessions: state.sessions.length - kept.length,
    conflicts: resolved.unresolved,
    compromises: [],
  };
}

/** Какой слот убрать при понижении 3 → 2, чтобы оставшиеся дни шли ровнее. */
function slotToDrop(active: readonly SkeletonSlot[], disciplineId: string): string {
  const own = active.filter((s) => s.disciplineId === disciplineId);
  let best = own[0]!;
  let bestPenalty = Infinity;
  for (const candidate of own) {
    const rest = own.filter((s) => s !== candidate).map((s) => s.weekday);
    const penalty = rhythmPenalty(rest, 2);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = candidate;
    }
  }
  return best.id;
}

function addCompromises(
  state: PlanState,
  discipline: Discipline,
  busy: readonly BusyEvent[],
  now: Instant,
  failure: { kind: 'budget' | 'placement'; disciplineIds: string[]; neededMinutes?: number },
): Compromise[] {
  const input: RelaxableInput = {
    settings: state.settings,
    disciplines: [discipline],
    frequencyOverrides: {},
  };
  return pickCompromises(
    relaxationCandidates(input, failure).filter((r) => r.kind !== 'postpone'),
    (relaxation) => {
      const relaxed = applyRelaxation(input, relaxation);
      const frequency = relaxed.frequencyOverrides?.[discipline.id];
      const attempt = addDiscipline(
        { ...state, settings: relaxed.settings },
        relaxed.disciplines[0]!,
        busy,
        now,
        { compromises: false, ...(frequency === undefined ? {} : { frequency }) },
      );
      return attempt.ok ? attempt.after!.peakMinutes : null;
    },
    [discipline],
  );
}

/** Убирает дисциплину: её будущие занятия исчезают, остальные не трогаются. */
export function removeDiscipline(
  state: PlanState,
  disciplineId: string,
  now: Instant,
): ChangeResult {
  const fromWeek = currentWeek(state, now);
  const before = computeBudget(
    state.disciplines,
    state.frequencies,
    state.settings.maxWeeklyMinutes,
  );
  const frequencies = { ...state.frequencies };
  delete frequencies[disciplineId];
  const kept = state.sessions.filter(
    (s) => !(s.disciplineId === disciplineId && s.status === 'planned' && s.start > now),
  );
  const skeleton = state.skeleton.map((s) =>
    s.disciplineId === disciplineId && isActiveAt(s, fromWeek) ? { ...s, toWeek: fromWeek } : s,
  );
  return {
    ok: true,
    before,
    after: computeBudget(state.disciplines, frequencies, state.settings.maxWeeklyMinutes),
    state: { ...state, frequencies, skeleton, sessions: kept },
    frequencyChanges: diffFrequencies(state.frequencies, frequencies),
    addedSessions: 0,
    removedSessions: state.sessions.length - kept.length,
    conflicts: [],
    compromises: [],
  };
}

/**
 * Продлевает семестр (контрольная точка, раздел 11): каркас продолжается на новые недели,
 * всё остальное — как было.
 */
export function extendSemester(
  state: PlanState,
  extraWeeks: number,
  busy: readonly BusyEvent[],
  now: Instant,
): ChangeResult {
  const semester = { ...state.semester, weeks: state.semester.weeks + extraWeeks };
  const ctx = makeRuleContext(semester, state.settings, state.disciplines, busy);
  const budget = computeBudget(
    state.disciplines,
    state.frequencies,
    state.settings.maxWeeklyMinutes,
  );
  const oldWeeks = state.semester.weeks;
  const continuing = state.skeleton
    .filter((s) => s.toWeek === undefined)
    .map((s) => ({ ...s, fromWeek: Math.max(s.fromWeek, oldWeeks) }));
  const added = expandSkeleton(ctx.cal, continuing, now);
  const resolved = resolveConflictsAutomatically(ctx, [...state.sessions, ...added], now, {
    onlyIds: new Set(added.map((s) => s.id)),
    frequencies: state.frequencies,
  });
  return {
    ok: true,
    before: budget,
    after: budget,
    state: { ...state, semester, sessions: resolved.sessions },
    frequencyChanges: [],
    addedSessions: added.length,
    removedSessions: 0,
    conflicts: resolved.unresolved,
    compromises: [],
  };
}

/**
 * «Раз в 2 недели» для дисциплины, что идёт раз в неделю (контрольная точка, раздел 11).
 * Начиная со следующей недели остаются занятия через неделю; текущая неделя не меняется.
 */
export function makeBiweekly(state: PlanState, disciplineId: string, now: Instant): ChangeResult {
  const before = computeBudget(
    state.disciplines,
    state.frequencies,
    state.settings.maxWeeklyMinutes,
  );
  if (state.frequencies[disciplineId] !== 1) {
    return {
      ok: false,
      before,
      frequencyChanges: [],
      addedSessions: 0,
      removedSessions: 0,
      conflicts: [],
      failure: 'Раз в 2 недели можно сделать только дисциплину, которая идёт раз в неделю',
      compromises: [],
    };
  }
  const ctx = makeRuleContext(state.semester, state.settings, state.disciplines, []);
  const fromWeek = currentWeek(state, now) + 1;
  const parity = (fromWeek % 2) as 0 | 1;
  const old = state.skeleton.filter(
    (s) => s.disciplineId === disciplineId && isActiveAt(s, fromWeek),
  );
  const replacement = new Map(
    old.map((s) => [
      s.id,
      { ...s, id: slotId(disciplineId, s.weekday, s.startMinute, fromWeek), parity, fromWeek },
    ]),
  );
  const skeleton = state.skeleton
    .map((s) => (replacement.has(s.id) ? { ...s, toWeek: fromWeek } : s))
    .concat([...replacement.values()]);

  const sessions: PlanState['sessions'] = [];
  let removed = 0;
  for (const s of state.sessions) {
    const week = localInfo(ctx.cal, s.start).weekIndex;
    const next = s.skeletonSlotId ? replacement.get(s.skeletonSlotId) : undefined;
    if (!next || s.status !== 'planned' || week < fromWeek) {
      sessions.push(s);
    } else if (week % 2 === parity) {
      sessions.push({ ...s, skeletonSlotId: next.id });
    } else {
      removed++;
    }
  }
  const frequencies: Record<string, Frequency> = { ...state.frequencies, [disciplineId]: 0.5 };
  return {
    ok: true,
    before,
    after: computeBudget(state.disciplines, frequencies, state.settings.maxWeeklyMinutes),
    state: { ...state, frequencies, skeleton, sessions },
    frequencyChanges: diffFrequencies(state.frequencies, frequencies),
    addedSessions: 0,
    removedSessions: removed,
    conflicts: [],
    compromises: [],
  };
}

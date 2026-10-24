import { CandidateCache } from './candidates';
import { ALLOWED_DURATIONS } from './defaults';
import { expandSkeleton } from './expand';
import { formatClock, formatDuration, WEEKDAY_SHORT } from './format';
import { findMoveOptions, resolveConflictsAutomatically, type MoveOption } from './moves';
import { rhythmPenalty } from './rhythm';
import { getDiscipline, type RuleContext } from './rules';
import {
  fitsWeek,
  isActiveAt,
  localScore,
  parityOverlaps,
  SCORE,
  slotId,
  spreadPenalty,
} from './skeleton';
import { durationMinutes, localInfo, MINUTE } from './time';
import type {
  BusyEvent,
  Frequency,
  Instant,
  PlanState,
  Session,
  SkeletonSlot,
  ViolationCode,
} from './types';

/** Предложение перенести слот каркаса насовсем — когда мешает повторяющееся событие. */
export interface SkeletonChangeProposal {
  slotId: string;
  newSlot: SkeletonSlot;
  /** Будущие занятия старого слота, которые переедут. */
  affectedSessionIds: string[];
  description: string;
}

export interface Conflict {
  sessionId: string;
  events: BusyEvent[];
  /** До трёх вариантов от «дешёвого» к «дорогому»; плюс всегда можно «пропустить» и «оставить». */
  options: MoveOption[];
  /** Если переносить некуда — что можно ослабить для этого одного занятия. */
  compromises: ConflictCompromise[];
  skeletonChange?: SkeletonChangeProposal;
}

/** Ослабление правил для одного занятия, у которого не нашлось обычного переноса. */
export interface ConflictCompromise {
  title: string;
  option: MoveOption;
  /** Для «провести короче»: длительность этого одного занятия. */
  durationMinutes?: number;
  /** Нарушения, на которые ты соглашаешься для этого одного занятия. */
  acceptedViolations: ViolationCode[];
}

/** Сколько будущих повторений должно мешать слоту, чтобы предложить перенос насовсем. */
const RECURRING_THRESHOLD = 2;

/**
 * Будущие занятия, на которые легли события календаря.
 * Сервис ничего не переносит сам — только предлагает варианты (методология, раздел 7).
 */
export function detectConflicts(ctx: RuleContext, state: PlanState, now: Instant): Conflict[] {
  const proposals = new Map<string, SkeletonChangeProposal | null>();
  const conflicts: Conflict[] = [];

  for (const s of state.sessions) {
    if (s.status !== 'planned' || s.start <= now) continue;
    if (s.acceptedViolations?.includes('busy')) continue;
    const events = ctx.busy.overlapping(s.start, s.end);
    if (events.length === 0) continue;

    const frequency = state.frequencies[s.disciplineId];
    const options = findMoveOptions(ctx, state.sessions, s.id, now, 'conflict', {
      ...(frequency === undefined ? {} : { frequency }),
    });
    const conflict: Conflict = {
      sessionId: s.id,
      events,
      options,
      compromises:
        options.length === 0 ? conflictCompromises(ctx, state.sessions, s.id, now, frequency) : [],
    };

    const recurringId = events.find((e) => e.recurringId)?.recurringId;
    if (recurringId && s.skeletonSlotId) {
      const slotKey = `${s.skeletonSlotId}|${recurringId}`;
      if (!proposals.has(slotKey)) {
        const hits = state.sessions.filter(
          (o) =>
            o.skeletonSlotId === s.skeletonSlotId &&
            o.status === 'planned' &&
            o.start > now &&
            ctx.busy.overlapping(o.start, o.end).some((e) => e.recurringId === recurringId),
        );
        proposals.set(
          slotKey,
          hits.length >= RECURRING_THRESHOLD
            ? proposeSkeletonMove(
                ctx,
                state,
                s.skeletonSlotId,
                localInfo(ctx.cal, s.start).weekIndex,
                now,
              )
            : null,
        );
      }
      const proposal = proposals.get(slotKey);
      if (proposal) conflict.skeletonChange = proposal;
    }
    conflicts.push(conflict);
  }
  return conflicts;
}

/**
 * Когда перенести некуда — варианты для этого одного занятия: короче, вне окон,
 * сверх дневного или недельного лимита (методология, разделы 7 и 9).
 */
export function conflictCompromises(
  ctx: RuleContext,
  sessions: readonly Session[],
  sessionId: string,
  now: Instant,
  frequency?: Frequency,
): ConflictCompromise[] {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Неизвестное занятие: ${sessionId}`);
  const discipline = getDiscipline(ctx, session.disciplineId);
  const duration = durationMinutes(session);
  const search = { limit: 1, ...(frequency === undefined ? {} : { frequency }) };
  const result: ConflictCompromise[] = [];

  for (const minutes of [...ALLOWED_DURATIONS].reverse()) {
    if (minutes >= duration) continue;
    const shorter = { ...session, end: session.start + minutes * MINUTE, customDuration: true };
    const [option] = findMoveOptions(
      ctx,
      sessions.map((s) => (s.id === session.id ? shorter : s)),
      session.id,
      now,
      'conflict',
      { ...search, allowCurrentStart: true },
    );
    if (option) {
      result.push({
        title: `Провести это занятие короче, ${formatDuration(minutes)}: ${option.label}`,
        option,
        durationMinutes: minutes,
        acceptedViolations: [],
      });
      break;
    }
  }

  for (const window of ctx.settings.otherWindows) {
    const widened = { ...discipline, extraWindows: [...(discipline.extraWindows ?? []), window] };
    const relaxed: RuleContext = {
      ...ctx,
      disciplines: new Map(ctx.disciplines).set(discipline.id, widened),
    };
    const [option] = findMoveOptions(relaxed, sessions, session.id, now, 'conflict', search);
    if (option) {
      result.push({
        title: `Один раз выйти за окна для учёбы: ${option.label}`,
        option,
        acceptedViolations: ['outside-window'],
      });
      break;
    }
  }

  const overDay: RuleContext = {
    ...ctx,
    settings: {
      ...ctx.settings,
      maxDailyMinutes: ctx.settings.maxDailyMinutes + duration,
      maxSessionsPerDay: ctx.settings.maxSessionsPerDay + 1,
    },
  };
  const [dayOption] = findMoveOptions(overDay, sessions, session.id, now, 'conflict', search);
  if (dayOption) {
    result.push({
      title: `Один раз превысить дневной лимит: ${dayOption.label}`,
      option: dayOption,
      acceptedViolations: ['daily-cap', 'sessions-per-day'],
    });
  }

  const overWeek: RuleContext = {
    ...ctx,
    settings: { ...ctx.settings, maxWeeklyMinutes: ctx.settings.maxWeeklyMinutes + duration },
  };
  const [weekOption] = findMoveOptions(overWeek, sessions, session.id, now, 'conflict', search);
  if (weekOption) {
    result.push({
      title: `Один раз превысить недельный лимит: ${weekOption.label}`,
      option: weekOption,
      acceptedViolations: ['weekly-cap'],
    });
  }
  return result;
}

/** Применяет выбранный компромисс к одному занятию. */
export function applyConflictCompromise(
  sessions: readonly Session[],
  sessionId: string,
  compromise: ConflictCompromise,
  reason: string,
): Session[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const accepted = [
      ...new Set([...(s.acceptedViolations ?? []), ...compromise.acceptedViolations]),
    ];
    return {
      ...s,
      start: compromise.option.start,
      end: compromise.option.end,
      origin: s.origin === 'skeleton' ? 'moved' : s.origin,
      originalStart: s.originalStart ?? s.start,
      moveReason: reason,
      ...(compromise.durationMinutes === undefined ? {} : { customDuration: true }),
      ...(accepted.length > 0 ? { acceptedViolations: accepted } : {}),
    };
  });
}

/** Лучшее новое постоянное место для слота начиная с недели fromWeek. */
export function proposeSkeletonMove(
  ctx: RuleContext,
  state: PlanState,
  id: string,
  fromWeek: number,
  now: Instant,
): SkeletonChangeProposal | null {
  const slot = state.skeleton.find((s) => s.id === id);
  if (!slot) return null;
  const discipline = getDiscipline(ctx, slot.disciplineId);
  const toWeek = slot.toWeek ?? ctx.cal.weeks;
  const active = state.skeleton.filter((s) => s.id !== id && isActiveAt(s, fromWeek));
  const sameDiscipline = active.filter((s) => s.disciplineId === slot.disciplineId);
  const frequency = state.frequencies[slot.disciplineId] ?? 1;
  const cache = new CandidateCache(ctx, { now, fromWeek, toWeek });

  let best: { score: number; weekday: SkeletonSlot['weekday']; startMinute: number } | null = null;
  for (const c of cache.candidates(discipline, slot.parity)) {
    if (c.weekday === slot.weekday && c.startMinute === slot.startMinute) continue;
    const shape = {
      disciplineId: slot.disciplineId,
      weekday: c.weekday,
      startMinute: c.startMinute,
      durationMinutes: c.durationMinutes,
      ...(slot.parity === undefined ? {} : { parity: slot.parity }),
    };
    if (!fitsWeek(active, shape, ctx.settings)) continue;
    const dayHasOther = active.some(
      (s) => s.weekday === c.weekday && parityOverlaps(s.parity, slot.parity),
    );
    const score =
      localScore(c.robustness, c.startMinute, dayHasOther) -
      spreadPenalty([...sameDiscipline.map((s) => s.startMinute), c.startMinute]) -
      SCORE.rhythm *
        rhythmPenalty([...sameDiscipline.map((s) => s.weekday), c.weekday], frequency) -
      (3 * Math.abs(c.startMinute - slot.startMinute)) / 60;
    if (!best || score > best.score)
      best = { score, weekday: c.weekday, startMinute: c.startMinute };
  }
  if (!best) return null;

  const newSlot: SkeletonSlot = {
    ...slot,
    id: slotId(slot.disciplineId, best.weekday, best.startMinute, fromWeek),
    weekday: best.weekday,
    startMinute: best.startMinute,
    fromWeek,
  };
  const affectedSessionIds = state.sessions
    .filter(
      (s) =>
        s.skeletonSlotId === id &&
        s.origin === 'skeleton' &&
        s.status === 'planned' &&
        s.start > now &&
        localInfo(ctx.cal, s.start).weekIndex >= fromWeek,
    )
    .map((s) => s.id);
  return {
    slotId: id,
    newSlot,
    affectedSessionIds,
    description: `Перенести «${discipline.name}» насовсем: ${WEEKDAY_SHORT[slot.weekday]} ${formatClock(slot.startMinute)} → ${WEEKDAY_SHORT[best.weekday]} ${formatClock(best.startMinute)}`,
  };
}

/** Применяет перенос слота каркаса: старые будущие занятия уходят, новые встают с минимальным вмешательством. */
export function applySkeletonChange(
  ctx: RuleContext,
  state: PlanState,
  proposal: SkeletonChangeProposal,
  now: Instant,
): { state: PlanState; conflicts: { sessionId: string; events: BusyEvent[] }[] } {
  const affected = new Set(proposal.affectedSessionIds);
  const skeleton = state.skeleton
    .map((s) => (s.id === proposal.slotId ? { ...s, toWeek: proposal.newSlot.fromWeek } : s))
    .concat(proposal.newSlot);
  const added = expandSkeleton(ctx.cal, [proposal.newSlot], now);
  const resolved = resolveConflictsAutomatically(
    ctx,
    [...state.sessions.filter((s) => !affected.has(s.id)), ...added],
    now,
    { onlyIds: new Set(added.map((s) => s.id)), frequencies: state.frequencies },
  );
  return {
    state: { ...state, skeleton, sessions: resolved.sessions },
    conflicts: resolved.unresolved,
  };
}

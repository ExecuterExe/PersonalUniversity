import {
  addMakeup,
  applyConflictCompromise,
  applyMove,
  applySkeletonChange,
  calibrationSuggestions,
  changeDuration,
  checkPlacement,
  checkpointDue,
  describeEvents,
  detectConflicts,
  detectMissed,
  disciplineStats,
  extendSemester,
  findMoveOptions,
  forecast,
  loadPreview,
  makeBiweekly,
  missFacts,
  type CalibrationSuggestion,
  type CheckpointKind,
  type Conflict,
  type DisciplineStats,
  type Forecast,
  type MoveOption,
  type PlanState,
  type Session,
  type WeekLoadChange,
} from '@ou/engine';
import { z } from 'zod';
import type { DecisionKind, DecisionRecord, SemesterRecord } from '../db/store';
import { conflict, notFound } from '../errors';
import {
  appSettings,
  localDate,
  planContext,
  requireActive,
  saveState,
  type Deps,
  type PlanContext,
} from './context';
import { sessionView, type SessionView } from './sessions';

/**
 * Проверки «при открытии и каждые 15 минут» (раздел 7): пропуски, конфликты,
 * контрольные точки, калибровка. Каждая находка — вопрос в очереди «Решения».
 * В Google проверки не ходят: конфликты ищутся по занятости, известной с последней синхронизации.
 */
export async function runChecks(deps: Deps): Promise<void> {
  const { store } = deps;
  const sem = store.findSemester('active');
  if (!sem) return;
  const now = deps.now();
  const running = store.getTimer()?.state.sessionId;

  // Пропуски: занятие не начато до конца своего времени.
  const missedIds = detectMissed(store.loadSessions(sem.id), now).filter((id) => id !== running);
  store.transaction(() => {
    for (const id of missedIds) {
      const s = store.getSession(sem.id, id)!;
      store.saveSession(sem.id, { ...s, status: 'missed' });
      store.ensureDecision(
        deps.newId(),
        `missed:${sem.id}:${id}`,
        'missed',
        { sessionId: id },
        now,
      );
    }
  });

  const plan = await planContext(deps, sem, { cachedBusy: true });
  const conflicts = detectConflicts(plan.ctx, plan.state, now).filter(
    (c) => c.sessionId !== running,
  );
  const conflicting = new Set(conflicts.map((c) => c.sessionId));
  store.transaction(() => {
    for (const c of conflicts) {
      // В ключе и место занятия, и события: если что-то из них поменяется — это новый вопрос.
      const start = plan.state.sessions.find((s) => s.id === c.sessionId)?.start;
      const events = c.events.map((e) => `${e.start}-${e.end}`).join(',');
      store.ensureDecision(
        deps.newId(),
        `conflict:${sem.id}:${c.sessionId}:${start}:${events}`,
        'conflict',
        { sessionId: c.sessionId },
        now,
      );
    }
    // Событие убрали из календаря — вопрос больше не нужен.
    // Правка в Google про занятие, которое уже прошло или не в плане, — тоже.
    const editable = new Set(
      plan.state.sessions.filter((s) => s.status === 'planned' && s.start > now).map((s) => s.id),
    );
    for (const d of store.listDecisions('open')) {
      const sessionId = d.payload.sessionId as string;
      if (
        (d.kind === 'conflict' && !conflicting.has(sessionId)) ||
        (d.kind === 'calendar-edit' && !editable.has(sessionId))
      ) {
        store.resolveDecision(d.id, { action: 'gone' }, now);
      }
    }

    const due = checkpointDue(plan.state, now, sem.checkpoints);
    if (due) {
      const tz = plan.state.settings.timezone;
      const key =
        due === 'early'
          ? `checkpoint:${sem.id}:early:${localDate(now, tz)}`
          : `checkpoint:${sem.id}:${due}`;
      store.ensureDecision(deps.newId(), key, 'checkpoint', { kind: due }, now);
    }

    for (const s of calibrationSuggestions(plan.state)) {
      store.ensureDecision(
        deps.newId(),
        `calibration:${sem.id}:${s.disciplineId}:${s.suggestedMinutes}`,
        'calibration',
        { ...s },
        now,
      );
    }
  });
}

export interface CheckpointReview {
  kind: CheckpointKind;
  disciplines: (DisciplineStats & {
    name: string;
    goal: string;
    metrics: string;
    forecast: number | null;
  })[];
  forecast: Forecast;
  facts: string[];
  calibration: CalibrationSuggestion[];
}

export interface DecisionView {
  id: string;
  kind: DecisionKind;
  createdAt: number;
  title: string;
  session?: SessionView;
  events?: { title: string; start: number; end: number }[];
  /** Варианты переноса или отработки — от «дешёвого» к «дорогому». */
  options?: MoveOption[];
  /** Если переносить некуда — что можно ослабить для этого одного занятия. */
  compromises?: { index: number; title: string; option: MoveOption }[];
  skeletonChange?: { description: string };
  calibration?: CalibrationSuggestion & { name: string };
  checkpoint?: CheckpointReview;
  /** Что можно ответить. */
  actions: string[];
}

function review(deps: Deps, plan: PlanContext, kind: CheckpointKind): CheckpointReview {
  const now = deps.now();
  const prediction = forecast(plan.state, now);
  return {
    kind,
    disciplines: disciplineStats(plan.state).map((s) => {
      const d = deps.store.getDiscipline(s.disciplineId);
      return {
        ...s,
        name: d?.name ?? s.disciplineId,
        goal: d?.goal ?? '',
        metrics: d?.metrics ?? '',
        forecast: prediction.perDiscipline[s.disciplineId] ?? null,
      };
    }),
    forecast: prediction,
    facts: missFacts(plan.state, now),
    calibration: calibrationSuggestions(plan.state),
  };
}

const CHECKPOINT_TITLE: Record<CheckpointKind, string> = {
  mid: 'Середина семестра: как идёт план',
  early: 'За две недели проведено меньше половины занятий — посмотрим на план?',
  end: 'Семестр закончился: итоги',
};

function frequencyOf(state: PlanState, s: Session) {
  const f = state.frequencies[s.disciplineId];
  return f === undefined ? {} : { frequency: f };
}

function present(
  deps: Deps,
  plan: PlanContext,
  d: DecisionRecord,
  conflicts: Map<string, Conflict>,
): DecisionView {
  const { sem, state, ctx } = plan;
  const now = deps.now();
  const base = { id: d.id, kind: d.kind, createdAt: d.createdAt };
  const sessionOf = (id: string) => state.sessions.find((s) => s.id === id);

  if (d.kind === 'missed') {
    const s = sessionOf(d.payload.sessionId as string)!;
    return {
      ...base,
      title: `Пропущено: «${deps.store.getDiscipline(s.disciplineId)?.name}»`,
      session: sessionView(deps, sem, s),
      options: findMoveOptions(ctx, state.sessions, s.id, now, 'makeup', frequencyOf(state, s)),
      actions: ['makeup', 'leave'],
    };
  }

  if (d.kind === 'conflict') {
    const s = sessionOf(d.payload.sessionId as string)!;
    const c = conflicts.get(s.id);
    return {
      ...base,
      title: `Занятие «${deps.store.getDiscipline(s.disciplineId)?.name}» пересекается с ${describeEvents(c?.events ?? [])}`,
      session: sessionView(deps, sem, s),
      events: (c?.events ?? []).map((e) => ({
        title: e.title ?? 'занято',
        start: e.start,
        end: e.end,
      })),
      options: c?.options ?? [],
      compromises: (c?.compromises ?? []).map((x, index) => ({
        index,
        title: x.title,
        option: x.option,
      })),
      ...(c?.skeletonChange
        ? { skeletonChange: { description: c.skeletonChange.description } }
        : {}),
      actions: ['move', 'compromise', 'skip', 'keep', ...(c?.skeletonChange ? ['skeleton'] : [])],
    };
  }

  if (d.kind === 'calibration') {
    const s = d.payload as unknown as CalibrationSuggestion;
    const name = deps.store.getDiscipline(s.disciplineId)?.name ?? s.disciplineId;
    return {
      ...base,
      title: `«${name}»: последние ${s.sample} занятий длились в среднем ${Math.round(s.medianActualMinutes)} из ${s.currentMinutes} мин. Сделать ${s.suggestedMinutes}?`,
      calibration: { ...s, name },
      actions: ['accept', 'dismiss'],
    };
  }

  if (d.kind === 'calendar-edit') {
    const s = sessionOf(d.payload.sessionId as string)!;
    const name = deps.store.getDiscipline(s.disciplineId)?.name ?? s.disciplineId;
    if (d.payload.type === 'deleted') {
      return {
        ...base,
        title: `«${name}» удалено из Google Календаря. Пропустить это занятие или вернуть его?`,
        session: sessionView(deps, sem, s),
        actions: ['skip', 'restore'],
      };
    }
    return {
      ...base,
      title: `«${name}» перенесено в Google Календаре, но так нарушаются правила: ${(d.payload.violations as string[]).join('; ')}`,
      session: sessionView(deps, sem, s),
      actions: ['keep', 'revert'],
    };
  }

  const kind = d.payload.kind as CheckpointKind;
  return {
    ...base,
    title: CHECKPOINT_TITLE[kind],
    checkpoint: review(deps, plan, kind),
    actions: kind === 'end' ? ['finish', 'extend'] : ['ack', 'extend', 'biweekly'],
  };
}

/** Открытые вопросы — варианты пересчитываются на текущий момент. */
export async function listDecisions(deps: Deps): Promise<DecisionView[]> {
  await runChecks(deps);
  const sem = deps.store.findSemester('active');
  const open = deps.store.listDecisions('open');
  if (!sem || open.length === 0) return [];
  const plan = await planContext(deps, sem);
  const conflicts = new Map(
    detectConflicts(plan.ctx, plan.state, deps.now()).map((c) => [c.sessionId, c]),
  );
  return open.map((d) => present(deps, plan, d, conflicts));
}

export const resolveInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('makeup'), start: z.number().int() }),
  z.object({ action: z.literal('leave') }),
  z.object({ action: z.literal('move'), start: z.number().int() }),
  z.object({ action: z.literal('compromise'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('keep') }),
  z.object({ action: z.literal('skeleton') }),
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('dismiss') }),
  z.object({ action: z.literal('ack') }),
  z.object({ action: z.literal('extend'), weeks: z.number().int().min(1).max(8) }),
  z.object({ action: z.literal('biweekly'), disciplineId: z.string() }),
  z.object({ action: z.literal('finish'), archive: z.array(z.string()).default([]) }),
  z.object({ action: z.literal('revert') }),
  z.object({ action: z.literal('restore') }),
]);
type Resolution = z.infer<typeof resolveInput>;

const stale = () => conflict('Этот вариант уже недоступен — обнови список');

function pickOption(options: MoveOption[], start: number): MoveOption {
  const option = options.find((o) => o.start === start);
  if (!option) throw stale();
  return option;
}

/** Ответ на вопрос сервиса. Перед применением вариант проверяется заново. */
export async function resolveDecision(
  deps: Deps,
  id: string,
  answer: Resolution,
): Promise<DecisionView[]> {
  const { store } = deps;
  const d = store.getDecision(id);
  if (!d) throw notFound('Вопрос');
  if (d.status !== 'open') throw conflict('На этот вопрос уже ответили');
  const sem = requireActive(store);
  const plan = await planContext(deps, sem);
  const { state, ctx, busy } = plan;
  const now = deps.now();
  const allowed = (actions: string[]) => {
    if (!actions.includes(answer.action)) throw conflict('Такой ответ здесь не подходит');
  };
  const saveSessions = (sessions: Session[]) => saveState(store, sem, { ...state, sessions });

  if (d.kind === 'missed') {
    allowed(['makeup', 'leave']);
    const sessionId = d.payload.sessionId as string;
    if (answer.action === 'makeup') {
      const s = state.sessions.find((x) => x.id === sessionId)!;
      const options = findMoveOptions(
        ctx,
        state.sessions,
        sessionId,
        now,
        'makeup',
        frequencyOf(state, s),
      );
      store.transaction(() => {
        saveSessions(addMakeup(state.sessions, sessionId, pickOption(options, answer.start)));
        store.resolveDecision(d.id, answer, now);
      });
    } else {
      store.resolveDecision(d.id, answer, now);
    }
  } else if (d.kind === 'conflict') {
    allowed(['move', 'compromise', 'skip', 'keep', 'skeleton']);
    const sessionId = d.payload.sessionId as string;
    const c = detectConflicts(ctx, state, now).find((x) => x.sessionId === sessionId);
    if (!c) throw conflict('Конфликта больше нет — событие, видимо, убрали из календаря');
    const reason = describeEvents(c.events);
    store.transaction(() => {
      if (answer.action === 'move') {
        saveSessions(
          applyMove(state.sessions, sessionId, pickOption(c.options, answer.start), reason),
        );
      } else if (answer.action === 'compromise') {
        const chosen = c.compromises[answer.index];
        if (!chosen) throw stale();
        saveSessions(applyConflictCompromise(state.sessions, sessionId, chosen, reason));
      } else if (answer.action === 'skip') {
        saveSessions(
          state.sessions.map((s) =>
            s.id === sessionId ? { ...s, status: 'skipped' as const } : s,
          ),
        );
      } else if (answer.action === 'keep') {
        saveSessions(
          state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  acceptedViolations: [
                    ...new Set([...(s.acceptedViolations ?? []), 'busy' as const]),
                  ],
                }
              : s,
          ),
        );
      } else if (answer.action === 'skeleton') {
        if (!c.skeletonChange) throw stale();
        const applied = applySkeletonChange(ctx, state, c.skeletonChange, now);
        saveState(store, sem, applied.state);
        // Остальные вопросы про этот слот тоже решены.
        const affected = new Set(c.skeletonChange.affectedSessionIds);
        for (const other of store.listDecisions('open')) {
          if (other.kind === 'conflict' && affected.has(other.payload.sessionId as string)) {
            store.resolveDecision(other.id, { action: 'skeleton' }, now);
          }
        }
      }
      store.resolveDecision(d.id, answer, now);
    });
  } else if (d.kind === 'calibration') {
    allowed(['accept', 'dismiss']);
    if (answer.action === 'accept') {
      const s = d.payload as unknown as CalibrationSuggestion;
      const result = changeDuration(state, s.disciplineId, s.suggestedMinutes, busy, now);
      if (!result.ok || !result.state)
        throw conflict(result.failure ?? 'Не получилось поменять длительность');
      store.transaction(() => {
        const patches = { ...sem.disciplinePatches };
        patches[s.disciplineId] = {
          ...patches[s.disciplineId],
          durationMinutes: s.suggestedMinutes,
        };
        saveState(store, { ...sem, disciplinePatches: patches }, result.state!);
        const discipline = store.getDiscipline(s.disciplineId);
        if (discipline)
          store.saveDiscipline({ ...discipline, durationMinutes: s.suggestedMinutes });
        store.resolveDecision(d.id, answer, now);
      });
    } else {
      store.resolveDecision(d.id, answer, now);
    }
  } else if (d.kind === 'calendar-edit') {
    const sessionId = d.payload.sessionId as string;
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) throw stale();
    if (d.payload.type === 'deleted') {
      allowed(['skip', 'restore']);
      store.transaction(() => {
        // «Вернуть» — событие появится снова при следующей синхронизации.
        if (answer.action === 'skip') {
          saveSessions(
            state.sessions.map((x) =>
              x.id === sessionId ? { ...x, status: 'skipped' as const } : x,
            ),
          );
        }
        store.resolveDecision(d.id, answer, now);
      });
    } else {
      allowed(['keep', 'revert']);
      store.transaction(() => {
        if (answer.action === 'revert') {
          const start = d.payload.previousStart as number;
          const end = d.payload.previousEnd as number;
          const back = { ...s, start, end };
          const others = state.sessions.filter((x) => x.id !== sessionId);
          const codes = [...new Set(checkPlacement(ctx, back, others).map((v) => v.code))];
          const reverted: Session = { ...back };
          delete reverted.acceptedViolations;
          if (codes.length > 0) reverted.acceptedViolations = codes;
          saveSessions([...others, reverted]);
        }
        store.resolveDecision(d.id, answer, now);
      });
    }
  } else {
    const kind = d.payload.kind as CheckpointKind;
    allowed(kind === 'end' ? ['finish', 'extend'] : ['ack', 'extend', 'biweekly']);
    // Любой обзор сбрасывает отсчёт раннего сигнала: два обзора подряд не нужны.
    const checkpoints = {
      ...sem.checkpoints,
      lastEarlyAt: now,
      ...(kind === 'mid' ? { midDone: true } : {}),
    };
    store.transaction(() => {
      if (answer.action === 'extend') {
        const result = extendSemester(state, answer.weeks, busy, now);
        saveState(store, { ...sem, checkpoints }, result.state!);
      } else if (answer.action === 'biweekly') {
        const result = makeBiweekly(state, answer.disciplineId, now);
        if (!result.ok || !result.state) throw conflict(result.failure ?? 'Не получилось');
        saveState(store, { ...sem, checkpoints }, result.state);
      } else if (answer.action === 'finish') {
        finishSemester(deps, sem, answer.archive);
      } else {
        store.saveSemester({ ...sem, checkpoints });
      }
      store.resolveDecision(d.id, answer, now);
    });
  }
  return listDecisions(deps);
}

/** Конец семестра: архив — по выбору; новый семестр — только явной командой. */
function finishSemester(deps: Deps, sem: SemesterRecord, archive: string[]): void {
  const { store } = deps;
  const now = deps.now();
  store.saveSemester({
    ...sem,
    status: 'finished',
    finishedAt: now,
    checkpoints: { ...sem.checkpoints, endDone: true },
  });
  for (const id of archive) {
    const d = store.getDiscipline(id);
    if (d && sem.disciplineIds.includes(id))
      store.saveDiscipline({ ...d, archivedAt: d.archivedAt ?? now });
  }
  store.clearTimer();
  for (const other of store.listDecisions('open')) {
    store.resolveDecision(other.id, { action: 'semester-finished' }, now);
  }
}

export const makeupPreviewInput = z.object({
  choices: z.array(z.object({ decisionId: z.string(), start: z.number().int() })).min(1),
});

export interface MakeupPreview {
  weeks: (WeekLoadChange & { overCap: boolean })[];
  /** Варианты, которые с учётом остальных выборов уже не подходят. */
  invalid: string[];
}

/** Итог внизу окна разбора пропусков: как вырастет нагрузка по неделям (раздел 8). */
export async function makeupPreview(
  deps: Deps,
  input: z.infer<typeof makeupPreviewInput>,
): Promise<MakeupPreview> {
  const sem = requireActive(deps.store);
  const { state, ctx } = await planContext(deps, sem);
  const now = deps.now();
  let sessions = state.sessions;
  const invalid: string[] = [];
  for (const choice of input.choices) {
    const d = deps.store.getDecision(choice.decisionId);
    if (!d || d.kind !== 'missed' || d.status !== 'open') {
      invalid.push(choice.decisionId);
      continue;
    }
    const sessionId = d.payload.sessionId as string;
    const s = sessions.find((x) => x.id === sessionId)!;
    const option = findMoveOptions(
      ctx,
      sessions,
      sessionId,
      now,
      'makeup',
      frequencyOf(state, s),
    ).find((o) => o.start === choice.start);
    if (!option) {
      invalid.push(choice.decisionId);
      continue;
    }
    sessions = addMakeup(sessions, sessionId, option);
  }
  return {
    weeks: loadPreview(ctx, state.sessions, sessions).map((w) => ({
      ...w,
      overCap: w.afterMinutes > w.capMinutes,
    })),
    invalid,
  };
}

export function openDecisionsCount(deps: Deps): number {
  return deps.store.listDecisions('open').length;
}

export function timezoneOf(deps: Deps): string {
  return appSettings(deps.store).timezone;
}

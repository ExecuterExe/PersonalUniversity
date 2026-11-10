import {
  addDiscipline,
  applyRelaxation,
  buildPlan,
  computeBudget,
  isActiveAt,
  localInfo,
  makeCalendar,
  removeDiscipline,
  type Budget,
  type ChangeResult,
  type Frequency,
  type Instant,
  type PlanFailure,
  type PlanInput,
  type PlanWarning,
  type RelaxableInput,
  type SkeletonSlot,
  type TimeWindow,
} from '@ou/engine';
import { z } from 'zod';
import type { SemesterRecord } from '../db/store';
import { badRequest, conflict, notFound } from '../errors';
import {
  appSettings,
  busyFor,
  engineDisciplines,
  engineSettingsFor,
  isoWeekday,
  localDate,
  planContext,
  requireActive,
  saveState,
  specOf,
  type Deps,
} from './context';

export const draftInput = z.object({
  startDate: z.iso.date({ error: 'Дата начала — в формате ГГГГ-ММ-ДД' }),
  /** Полных недель; если семестр начинается не с понедельника, первые дни добавятся сверху. */
  fullWeeks: z.number().int().min(1).max(52).optional(),
  disciplineIds: z.array(z.string()).min(1, 'Выбери хотя бы одну дисциплину'),
});

/** Сколько дней до первого понедельника, если семестр начинается не с него. */
export function leadDays(startDate: string): number {
  const weekday = isoWeekday(startDate);
  return weekday === 1 ? 0 : 8 - weekday;
}

/** Номер недели для людей: с первой полной недели; неполная первая — «нулевая». */
export function weekNumber(sem: SemesterRecord, instant: Instant, timezone: string): number {
  const cal = makeCalendar(specOf(sem), timezone);
  return localInfo(cal, instant).weekIndex + (leadDays(sem.startDate) ? 0 : 1);
}

export interface SemesterView {
  id: string;
  deletionPending: boolean;
  status: SemesterRecord['status'];
  startDate: string;
  /** Последний день семестра. */
  endDate: string;
  fullWeeks: number;
  leadDays: number;
  /** Текущая неделя (0 — неполная первая); null — семестр ещё не начался или уже закончился. */
  currentWeek: number | null;
  disciplines: {
    id: string;
    name: string;
    priority: 'main' | 'additional';
    durationMinutes: number;
    frequency: Frequency | null;
    extraWindows: TimeWindow[];
  }[];
  budget: Budget | null;
  warnings: PlanWarning[];
  failure: PlanFailure | null;
  compromises: { index: number; title: string; peakMinutes: number }[];
  /** Каркас, действующий сейчас (для черновика — с первой недели). */
  skeleton: SkeletonSlot[];
  /** Занятия, которые сервис сдвинул с каркаса из-за событий. */
  moved: { sessionId: string; disciplineId: string; from: Instant; to: Instant; reason: string }[];
  sessionsCount: number;
}

export function semesterView(deps: Deps, sem: SemesterRecord): SemesterView {
  const { store } = deps;
  const settings = engineSettingsFor(store, sem);
  const cal = makeCalendar(specOf(sem), settings.timezone);
  const disciplines = engineDisciplines(store, sem);
  const sessions = store.loadSessions(sem.id);
  const now = deps.now();
  const lead = leadDays(sem.startDate);
  const inRange = now >= cal.rangeStart && now < cal.rangeEnd;
  const week = inRange ? localInfo(cal, now).weekIndex : 0;
  const skeleton = store.loadSkeleton(sem.id).filter((s) => isActiveAt(s, Math.max(week, 0)));

  return {
    id: sem.id,
    deletionPending: store.getMeta(`semesterDeletion:${sem.id}`) === 'pending',
    status: sem.status,
    startDate: sem.startDate,
    endDate: localDate(cal.rangeEnd - 1, settings.timezone),
    fullWeeks: sem.weeks - (lead ? 1 : 0),
    leadDays: lead,
    currentWeek: inRange ? week + (lead ? 0 : 1) : null,
    disciplines: disciplines.map((d) => ({
      id: d.id,
      name: d.name,
      priority: d.priority,
      durationMinutes: d.durationMinutes,
      frequency: sem.frequencies[d.id] ?? null,
      extraWindows: d.extraWindows ?? [],
    })),
    budget:
      Object.keys(sem.frequencies).length > 0
        ? computeBudget(disciplines, sem.frequencies, settings.maxWeeklyMinutes)
        : (sem.buildInfo?.budget ?? null),
    warnings: sem.buildInfo?.warnings ?? [],
    failure: sem.buildInfo?.failure ?? null,
    compromises: (sem.buildInfo?.compromises ?? []).map((c, index) => ({
      index,
      title: c.title,
      peakMinutes: c.peakMinutes,
    })),
    skeleton,
    moved: sessions
      .filter((s) => s.origin === 'moved' && s.originalStart !== undefined)
      .map((s) => ({
        sessionId: s.id,
        disciplineId: s.disciplineId,
        from: s.originalStart!,
        to: s.start,
        reason: s.moveReason ?? '',
      })),
    sessionsCount: sessions.length,
  };
}

async function planInputFor(deps: Deps, sem: SemesterRecord): Promise<PlanInput> {
  return {
    semester: specOf(sem),
    settings: engineSettingsFor(deps.store, sem),
    disciplines: engineDisciplines(deps.store, sem),
    busy: await busyFor(deps, sem),
    now: deps.now(),
    frequencyOverrides: sem.frequencyOverrides,
  };
}

async function rebuildDraft(deps: Deps, sem: SemesterRecord): Promise<SemesterView> {
  const { store } = deps;
  const result = buildPlan(await planInputFor(deps, sem));
  const next: SemesterRecord = result.ok
    ? {
        ...sem,
        frequencies: result.state.frequencies,
        buildInfo: {
          ok: true,
          warnings: result.warnings,
          compromises: [],
          budget: result.budget,
          moved: result.moved,
        },
      }
    : {
        ...sem,
        frequencies: {},
        buildInfo: {
          ok: false,
          warnings: [],
          failure: result.failure,
          compromises: result.compromises,
          moved: 0,
        },
      };
  store.transaction(() => {
    store.saveSemester(next);
    if (result.ok) store.replacePlan(sem.id, result.state.skeleton, result.state.sessions);
    else store.replacePlan(sem.id, [], []);
  });
  return semesterView(deps, next);
}

/** Черновик нового семестра по методологии (раздел 6). Прежний черновик заменяется. */
export async function createDraft(
  deps: Deps,
  input: z.infer<typeof draftInput>,
): Promise<SemesterView> {
  const { store } = deps;
  if (store.findSemester('active')) {
    throw conflict('Сейчас идёт семестр — новый можно составить после его завершения');
  }
  const app = appSettings(store);
  if (input.startDate < localDate(deps.now(), app.timezone)) {
    throw badRequest('Семестр не может начаться в прошлом');
  }
  const ids = [...new Set(input.disciplineIds)];
  for (const id of ids) {
    const d = store.getDiscipline(id);
    if (!d) throw notFound('Дисциплина');
    if (d.archivedAt !== null) throw conflict(`«${d.name}» в архиве — сначала верни её`);
  }
  const fullWeeks = input.fullWeeks ?? app.defaultSemesterWeeks;
  const old = store.findSemester('draft');
  if (old) store.deleteSemester(old.id);

  return rebuildDraft(deps, {
    id: deps.newId(),
    status: 'draft',
    startDate: input.startDate,
    weeks: fullWeeks + (leadDays(input.startDate) ? 1 : 0),
    disciplineIds: ids,
    frequencies: {},
    frequencyOverrides: {},
    settingsPatch: {},
    disciplinePatches: {},
    checkpoints: { midDone: false, endDone: false },
    buildInfo: null,
    createdAt: deps.now(),
    confirmedAt: null,
    finishedAt: null,
  });
}

function requireDraft(deps: Deps): SemesterRecord {
  const sem = deps.store.findSemester('draft');
  if (!sem) throw notFound('Черновик семестра');
  return sem;
}

export function getDraft(deps: Deps): SemesterView {
  return semesterView(deps, requireDraft(deps));
}

export async function refreshDraft(deps: Deps): Promise<SemesterView> {
  return rebuildDraft(deps, requireDraft(deps));
}

/** Запоминает, на что пользователь согласился: правила семестра, дисциплины, частоты. */
function recordRelaxation(
  sem: SemesterRecord,
  before: RelaxableInput,
  after: RelaxableInput,
): SemesterRecord {
  const settingsPatch: Record<string, unknown> = { ...sem.settingsPatch };
  for (const key of [
    'excludedWeekdays',
    'maxDailyMinutes',
    'maxWeeklyMinutes',
    'bufferMinutes',
  ] as const) {
    if (JSON.stringify(after.settings[key]) !== JSON.stringify(before.settings[key])) {
      settingsPatch[key] = after.settings[key];
    }
  }
  const disciplinePatches = { ...sem.disciplinePatches };
  for (const d of after.disciplines) {
    const was = before.disciplines.find((x) => x.id === d.id);
    if (!was) continue;
    const patch = { ...disciplinePatches[d.id] };
    if (d.durationMinutes !== was.durationMinutes) patch.durationMinutes = d.durationMinutes;
    if (JSON.stringify(d.extraWindows ?? []) !== JSON.stringify(was.extraWindows ?? [])) {
      patch.extraWindows = d.extraWindows ?? [];
    }
    disciplinePatches[d.id] = patch;
  }
  const kept = new Set(after.disciplines.map((d) => d.id));
  const removed = before.disciplines.filter((d) => !kept.has(d.id)).map((d) => d.id);
  return {
    ...sem,
    settingsPatch,
    disciplinePatches,
    frequencyOverrides: { ...sem.frequencyOverrides, ...after.frequencyOverrides },
    disciplineIds: sem.disciplineIds.filter((id) => !removed.includes(id)),
  };
}

/** Пользователь выбрал один из предложенных компромиссов — черновик строится заново. */
export async function applyDraftCompromise(deps: Deps, index: number): Promise<SemesterView> {
  const sem = requireDraft(deps);
  const compromise = sem.buildInfo?.compromises[index];
  if (!compromise) throw notFound('Компромисс');
  const input = await planInputFor(deps, sem);
  return rebuildDraft(
    deps,
    recordRelaxation(sem, input, applyRelaxation(input, compromise.relaxation)),
  );
}

export function confirmDraft(deps: Deps): SemesterView {
  const { store } = deps;
  const sem = requireDraft(deps);
  if (!sem.buildInfo?.ok) {
    throw conflict('Расписание пока не помещается — выбери один из компромиссов');
  }
  if (store.findSemester('active')) throw conflict('Уже идёт другой семестр');
  const next: SemesterRecord = { ...sem, status: 'active', confirmedAt: deps.now() };
  store.saveSemester(next);
  return semesterView(deps, next);
}

export function discardDraft(deps: Deps): void {
  deps.store.deleteSemester(requireDraft(deps).id);
}

export function getActive(deps: Deps): SemesterView {
  return semesterView(deps, requireActive(deps.store));
}

// Изменения посреди семестра (методология, раздел 4)

export const changeInput = z.object({
  type: z.enum(['add', 'remove']),
  disciplineId: z.string(),
  /** Номер компромисса из предпросмотра, если без него не помещается. */
  compromiseIndex: z.number().int().min(0).optional(),
});

export interface ChangeView {
  ok: boolean;
  before: Budget;
  after: Budget | null;
  frequencyChanges: {
    disciplineId: string;
    name: string;
    from: Frequency | null;
    to: Frequency | null;
  }[];
  addedSessions: number;
  removedSessions: number;
  failure: string | null;
  compromises: { index: number; title: string; peakMinutes: number }[];
}

async function computeChange(deps: Deps, change: z.infer<typeof changeInput>) {
  const { store } = deps;
  const sem = requireActive(store);
  const { state, busy } = await planContext(deps, sem);
  const now = deps.now();
  const d = store.getDiscipline(change.disciplineId);
  if (!d) throw notFound('Дисциплина');

  if (change.type === 'remove') {
    if (state.frequencies[d.id] === undefined) throw conflict(`«${d.name}» нет в расписании`);
    return { sem, result: removeDiscipline(state, d.id, now), record: sem };
  }

  if (d.archivedAt !== null) throw conflict(`«${d.name}» в архиве — сначала верни её`);
  if (state.frequencies[d.id] !== undefined) throw conflict(`«${d.name}» уже в расписании`);
  const discipline = {
    id: d.id,
    name: d.name,
    priority: d.priority,
    durationMinutes: d.durationMinutes,
  };
  const plain = addDiscipline(state, discipline, busy, now);
  if (change.compromiseIndex === undefined) {
    return { sem, result: plain, record: { ...sem, disciplineIds: [...sem.disciplineIds, d.id] } };
  }

  const compromise = plain.compromises[change.compromiseIndex];
  if (!compromise) throw notFound('Компромисс');
  const before: RelaxableInput = {
    settings: state.settings,
    disciplines: [discipline],
    frequencyOverrides: {},
  };
  const after = applyRelaxation(before, compromise.relaxation);
  const frequency = after.frequencyOverrides?.[d.id];
  const result = addDiscipline(
    { ...state, settings: after.settings },
    after.disciplines[0]!,
    busy,
    now,
    {
      compromises: false,
      ...(frequency === undefined ? {} : { frequency }),
    },
  );
  const record = recordRelaxation(
    { ...sem, disciplineIds: [...sem.disciplineIds, d.id] },
    before,
    after,
  );
  return { sem, result, record };
}

function changeView(deps: Deps, result: ChangeResult): ChangeView {
  const name = (id: string) => deps.store.getDiscipline(id)?.name ?? id;
  return {
    ok: result.ok,
    before: result.before,
    after: result.after ?? null,
    frequencyChanges: result.frequencyChanges.map((c) => ({
      disciplineId: c.disciplineId,
      name: name(c.disciplineId),
      from: c.from ?? null,
      to: c.to ?? null,
    })),
    addedSessions: result.addedSessions,
    removedSessions: result.removedSessions,
    failure: result.failure ?? null,
    compromises: result.compromises.map((c, index) => ({
      index,
      title: c.title,
      peakMinutes: c.peakMinutes,
    })),
  };
}

/** «Было → станет» до подтверждения. */
export async function previewChange(
  deps: Deps,
  change: z.infer<typeof changeInput>,
): Promise<ChangeView> {
  return changeView(deps, (await computeChange(deps, change)).result);
}

export async function applyChange(
  deps: Deps,
  change: z.infer<typeof changeInput>,
): Promise<{ change: ChangeView; semester: SemesterView }> {
  const { result, record } = await computeChange(deps, change);
  if (!result.ok || !result.state) {
    throw conflict(
      result.failure ?? 'Изменение не помещается в расписание',
      changeView(deps, result),
    );
  }
  const saved = saveState(deps.store, record, result.state);
  return { change: changeView(deps, result), semester: semesterView(deps, saved) };
}

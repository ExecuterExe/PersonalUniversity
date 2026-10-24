import {
  calibrationSuggestions,
  computeBudget,
  disciplineStats,
  forecast,
  streak,
  type Budget,
  type CalibrationSuggestion,
  type DisciplineStats,
  type Forecast,
  type Instant,
  type TimerView,
} from '@ou/engine';
import { appSettings, loadState, localDate, type Deps } from './context';
import { openDecisionsCount, runChecks } from './decisions';
import { semesterView, type SemesterView } from './semesters';
import { currentTimer, pendingSummary, sessionView, type SessionView } from './sessions';

export interface Stats {
  semester: SemesterView;
  budget: Budget;
  disciplines: (DisciplineStats & { name: string; forecast: number | null })[];
  streak: number;
  forecast: Forecast;
  calibration: CalibrationSuggestion[];
}

/** Статистика семестра (методология, раздел 12). */
export function stats(deps: Deps): Stats | null {
  const sem = deps.store.findSemester('active');
  if (!sem) return null;
  const state = loadState(deps.store, sem);
  const now = deps.now();
  const prediction = forecast(state, now);
  return {
    semester: semesterView(deps, sem),
    budget: computeBudget(state.disciplines, state.frequencies, state.settings.maxWeeklyMinutes),
    disciplines: disciplineStats(state).map((s) => ({
      ...s,
      name: deps.store.getDiscipline(s.disciplineId)?.name ?? s.disciplineId,
      forecast: prediction.perDiscipline[s.disciplineId] ?? null,
    })),
    streak: streak(state.sessions, now),
    forecast: prediction,
    calibration: calibrationSuggestions(state),
  };
}

export interface Today {
  now: Instant;
  date: string;
  timezone: string;
  semester: SemesterView | null;
  /** Есть черновик, который ждёт подтверждения. */
  draftPending: boolean;
  sessions: SessionView[];
  next: SessionView | null;
  timer: TimerView | null;
  /** Проведённое занятие без итога — его нужно закрыть первым. */
  pendingSummary: SessionView | null;
  openDecisions: number;
  /** «С чего продолжить» для дисциплин семестра. */
  continueHints: Record<string, string>;
}

/** Главный экран: что сейчас учить. При открытии запускаются проверки. */
export async function today(deps: Deps): Promise<Today> {
  await runChecks(deps);
  const { store } = deps;
  const now = deps.now();
  const timezone = appSettings(store).timezone;
  const date = localDate(now, timezone);
  const sem = store.findSemester('active');
  const base = {
    now,
    date,
    timezone,
    draftPending: store.findSemester('draft') !== null,
    timer: currentTimer(deps),
    openDecisions: openDecisionsCount(deps),
  };
  if (!sem) {
    return {
      ...base,
      semester: null,
      sessions: [],
      next: null,
      pendingSummary: null,
      continueHints: {},
    };
  }
  const sessions = store.loadSessions(sem.id);
  const todays = sessions.filter((s) => localDate(s.start, timezone) === date);
  const next = sessions.find((s) => s.status === 'planned' && s.end > now) ?? null;
  const pending = pendingSummary(deps, sem);
  const continueHints: Record<string, string> = {};
  for (const id of sem.disciplineIds) {
    const hint = store.getDiscipline(id)?.continueHint;
    if (hint) continueHints[id] = hint;
  }
  return {
    ...base,
    semester: semesterView(deps, sem),
    sessions: todays.map((s) => sessionView(deps, sem, s)),
    next: next ? sessionView(deps, sem, next) : null,
    pendingSummary: pending ? sessionView(deps, sem, pending) : null,
    continueHints,
  };
}

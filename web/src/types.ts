// Ответы API сервера (docs/api.md). Общие типы — из движка.
import type {
  Budget,
  CalibrationSuggestion,
  CheckpointKind,
  DisciplineStats,
  Forecast,
  Frequency,
  InconvenientTime,
  Instant,
  MoveOption,
  PlanFailure,
  PlanWarning,
  PomodoroSettings,
  Session,
  SkeletonSlot,
  TimeWindow,
  TimerView,
  Violation,
  WeekLoadChange,
  Weekday,
} from '@ou/engine';

export type {
  Budget,
  Frequency,
  Instant,
  MoveOption,
  Session,
  SkeletonSlot,
  TimeWindow,
  TimerView,
  Violation,
  Weekday,
};

export interface AppSettings {
  timezone: string;
  studyWindows: TimeWindow[];
  inconvenient: InconvenientTime[];
  excludedWeekdays: Weekday[];
  bufferMinutes: number;
  maxDailyMinutes: number;
  maxWeeklyMinutes: number;
  maxSessionsPerDay: number;
  pomodoro: PomodoroSettings;
  defaultSemesterWeeks: number;
}

export type Priority = 'main' | 'additional';

export interface Discipline {
  id: string;
  name: string;
  priority: Priority;
  durationMinutes: number;
  goal: string;
  metrics: string;
  continueHint: string;
  archivedAt: Instant | null;
  createdAt: Instant;
}

export interface Source {
  id: string;
  disciplineId: string;
  kind: 'link' | 'note';
  title: string;
  url: string | null;
  note: string;
  createdAt: Instant;
}

export interface SessionView extends Session {
  disciplineName: string;
  hasSummary: boolean;
  running: boolean;
}

export interface Summary {
  sessionId: string;
  keyConcepts: string;
  retelling: string;
  continueFrom: string;
  createdAt: Instant;
}

export interface SessionDetails {
  session: SessionView;
  goal: string;
  metrics: string;
  continueHint: string;
  sources: Source[];
  summary: Summary | null;
}

export interface Compromise {
  index: number;
  title: string;
  peakMinutes: number;
}

export interface SemesterView {
  id: string;
  status: 'draft' | 'active' | 'finished';
  startDate: string;
  endDate: string;
  fullWeeks: number;
  leadDays: number;
  currentWeek: number | null;
  disciplines: {
    id: string;
    name: string;
    priority: Priority;
    durationMinutes: number;
    frequency: Frequency | null;
    extraWindows: TimeWindow[];
  }[];
  budget: Budget | null;
  warnings: PlanWarning[];
  failure: PlanFailure | null;
  compromises: Compromise[];
  skeleton: SkeletonSlot[];
  moved: { sessionId: string; disciplineId: string; from: Instant; to: Instant; reason: string }[];
  sessionsCount: number;
}

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
  compromises: Compromise[];
}

export interface Today {
  now: Instant;
  setup: { settingsSaved: boolean; disciplines: number };
  date: string;
  timezone: string;
  semester: SemesterView | null;
  draftPending: boolean;
  sessions: SessionView[];
  next: SessionView | null;
  timer: TimerView | null;
  pendingSummary: SessionView | null;
  openDecisions: number;
  continueHints: Record<string, string>;
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
  kind: 'conflict' | 'missed' | 'calibration' | 'checkpoint' | 'calendar-edit';
  createdAt: Instant;
  title: string;
  session?: SessionView;
  events?: { title: string; start: Instant; end: Instant }[];
  options?: MoveOption[];
  compromises?: { index: number; title: string; option: MoveOption }[];
  skeletonChange?: { description: string };
  calibration?: CalibrationSuggestion & { name: string };
  checkpoint?: CheckpointReview;
  actions: string[];
}

export interface MakeupPreview {
  weeks: (WeekLoadChange & { overCap: boolean })[];
  invalid: string[];
}

export interface Stats {
  semester: SemesterView;
  budget: Budget;
  disciplines: (DisciplineStats & { name: string; forecast: number | null })[];
  streak: number;
  forecast: Forecast;
  calibration: CalibrationSuggestion[];
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  needsReauth: boolean;
  calendarCreated: boolean;
  busyCalendarIds: string[] | null;
  lastSyncAt: Instant | null;
  lastSyncError: string | null;
  busyUpdatedAt: Instant | null;
  /** Часовой пояс основного календаря Google — в нём Google показывает занятия. */
  calendarTimezone: string | null;
}

export interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
  usable: boolean;
  selected: boolean;
}

/** Ярлык на рабочем столе и автозапуск с Windows. */
export interface ShortcutsStatus {
  supported: boolean;
  desktop: boolean;
  autostart: boolean;
}

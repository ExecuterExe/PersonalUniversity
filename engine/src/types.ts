/** Момент времени: миллисекунды Unix. */
export type Instant = number;

/** День недели по ISO: 1 — понедельник … 7 — воскресенье. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Окно внутри дня в минутах от полуночи: [start, end). */
export interface TimeWindow {
  start: number;
  end: number;
}

export type Priority = 'main' | 'additional';

export interface Discipline {
  id: string;
  name: string;
  priority: Priority;
  durationMinutes: number;
  /** Окна, разрешённые только этой дисциплине — появляются через компромисс. */
  extraWindows?: TimeWindow[];
}

export interface PomodoroSettings {
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  /** Длинный перерыв после стольких циклов фокуса. */
  cyclesBeforeLongBreak: number;
}

export interface Settings {
  /** Часовой пояс IANA, например Europe/Moscow. */
  timezone: string;
  excludedWeekdays: Weekday[];
  /** Окна для учёбы, выбранные пользователем. */
  studyWindows: TimeWindow[];
  /** Окна, которые можно предложить в компромиссе. */
  otherWindows: TimeWindow[];
  bufferMinutes: number;
  maxDailyMinutes: number;
  maxWeeklyMinutes: number;
  maxSessionsPerDay: number;
  /** Нужен статистике: плановое чистое время учёбы — без перерывов. */
  pomodoro?: PomodoroSettings;
}

export interface SemesterSpec {
  /** Первый день семестра, YYYY-MM-DD в часовом поясе настроек. */
  startDate: string;
  /** Число календарных недель (Пн–Вс); первая может быть неполной. */
  weeks: number;
}

/** Занятый интервал из календаря. */
export interface BusyEvent {
  start: Instant;
  end: Instant;
  title?: string;
  /** Общий id у всех повторений одного повторяющегося события. */
  recurringId?: string;
  /** Не событие, а неудобное время: буфер вокруг не нужен. */
  noBuffer?: boolean;
}

/** Занятий в неделю; 0.5 — раз в две недели. */
export type Frequency = 0.5 | 1 | 2 | 3;

/** Постоянное место дисциплины в типичной неделе. */
export interface SkeletonSlot {
  id: string;
  disciplineId: string;
  weekday: Weekday;
  startMinute: number;
  durationMinutes: number;
  /** Для «раз в 2 недели»: 0 — чётные недели семестра, 1 — нечётные. */
  parity?: 0 | 1;
  /** Действует с недели fromWeek (включительно) до toWeek (не включительно). */
  fromWeek: number;
  toWeek?: number;
}

export type SessionStatus = 'planned' | 'held' | 'missed' | 'skipped' | 'cancelled';
export type SessionOrigin = 'skeleton' | 'moved' | 'makeup' | 'manual' | 'unplanned';

export type ViolationCode =
  | 'busy'
  | 'excluded-day'
  | 'outside-window'
  | 'outside-semester'
  | 'duration'
  | 'sessions-per-day'
  | 'same-discipline-day'
  | 'session-gap'
  | 'daily-cap'
  | 'weekly-cap';

export interface Violation {
  code: ViolationCode;
  message: string;
}

export interface Session {
  id: string;
  disciplineId: string;
  start: Instant;
  end: Instant;
  status: SessionStatus;
  origin: SessionOrigin;
  skeletonSlotId?: string;
  /** Где занятие стояло по каркасу, если его перенесли. */
  originalStart?: Instant;
  moveReason?: string;
  /** Чистое время учёбы (без перерывов и пауз), для проведённых занятий. */
  actualMinutes?: number;
  /** Сколько длилось занятие без пауз, включая перерывы Помодоро, — для калибровки. */
  elapsedMinutes?: number;
  startedAt?: Instant;
  finishedAt?: Instant;
  /** Длительность отличается от дисциплины по согласию пользователя. */
  customDuration?: boolean;
  /** Нарушения, которые пользователь подтвердил вручную. */
  acceptedViolations?: ViolationCode[];
}

/** Всё, что движок знает о семестре после построения. */
export interface PlanState {
  semester: SemesterSpec;
  settings: Settings;
  disciplines: Discipline[];
  /** Частоты активных дисциплин; дисциплины без частоты не планируются. */
  frequencies: Record<string, Frequency>;
  skeleton: SkeletonSlot[];
  sessions: Session[];
}

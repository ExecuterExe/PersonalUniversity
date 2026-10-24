import { ALLOWED_DURATIONS } from './defaults';
import { WEEKDAY_ON } from './format';
import { DAY, durationMinutes, localInfo, makeCalendar, type SemesterCalendar } from './time';
import type { Instant, PlanState, Session, Weekday } from './types';

export interface DisciplineStats {
  disciplineId: string;
  /** Плановые минуты семестра: всё, что стояло в плане, кроме отменённого. */
  plannedMinutes: number;
  /** Фактическое чистое время учёбы, включая внеплановые занятия. */
  actualMinutes: number;
  /** actual / planned; null, если плана нет. */
  progress: number | null;
  held: number;
  missed: number;
  skipped: number;
  /** held / (held + missed); null, пока нечего считать. */
  attendance: number | null;
}

const isPlannedKind = (s: Session) => s.origin !== 'unplanned' && s.status !== 'cancelled';
const actualOf = (s: Session) => s.actualMinutes ?? durationMinutes(s);

export function disciplineStats(state: PlanState): DisciplineStats[] {
  const ids = new Set([
    ...state.disciplines.map((d) => d.id),
    ...state.sessions.map((s) => s.disciplineId),
  ]);
  return [...ids].map((id) => {
    const own = state.sessions.filter((s) => s.disciplineId === id);
    const planned = own.filter(isPlannedKind);
    const plannedMinutes = planned.reduce((sum, s) => sum + durationMinutes(s), 0);
    const actualMinutes = own
      .filter((s) => s.status === 'held')
      .reduce((sum, s) => sum + actualOf(s), 0);
    const held = planned.filter((s) => s.status === 'held').length;
    const missed = planned.filter((s) => s.status === 'missed').length;
    return {
      disciplineId: id,
      plannedMinutes,
      actualMinutes,
      progress: plannedMinutes > 0 ? actualMinutes / plannedMinutes : null,
      held,
      missed,
      skipped: planned.filter((s) => s.status === 'skipped').length,
      attendance: held + missed > 0 ? held / (held + missed) : null,
    };
  });
}

/** Сколько запланированных занятий подряд проведено без пропусков (с конца). */
export function streak(sessions: readonly Session[], now: Instant): number {
  const past = sessions
    .filter(
      (s) => isPlannedKind(s) && s.end <= now && (s.status === 'held' || s.status === 'missed'),
    )
    .sort((a, b) => b.start - a.start);
  let count = 0;
  for (const s of past) {
    if (s.status === 'missed') break;
    count++;
  }
  return count;
}

export interface Forecast {
  /** Прогноз доли плана к концу семестра при текущем темпе; null — рано судить. */
  overall: number | null;
  perDiscipline: Record<string, number | null>;
}

/** Темп = сделанное / запланированное к текущему моменту; при том же темпе так закончится и семестр. */
export function forecast(state: PlanState, now: Instant): Forecast {
  const pace = (sessions: readonly Session[]) => {
    const due = sessions.filter((s) => isPlannedKind(s) && s.end <= now);
    const planned = due.reduce((sum, s) => sum + durationMinutes(s), 0);
    const actual = sessions
      .filter((s) => s.status === 'held' && s.end <= now)
      .reduce((sum, s) => sum + actualOf(s), 0);
    return planned > 0 ? actual / planned : null;
  };
  const perDiscipline: Record<string, number | null> = {};
  for (const d of state.disciplines) {
    perDiscipline[d.id] = pace(state.sessions.filter((s) => s.disciplineId === d.id));
  }
  return { overall: pace(state.sessions), perDiscipline };
}

export interface CalibrationSuggestion {
  disciplineId: string;
  currentMinutes: number;
  /** Медиана фактического времени последних занятий. */
  medianActualMinutes: number;
  suggestedMinutes: number;
  sample: number;
}

const CALIBRATION_SAMPLE = 5;
const CALIBRATION_THRESHOLD = 0.7;
const CALIBRATION_HEADROOM = 10;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Предложения сократить длительность (раздел 10): сам сервис ничего не меняет. */
export function calibrationSuggestions(state: PlanState): CalibrationSuggestion[] {
  const result: CalibrationSuggestion[] = [];
  for (const d of state.disciplines) {
    if (state.frequencies[d.id] === undefined) continue;
    const recent = state.sessions
      .filter((s) => s.disciplineId === d.id && isPlannedKind(s) && s.status === 'held')
      .sort((a, b) => b.start - a.start)
      .slice(0, CALIBRATION_SAMPLE);
    if (recent.length < CALIBRATION_SAMPLE) continue;
    const med = median(recent.map(actualOf));
    if (med >= CALIBRATION_THRESHOLD * d.durationMinutes) continue;
    const suggested = ALLOWED_DURATIONS.find((m) => m >= med + CALIBRATION_HEADROOM);
    if (suggested === undefined || suggested >= d.durationMinutes) continue;
    result.push({
      disciplineId: d.id,
      currentMinutes: d.durationMinutes,
      medianActualMinutes: med,
      suggestedMinutes: suggested,
      sample: recent.length,
    });
  }
  return result;
}

export interface CheckpointHistory {
  midDone: boolean;
  endDone: boolean;
  lastEarlyAt?: Instant;
}

export type CheckpointKind = 'mid' | 'early' | 'end';

/** Пора ли проводить контрольную точку (раздел 11). */
export function checkpointDue(
  state: PlanState,
  now: Instant,
  history: CheckpointHistory,
): CheckpointKind | null {
  const cal = makeCalendar(state.semester, state.settings.timezone);
  if (!history.endDone && now >= cal.rangeEnd) return 'end';
  const week = localInfo(cal, now).weekIndex;
  if (!history.midDone && week >= Math.floor(cal.weeks / 2)) return 'mid';

  const recent = state.sessions.filter(
    (s) =>
      isPlannedKind(s) &&
      s.end <= now &&
      s.end > now - 14 * DAY &&
      (s.status === 'held' || s.status === 'missed'),
  );
  const held = recent.filter((s) => s.status === 'held').length;
  const cooledDown = history.lastEarlyAt === undefined || now - history.lastEarlyAt >= 14 * DAY;
  if (recent.length >= 3 && held / recent.length < 0.5 && cooledDown) return 'early';
  return null;
}

const DAY_PART_ON = { morning: 'утром', afternoon: 'днём', evening: 'вечером' } as const;

function dayPart(minuteOfDay: number): keyof typeof DAY_PART_ON {
  if (minuteOfDay < 12 * 60) return 'morning';
  if (minuteOfDay < 17 * 60) return 'afternoon';
  return 'evening';
}

/** Простые факты для итогов семестра — без выводов о продуктивности. */
export function missFacts(state: PlanState, now: Instant, cal?: SemesterCalendar): string[] {
  const calendar = cal ?? makeCalendar(state.semester, state.settings.timezone);
  const buckets = new Map<
    string,
    { weekday: Weekday; part: keyof typeof DAY_PART_ON; total: number; missed: number }
  >();
  for (const s of state.sessions) {
    if (!isPlannedKind(s) || s.end > now || (s.status !== 'held' && s.status !== 'missed'))
      continue;
    const info = localInfo(calendar, s.start);
    const part = dayPart(info.minuteOfDay);
    const key = `${info.weekday}/${part}`;
    const bucket = buckets.get(key) ?? { weekday: info.weekday, part, total: 0, missed: 0 };
    bucket.total++;
    if (s.status === 'missed') bucket.missed++;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .filter((b) => b.total >= 3 && b.missed / b.total >= 0.4)
    .sort((a, b) => b.missed / b.total - a.missed / a.total || b.total - a.total)
    .slice(0, 2)
    .map(
      (b) =>
        `Чаще всего пропуски — ${WEEKDAY_ON[b.weekday]} ${DAY_PART_ON[b.part]} (${b.missed} из ${b.total})`,
    );
}

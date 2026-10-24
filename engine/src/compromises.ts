import { ALLOWED_DURATIONS } from './defaults';
import { formatDuration, formatHours, formatWindow, WEEKDAY_ON } from './format';
import type { Discipline, Frequency, Settings, TimeWindow, Weekday } from './types';

/** Одно ослабление правил, на которое пользователь может согласиться. */
export type Relaxation =
  | { kind: 'allow-window'; disciplineIds: string[]; window: TimeWindow }
  | { kind: 'allow-weekday'; weekday: Weekday }
  | { kind: 'biweekly'; disciplineId: string }
  | { kind: 'shorten'; disciplineId: string; minutes: number }
  | { kind: 'daily-cap'; minutes: number }
  | { kind: 'weekly-cap'; minutes: number }
  | { kind: 'buffer'; minutes: number }
  | { kind: 'postpone'; disciplineId: string };

export interface RelaxableInput {
  settings: Settings;
  disciplines: Discipline[];
  frequencyOverrides?: Record<string, Frequency>;
}

export interface FailureInfo {
  kind: 'budget' | 'placement';
  /** Дисциплины, которые не встали (для placement). */
  disciplineIds: string[];
  /** Сколько нужно в неделю даже на минимуме (для budget). */
  neededMinutes?: number;
}

export function applyRelaxation<T extends RelaxableInput>(input: T, r: Relaxation): T {
  const settings = { ...input.settings };
  let disciplines = input.disciplines;
  const overrides = { ...input.frequencyOverrides };
  const updateDiscipline = (id: string, patch: (d: Discipline) => Discipline) => {
    disciplines = disciplines.map((d) => (d.id === id ? patch(d) : d));
  };

  switch (r.kind) {
    case 'allow-window':
      for (const id of r.disciplineIds) {
        updateDiscipline(id, (d) => ({
          ...d,
          extraWindows: [...(d.extraWindows ?? []), r.window],
        }));
      }
      break;
    case 'allow-weekday':
      settings.excludedWeekdays = settings.excludedWeekdays.filter((w) => w !== r.weekday);
      break;
    case 'biweekly':
      overrides[r.disciplineId] = 0.5;
      break;
    case 'shorten':
      updateDiscipline(r.disciplineId, (d) => ({ ...d, durationMinutes: r.minutes }));
      break;
    case 'daily-cap':
      settings.maxDailyMinutes = r.minutes;
      break;
    case 'weekly-cap':
      settings.maxWeeklyMinutes = r.minutes;
      break;
    case 'buffer':
      settings.bufferMinutes = r.minutes;
      break;
    case 'postpone':
      disciplines = disciplines.filter((d) => d.id !== r.disciplineId);
      delete overrides[r.disciplineId];
      break;
  }
  return { ...input, settings, disciplines, frequencyOverrides: overrides };
}

export function describeRelaxation(r: Relaxation, disciplines: readonly Discipline[]): string {
  const name = (id: string) => `«${disciplines.find((d) => d.id === id)?.name ?? id}»`;
  switch (r.kind) {
    case 'allow-window': {
      const names = r.disciplineIds.map(name);
      const list =
        names.length > 1
          ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
          : names[0];
      return `Разрешить ${formatWindow(r.window)} для ${list}`;
    }
    case 'allow-weekday':
      return `Разрешить учёбу ${WEEKDAY_ON[r.weekday]}`;
    case 'biweekly':
      return `${name(r.disciplineId)} — раз в 2 недели`;
    case 'shorten':
      return `${name(r.disciplineId)} — занятия по ${formatDuration(r.minutes)}`;
    case 'daily-cap':
      return `Поднять дневной лимит до ${formatHours(r.minutes)}`;
    case 'weekly-cap':
      return `Поднять недельный лимит до ${formatHours(r.minutes)}`;
    case 'buffer':
      return `Уменьшить буфер до ${r.minutes} мин`;
    case 'postpone':
      return `Отложить ${name(r.disciplineId)} до следующего семестра`;
  }
}

/** Порядок важности: сначала то, что меньше всего меняет твои правила. */
const KIND_ORDER: Relaxation['kind'][] = [
  'allow-window',
  'allow-weekday',
  'biweekly',
  'shorten',
  'daily-cap',
  'weekly-cap',
  'buffer',
  'postpone',
];

/** Ослабления, которые имеет смысл попробовать при этой неудаче. */
export function relaxationCandidates(input: RelaxableInput, failure: FailureInfo): Relaxation[] {
  const { settings, disciplines } = input;
  const overrides = input.frequencyOverrides ?? {};
  const failed =
    failure.kind === 'placement' && failure.disciplineIds.length > 0
      ? disciplines.filter((d) => failure.disciplineIds.includes(d.id))
      : disciplines;
  const result: Relaxation[] = [];

  if (failure.kind === 'placement') {
    for (const window of settings.otherWindows) {
      const needing = failed.filter(
        (d) =>
          ![...settings.studyWindows, ...(d.extraWindows ?? [])].some(
            (w) => w.start <= window.start && window.end <= w.end,
          ),
      );
      // Сначала по одной дисциплине (меньше меняет), потом всем, кто не встал, сразу.
      for (const d of needing) result.push({ kind: 'allow-window', disciplineIds: [d.id], window });
      if (needing.length > 1) {
        result.push({ kind: 'allow-window', disciplineIds: needing.map((d) => d.id), window });
      }
    }
    for (const weekday of settings.excludedWeekdays)
      result.push({ kind: 'allow-weekday', weekday });
  }

  for (const d of disciplines) {
    if (d.priority === 'additional' && overrides[d.id] !== 0.5) {
      result.push({ kind: 'biweekly', disciplineId: d.id });
    }
  }

  // От большей длительности к меньшей: подходящая первой и будет предложена.
  for (const d of failed) {
    for (const minutes of [...ALLOWED_DURATIONS].reverse()) {
      if (minutes < d.durationMinutes)
        result.push({ kind: 'shorten', disciplineId: d.id, minutes });
    }
  }

  if (failure.kind === 'placement') {
    for (const extra of [30, 60]) {
      result.push({ kind: 'daily-cap', minutes: settings.maxDailyMinutes + extra });
    }
    if (settings.bufferMinutes > 10) result.push({ kind: 'buffer', minutes: 10 });
    else if (settings.bufferMinutes > 5) result.push({ kind: 'buffer', minutes: 5 });
  } else if (failure.neededMinutes !== undefined) {
    const needed = Math.ceil(failure.neededMinutes / 30) * 30;
    if (needed > settings.maxWeeklyMinutes) result.push({ kind: 'weekly-cap', minutes: needed });
  }

  for (const d of failed) result.push({ kind: 'postpone', disciplineId: d.id });

  return result.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function sameWindow(a: TimeWindow, b: TimeWindow): boolean {
  return a.start === b.start && a.end === b.end;
}

export interface Compromise {
  relaxation: Relaxation;
  title: string;
  /** Нагрузка самой тяжёлой недели после этого компромисса. */
  peakMinutes: number;
}

const MAX_COMPROMISES = 6;
const MAX_PER_KIND = 2;

/**
 * Пробует ослабления по одному и оставляет только работающие.
 * attempt возвращает нагрузку самой тяжёлой недели, если с этим ослаблением всё помещается, иначе null.
 */
export function pickCompromises(
  candidates: readonly Relaxation[],
  attempt: (r: Relaxation) => number | null,
  disciplines: readonly Discipline[],
): Compromise[] {
  const result: Compromise[] = [];
  const perKind = new Map<Relaxation['kind'], number>();
  const shortened = new Set<string>();
  for (const r of candidates) {
    if ((perKind.get(r.kind) ?? 0) >= MAX_PER_KIND) continue;
    if (r.kind === 'shorten' && shortened.has(r.disciplineId)) continue;
    // Групповое окно не нужно, если уже помогло окно для части этих же дисциплин.
    if (
      r.kind === 'allow-window' &&
      result.some(
        (c) =>
          c.relaxation.kind === 'allow-window' &&
          sameWindow(c.relaxation.window, r.window) &&
          c.relaxation.disciplineIds.every((id) => r.disciplineIds.includes(id)),
      )
    ) {
      continue;
    }
    const peakMinutes = attempt(r);
    if (peakMinutes === null) continue;
    if (r.kind === 'shorten') shortened.add(r.disciplineId);
    perKind.set(r.kind, (perKind.get(r.kind) ?? 0) + 1);
    result.push({ relaxation: r, title: describeRelaxation(r, disciplines), peakMinutes });
    if (result.length >= MAX_COMPROMISES) break;
  }
  return result;
}

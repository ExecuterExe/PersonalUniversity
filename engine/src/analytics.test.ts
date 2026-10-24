import { describe, expect, it } from 'vitest';
import {
  calibrationSuggestions,
  checkpointDue,
  disciplineStats,
  forecast,
  missFacts,
  streak,
} from './analytics';
import { DISCIPLINES, moment, SEMESTER_START, settings, WEEKS } from './fixtures/scenarios';
import { MINUTE } from './time';
import type { PlanState, Session, SessionStatus, Weekday } from './types';

function session(
  id: string,
  week: number,
  weekday: Weekday,
  clock: string,
  status: SessionStatus,
  extra: Partial<Session> = {},
): Session {
  const start = moment(week, weekday, clock);
  return {
    id,
    disciplineId: 'biases',
    start,
    end: start + 90 * MINUTE,
    status,
    origin: 'skeleton',
    ...extra,
  };
}

function state(sessions: Session[]): PlanState {
  return {
    semester: { startDate: SEMESTER_START, weeks: WEEKS },
    settings: settings(),
    disciplines: [DISCIPLINES.biases],
    frequencies: { biases: 2 },
    skeleton: [],
    sessions,
  };
}

describe('статистика', () => {
  it('прогресс и посещаемость; отменённое не входит в план, внеплановое — в факт', () => {
    const s = state([
      session('a', 0, 2, '19:00', 'held', { actualMinutes: 90 }),
      session('b', 0, 5, '19:00', 'held', { actualMinutes: 30 }),
      session('c', 1, 2, '19:00', 'missed'),
      session('d', 1, 5, '19:00', 'skipped'),
      session('e', 2, 2, '19:00', 'cancelled'),
      session('f', 2, 3, '19:00', 'held', { origin: 'unplanned', actualMinutes: 60 }),
      session('g', 2, 5, '19:00', 'planned'),
    ]);
    expect(disciplineStats(s)).toEqual([
      {
        disciplineId: 'biases',
        plannedMinutes: 5 * 90,
        actualMinutes: 90 + 30 + 60,
        progress: 180 / 450,
        held: 2,
        missed: 1,
        skipped: 1,
        attendance: 2 / 3,
      },
    ]);
  });

  it('серия — сколько занятий подряд с конца без пропусков', () => {
    const sessions = [
      session('a', 0, 2, '19:00', 'held'),
      session('b', 0, 5, '19:00', 'missed'),
      session('c', 1, 2, '19:00', 'held'),
      session('d', 1, 5, '19:00', 'skipped'),
      session('e', 2, 2, '19:00', 'held'),
      session('f', 2, 5, '19:00', 'planned'),
    ];
    expect(streak(sessions, moment(2, 4, '12:00'))).toBe(2);
  });

  it('прогноз — темп к текущему моменту', () => {
    const s = state([
      session('a', 0, 2, '19:00', 'held', { actualMinutes: 90 }),
      session('b', 0, 5, '19:00', 'held', { actualMinutes: 45 }),
      session('c', 1, 2, '19:00', 'missed'),
      session('d', 1, 5, '19:00', 'planned'),
    ]);
    const result = forecast(s, moment(1, 4, '12:00'));
    expect(result.overall).toBeCloseTo(135 / 270);
    expect(result.perDiscipline.biases).toBeCloseTo(135 / 270);
    expect(forecast(state([]), moment(1, 4, '12:00')).overall).toBeNull();
  });
});

describe('калибровка длительности', () => {
  const held = (actual: number[]) =>
    state(actual.map((a, i) => session(`s${i}`, i, 2, '19:00', 'held', { actualMinutes: a })));

  it('после 5 занятий по 45 из 90 предлагает 60 и показывает цифры', () => {
    expect(calibrationSuggestions(held([45, 40, 50, 45, 45]))).toEqual([
      {
        disciplineId: 'biases',
        currentMinutes: 90,
        medianActualMinutes: 45,
        suggestedMinutes: 60,
        sample: 5,
      },
    ]);
  });

  it('молчит, если занятий мало или время близко к плану', () => {
    expect(calibrationSuggestions(held([45, 45, 45, 45]))).toEqual([]);
    expect(calibrationSuggestions(held([70, 65, 80, 90, 64]))).toEqual([]);
  });
});

describe('контрольные точки', () => {
  const empty = { midDone: false, endDone: false };

  it('середина семестра — на 7-й неделе из 12, один раз', () => {
    expect(checkpointDue(state([]), moment(5, 7, '20:00'), empty)).toBeNull();
    expect(checkpointDue(state([]), moment(6, 1, '08:00'), empty)).toBe('mid');
    expect(checkpointDue(state([]), moment(6, 1, '08:00'), { ...empty, midDone: true })).toBeNull();
  });

  it('ранний сигнал: за 2 недели проведено меньше половины', () => {
    const sessions = [
      session('a', 1, 2, '19:00', 'held'),
      session('b', 1, 5, '19:00', 'missed'),
      session('c', 2, 2, '19:00', 'missed'),
      session('d', 2, 5, '19:00', 'missed'),
    ];
    const now = moment(3, 1, '08:00');
    expect(checkpointDue(state(sessions), now, empty)).toBe('early');
    expect(
      checkpointDue(state(sessions), now, { ...empty, lastEarlyAt: now - 3 * 24 * 60 * MINUTE }),
    ).toBeNull();
  });

  it('итоги — после конца семестра', () => {
    expect(
      checkpointDue(state([]), moment(WEEKS, 1, '08:00'), { midDone: true, endDone: false }),
    ).toBe('end');
  });
});

describe('факты для итогов семестра', () => {
  it('называет, когда чаще всего пропуски, без выводов о продуктивности', () => {
    const sessions = [
      session('a', 0, 2, '19:00', 'missed'),
      session('b', 1, 2, '19:00', 'missed'),
      session('c', 2, 2, '19:00', 'held'),
      session('d', 3, 2, '19:00', 'missed'),
      session('e', 0, 5, '19:00', 'held'),
      session('f', 1, 5, '19:00', 'held'),
      session('g', 2, 5, '19:00', 'held'),
    ];
    expect(missFacts(state(sessions), moment(4, 1, '08:00'))).toEqual([
      'Чаще всего пропуски — во вторник вечером (3 из 4)',
    ]);
  });
});

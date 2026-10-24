import { describe, expect, it } from 'vitest';
import {
  DISCIPLINES,
  moment,
  oneOff,
  SEMESTER_START,
  settings,
  weekly,
  WEEKS,
} from './fixtures/scenarios';
import { checkPlacement, makeRuleContext, type Placement } from './rules';
import { MINUTE } from './time';
import type { Settings, Weekday } from './types';

type Id = keyof typeof DISCIPLINES;

function setup(patch: Partial<Settings> = {}) {
  const ctx = makeRuleContext(
    { startDate: SEMESTER_START, weeks: WEEKS },
    settings({ excludedWeekdays: [7], ...patch }),
    Object.values(DISCIPLINES),
    [
      ...weekly([1, 2, 3, 4, 5], '09:00', '18:00', 'Работа'),
      oneOff('2026-11-07', '19:00', '20:00', 'Концерт'), // суббота первой недели
    ],
  );
  const place = (
    id: Id,
    weekday: Weekday,
    clock: string,
    extra: Partial<Placement> & { minutes?: number; week?: number } = {},
  ): Placement => {
    const start = moment(extra.week ?? 0, weekday, clock);
    const minutes = extra.minutes ?? DISCIPLINES[id].durationMinutes;
    return {
      id: `${id}-${weekday}-${clock}`,
      disciplineId: id,
      start,
      end: start + minutes * MINUTE,
      ...extra,
    };
  };
  const codes = (p: Placement, others: Placement[] = []) =>
    checkPlacement(ctx, p, others).map((v) => v.code);
  return { place, codes };
}

describe('жёсткие правила', () => {
  it('свободное место в окне проходит', () => {
    const { place, codes } = setup();
    expect(codes(place('biases', 1, '18:30'))).toEqual([]);
  });

  it('буфер после события: после работы до 18:00 можно начать не раньше 18:15', () => {
    const { place, codes } = setup();
    expect(codes(place('biases', 1, '18:00'))).toEqual(['busy']);
    expect(codes(place('biases', 1, '18:15'))).toEqual([]);
  });

  it('буфер до события: закончить не позже чем за 15 минут', () => {
    const { place, codes } = setup();
    expect(codes(place('thinking', 6, '17:45'))).toEqual([]);
    expect(codes(place('thinking', 6, '18:00'))).toEqual(['busy']);
  });

  it('называет событие в сообщении', () => {
    const { place } = setup();
    const p = place('thinking', 6, '18:30');
    const ctx = makeRuleContext(
      { startDate: SEMESTER_START, weeks: WEEKS },
      settings(),
      Object.values(DISCIPLINES),
      [oneOff('2026-11-07', '19:00', '20:00', 'Концерт')],
    );
    expect(checkPlacement(ctx, p, [])[0]!.message).toContain('«Концерт»');
  });

  it('неудобный день', () => {
    const { place, codes } = setup();
    expect(codes(place('biases', 7, '18:00'))).toEqual(['excluded-day']);
  });

  it('вне окна для учёбы', () => {
    const { place, codes } = setup();
    expect(codes(place('biases', 6, '16:00'))).toEqual(['outside-window']);
    expect(codes(place('biases', 6, '21:00'))).toEqual(['outside-window']);
  });

  it('длительность должна совпадать с дисциплиной, если не согласовано иное', () => {
    const { place, codes } = setup();
    expect(codes(place('biases', 6, '17:00', { minutes: 60 }))).toEqual(['duration']);
    expect(codes(place('biases', 6, '17:00', { minutes: 60, customDuration: true }))).toEqual([]);
  });

  it('не больше двух занятий в день', () => {
    const { place, codes } = setup();
    const others = [place('biases', 6, '17:00'), place('thinking', 6, '20:15')];
    expect(codes(place('rhetoric', 6, '21:15', { minutes: 45 }), others)).toContain(
      'sessions-per-day',
    );
  });

  it('одна дисциплина — не больше раза в день', () => {
    const { place, codes } = setup();
    expect(codes(place('biases', 6, '20:30'), [place('biases', 6, '17:00')])).toEqual([
      'same-discipline-day',
    ]);
  });

  it('между занятиями в один день — тот же буфер', () => {
    const { place, codes } = setup();
    const first = place('biases', 2, '18:15'); // до 19:45
    expect(codes(place('thinking', 2, '19:50'), [first])).toEqual(['session-gap']);
    expect(codes(place('thinking', 2, '20:00'), [first])).toEqual([]);
  });

  it('дневной лимит', () => {
    const { place, codes } = setup({ maxDailyMinutes: 150 });
    expect(codes(place('fallacies', 6, '20:30'), [place('biases', 6, '17:00')])).toEqual([
      'daily-cap',
    ]);
  });

  it('недельный лимит', () => {
    const { place, codes } = setup({ maxWeeklyMinutes: 200 });
    const others = [place('biases', 1, '18:30'), place('fallacies', 2, '18:30')];
    expect(codes(place('rhetoric', 3, '18:30'), others)).toEqual(['weekly-cap']);
  });

  it('пропущенные, пропущенные по выбору и отменённые места не занимают', () => {
    const { place, codes } = setup();
    for (const status of ['missed', 'skipped', 'cancelled'] as const) {
      expect(codes(place('biases', 6, '20:30'), [place('biases', 6, '17:00', { status })])).toEqual(
        [],
      );
    }
  });

  it('само занятие не мешает себе при проверке переноса', () => {
    const { place, codes } = setup();
    const p = place('biases', 6, '17:00', { week: 1 });
    expect(codes({ ...p, start: p.start + 30 * MINUTE, end: p.end + 30 * MINUTE }, [p])).toEqual(
      [],
    );
  });

  it('вне дат семестра', () => {
    const { place, codes } = setup();
    expect(codes(place('biases', 6, '17:00', { week: WEEKS }))).toContain('outside-semester');
  });
});

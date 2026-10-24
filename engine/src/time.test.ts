import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { localInfo, makeCalendar, MINUTE, slotInterval } from './time';

const zone = 'Europe/Moscow';

describe('календарь семестра', () => {
  it('недели календарные, с понедельника; первая может быть неполной', () => {
    const cal = makeCalendar({ startDate: '2026-11-04', weeks: 2 }, zone);
    expect(DateTime.fromMillis(cal.rangeStart, { zone }).toISODate()).toBe('2026-11-04');
    expect(cal.firstMonday.toISODate()).toBe('2026-11-02');
    expect(DateTime.fromMillis(cal.rangeEnd, { zone }).toISODate()).toBe('2026-11-16');
  });

  it('отказывается от некорректных данных', () => {
    expect(() => makeCalendar({ startDate: '2026-13-40', weeks: 2 }, zone)).toThrow();
    expect(() => makeCalendar({ startDate: '2026-11-02', weeks: 0 }, zone)).toThrow();
  });

  it('определяет неделю, день и время по моменту', () => {
    const cal = makeCalendar({ startDate: '2026-11-02', weeks: 12 }, zone);
    const wednesday = DateTime.fromISO('2026-11-11T18:30', { zone }).toMillis();
    expect(localInfo(cal, wednesday)).toEqual({
      weekIndex: 1,
      weekday: 3,
      minuteOfDay: 18 * 60 + 30,
      dateKey: '2026-11-11',
      dayIndex: 9,
    });
  });

  it('работает и до начала семестра', () => {
    const cal = makeCalendar({ startDate: '2026-11-02', weeks: 12 }, zone);
    const sunday = DateTime.fromISO('2026-11-01T12:00', { zone }).toMillis();
    expect(localInfo(cal, sunday)).toMatchObject({ weekIndex: -1, weekday: 7, dayIndex: -1 });
  });

  it('сохраняет время по часам при переходе на летнее время', () => {
    const berlin = 'Europe/Berlin'; // переход 29.03.2026
    const cal = makeCalendar({ startDate: '2026-03-23', weeks: 2 }, berlin);
    for (const [week, weekday] of [
      [0, 1],
      [0, 7],
      [1, 1],
    ] as const) {
      const slot = slotInterval(cal, week, weekday, 18 * 60, 90);
      expect(DateTime.fromMillis(slot.start, { zone: berlin }).toFormat('HH:mm')).toBe('18:00');
      expect(slot.end - slot.start).toBe(90 * MINUTE);
      expect(localInfo(cal, slot.start).minuteOfDay).toBe(18 * 60);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { BusyIndex } from './busy';
import { DAY_PARTS } from './defaults';
import { compromiseWindows, inconvenientBusy, subtractWindows } from './inconvenient';
import { formatClock } from './format';
import { localInfo, makeCalendar } from './time';
import type { Weekday } from './types';

const ALL: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe('неудобное время', () => {
  it('становится занятостью на каждый подходящий день', () => {
    const cal = makeCalendar({ startDate: '2026-10-26', weeks: 2 }, 'Europe/Moscow');
    const events = inconvenientBusy(cal, [
      { start: h(18, 50), end: h(22), weekdays: [1, 3], label: 'Пары' },
    ]);
    expect(events).toHaveLength(3 * 2); // Пн и Ср в двух неделях и неделе после
    const first = localInfo(cal, events[0]!.start);
    expect([first.weekday, formatClock(first.minuteOfDay)]).toEqual([1, '18:50']);
    expect(events[0]!.title).toBe('Пары');
  });

  it('буфер вокруг неудобного времени не нужен — это не событие', () => {
    const cal = makeCalendar({ startDate: '2026-10-26', weeks: 1 }, 'Europe/Moscow');
    const [early] = inconvenientBusy(cal, [
      { start: h(8), end: h(10), weekdays: [1], label: 'Рано' },
    ]);
    const busy = new BusyIndex([early!], 30);
    const ten = early!.end;
    expect(busy.isFree(ten, ten + 90 * 60_000)).toBe(true);
    const meeting = { start: early!.start, end: early!.end, title: 'Встреча' };
    expect(new BusyIndex([meeting], 30).isFree(ten, ten + 90 * 60_000)).toBe(false);
  });

  it('вычитание окон', () => {
    expect(subtractWindows({ start: h(8), end: h(12) }, [{ start: h(10), end: h(13) }])).toEqual([
      { start: h(8), end: h(10) },
    ]);
    expect(subtractWindows({ start: h(8), end: h(22) }, [{ start: h(10), end: h(13) }])).toEqual([
      { start: h(8), end: h(10) },
      { start: h(13), end: h(22) },
    ]);
  });

  it('в компромиссы не попадает: утро до 10:00 и пары вечером', () => {
    const windows = compromiseWindows(
      Object.values(DAY_PARTS),
      [{ start: h(10), end: h(13) }],
      [
        { start: h(8), end: h(10), weekdays: ALL, label: 'Рано' },
        { start: h(18, 50), end: h(22), weekdays: ALL, label: 'Пары' },
      ],
    );
    expect(windows).toEqual([
      { start: h(13), end: h(17) },
      { start: h(17), end: h(18, 50) },
    ]);
  });
});

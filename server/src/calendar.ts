import type { BusyEvent, Instant } from '@ou/engine';

/** Откуда берётся занятость. Google Календарь подключается на этапе 3. */
export interface CalendarSource {
  /** Занятость для действия пользователя: если известная устарела — спросить календарь. */
  busy(range: { start: Instant; end: Instant }): Promise<BusyEvent[]>;
  /** Только уже известная занятость, без обращения к календарю, — для фоновых проверок. */
  cached(range: { start: Instant; end: Instant }): Promise<BusyEvent[]>;
}

/** Пока Google не подключён — внешней занятости нет, есть только неудобное время из настроек. */
export const noCalendar: CalendarSource = {
  busy: async () => [],
  cached: async () => [],
};

/** Занятость из списка — для тестов и ручной проверки. */
export class StaticCalendar implements CalendarSource {
  constructor(public events: BusyEvent[] = []) {}

  async busy(range: { start: Instant; end: Instant }): Promise<BusyEvent[]> {
    return this.events.filter((e) => e.end > range.start && e.start < range.end);
  }

  cached(range: { start: Instant; end: Instant }): Promise<BusyEvent[]> {
    return this.busy(range);
  }
}

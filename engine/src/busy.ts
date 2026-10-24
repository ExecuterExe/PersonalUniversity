import { MINUTE } from './time';
import type { BusyEvent, Instant } from './types';

interface Item {
  start: Instant;
  end: Instant;
  event: BusyEvent;
}

/**
 * Занятость с учётом буфера: каждое событие расширено на буфер с обеих сторон,
 * поэтому «пересекается с занятостью» уже означает «нарушает буфер».
 */
export class BusyIndex {
  private readonly items: Item[];
  private readonly maxLength: number;

  constructor(events: readonly BusyEvent[], bufferMinutes: number) {
    const buffer = bufferMinutes * MINUTE;
    this.items = events
      .filter((e) => e.end > e.start)
      .map((event) => {
        const pad = event.noBuffer ? 0 : buffer;
        return { start: event.start - pad, end: event.end + pad, event };
      })
      .sort((a, b) => a.start - b.start);
    this.maxLength = this.items.reduce((max, i) => Math.max(max, i.end - i.start), 0);
  }

  /** События, которые вместе с буфером пересекаются с [start, end). */
  overlapping(start: Instant, end: Instant): BusyEvent[] {
    const result: BusyEvent[] = [];
    for (let i = this.lowerBound(start - this.maxLength); i < this.items.length; i++) {
      const item = this.items[i]!;
      if (item.start >= end) break;
      if (item.end > start) result.push(item.event);
    }
    return result;
  }

  isFree(start: Instant, end: Instant): boolean {
    return this.overlapping(start, end).length === 0;
  }

  /** Первый индекс с item.start >= value. */
  private lowerBound(value: Instant): number {
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid]!.start < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

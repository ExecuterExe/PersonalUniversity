import { slotInterval, type SemesterCalendar } from './time';
import type { Instant, Session, SkeletonSlot } from './types';

/** Превращает каркас в конкретные занятия по неделям; прошлое не создаётся. */
export function expandSkeleton(
  cal: SemesterCalendar,
  slots: readonly SkeletonSlot[],
  now: Instant,
): Session[] {
  const earliest = Math.max(now, cal.rangeStart);
  const sessions: Session[] = [];
  for (const slot of slots) {
    for (let w = slot.fromWeek; w < (slot.toWeek ?? cal.weeks) && w < cal.weeks; w++) {
      if (slot.parity !== undefined && w % 2 !== slot.parity) continue;
      const { start, end } = slotInterval(
        cal,
        w,
        slot.weekday,
        slot.startMinute,
        slot.durationMinutes,
      );
      if (start <= earliest || end > cal.rangeEnd) continue;
      sessions.push({
        id: `${slot.id}.w${w}`,
        disciplineId: slot.disciplineId,
        start,
        end,
        status: 'planned',
        origin: 'skeleton',
        skeletonSlotId: slot.id,
      });
    }
  }
  return sessions.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

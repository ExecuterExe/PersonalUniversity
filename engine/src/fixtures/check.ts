// Проверки для тестов: все занятия плана должны проходить жёсткие правила.
import {
  checkPlacement,
  makeRuleContext,
  occupiesTime,
  unaccepted,
  type RuleContext,
} from '../rules';
import type { BusyEvent, PlanState, Session } from '../types';

export function contextFor(state: PlanState, busy: readonly BusyEvent[]): RuleContext {
  return makeRuleContext(state.semester, state.settings, state.disciplines, busy);
}

/** Все нарушения правил в плане, кроме занятий из except (например, конфликтов черновика). */
export function planViolations(
  ctx: RuleContext,
  sessions: readonly Session[],
  except: ReadonlySet<string> = new Set(),
): string[] {
  return sessions
    .filter((s) => occupiesTime(s) && !except.has(s.id))
    .flatMap((s) =>
      unaccepted(checkPlacement(ctx, s, sessions), s.acceptedViolations).map(
        (v) => `${s.id}: ${v.message}`,
      ),
    );
}

import type { ReactNode } from 'react';
import {
  formatClock,
  formatDuration,
  formatFrequency,
  formatHours,
  formatPercent,
  inputToMinutes,
  minutesToInput,
  WEEKDAY_SHORT,
  WEEKDAYS,
} from './format';
import type { Budget, SemesterView, SkeletonSlot, TimeWindow, Weekday } from './types';

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <p className="error">{error}</p> : null;
}

export function Loading({ error, children }: { error: string | null; children?: ReactNode }) {
  if (error) return <ErrorText error={error} />;
  return <p className="muted">{children ?? 'Загружаю…'}</p>;
}

/** Окна времени: 10:00–13:00, 17:00–22:00 … */
export function WindowsEditor({
  value,
  onChange,
}: {
  value: TimeWindow[];
  onChange: (next: TimeWindow[]) => void;
}) {
  const update = (i: number, patch: Partial<TimeWindow>) =>
    onChange(value.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  return (
    <div className="stack">
      {value.map((w, i) => (
        <div className="row" key={i}>
          <input
            type="time"
            value={minutesToInput(w.start)}
            onChange={(e) => update(i, { start: inputToMinutes(e.target.value) })}
          />
          –
          <input
            type="time"
            value={minutesToInput(w.end)}
            onChange={(e) => update(i, { end: inputToMinutes(e.target.value) || 24 * 60 })}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            Убрать
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="secondary"
          onClick={() => onChange([...value, { start: 10 * 60, end: 13 * 60 }])}
        >
          Добавить окно
        </button>
      </div>
    </div>
  );
}

export function WeekdayPicker({
  value,
  onChange,
}: {
  value: Weekday[];
  onChange: (next: Weekday[]) => void;
}) {
  return (
    <div className="row">
      {WEEKDAYS.map((d) => (
        <label className="inline" key={d}>
          <input
            type="checkbox"
            checked={value.includes(d)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, d].sort() : value.filter((x) => x !== d))
            }
          />
          {WEEKDAY_SHORT[d]}
        </label>
      ))}
    </div>
  );
}

/** Бюджет недели (методология, раздел 4). */
export function BudgetTable({
  budget,
  disciplines,
}: {
  budget: Budget;
  disciplines: SemesterView['disciplines'];
}) {
  const name = (id: string) => disciplines.find((d) => d.id === id)?.name ?? id;
  const share = (m: number) => formatPercent(m / (budget.averageMinutes || 1));
  return (
    <>
      <p>
        В неделю {formatHours(budget.averageMinutes)} из {formatHours(budget.capMinutes)}: основные{' '}
        {formatHours(budget.mainMinutes)} ({share(budget.mainMinutes)}), дополнительные{' '}
        {formatHours(budget.additionalMinutes)} ({share(budget.additionalMinutes)}), резерв{' '}
        {formatHours(budget.reserveMinutes)}.
      </p>
      <table>
        <thead>
          <tr>
            <th>Дисциплина</th>
            <th>Как часто</th>
            <th>В неделю</th>
          </tr>
        </thead>
        <tbody>
          {budget.items.map((item) => (
            <tr key={item.disciplineId}>
              <td>{name(item.disciplineId)}</td>
              <td>{formatFrequency(item.frequency)}</td>
              <td>{formatHours(item.weeklyMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Каркас — типичная неделя. */
export function SkeletonGrid({
  slots,
  names,
}: {
  slots: SkeletonSlot[];
  names: Map<string, string>;
}) {
  return (
    <div className="week">
      {WEEKDAYS.map((d) => (
        <div className="day" key={d}>
          <strong>{WEEKDAY_SHORT[d]}</strong>
          {slots
            .filter((s) => s.weekday === d)
            .sort((a, b) => a.startMinute - b.startMinute)
            .map((s) => (
              <div className="slot" key={s.id}>
                {formatClock(s.startMinute)}–{formatClock(s.startMinute + s.durationMinutes)}
                <br />
                {names.get(s.disciplineId) ?? s.disciplineId}
                {s.parity !== undefined && <div className="muted">раз в 2 недели</div>}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

export const durationLabel = formatDuration;

// Составные элементы, общие для нескольких экранов.
import { Plus, Trash2 } from 'lucide-react';
import { accent, useColor } from './colors';
import {
  formatClock,
  formatFrequency,
  formatHours,
  formatPercent,
  inputToMinutes,
  minutesToInput,
  WEEKDAY_SHORT,
  WEEKDAYS,
} from './format';
import type { Budget, SemesterView, SkeletonSlot, TimeWindow, Weekday } from './types';
import { Button } from './ui';

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
            className="input time"
            type="time"
            value={minutesToInput(w.start)}
            onChange={(e) => update(i, { start: inputToMinutes(e.target.value) })}
          />
          <span className="muted">—</span>
          <input
            className="input time"
            type="time"
            value={minutesToInput(w.end)}
            onChange={(e) => update(i, { end: inputToMinutes(e.target.value) || 24 * 60 })}
          />
          <Button
            variant="ghost"
            icon={<Trash2 size={16} />}
            aria-label="Убрать окно"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={15} />}
          onClick={() => onChange([...value, { start: 10 * 60, end: 13 * 60 }])}
        >
          Добавить окно
        </Button>
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
    <div className="chips">
      {WEEKDAYS.map((d) => {
        const on = value.includes(d);
        return (
          <button
            type="button"
            key={d}
            className={`chip ${on ? 'on' : ''}`}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
          >
            {WEEKDAY_SHORT[d]}
          </button>
        );
      })}
    </div>
  );
}

function BudgetRow({
  id,
  name,
  frequency,
  minutes,
}: {
  id: string;
  name: string;
  frequency: string;
  minutes: number;
}) {
  const color = useColor(id);
  return (
    <div className="row between">
      <span className="row" style={{ gap: 8 }}>
        <span className="dot" style={{ background: color.accent }} />
        {name}
      </span>
      <span className="muted small">
        {frequency} · {formatHours(minutes)}
      </span>
    </div>
  );
}

function BudgetSegment({ id, share }: { id: string; share: number }) {
  const color = useColor(id);
  return <span style={{ width: `${share * 100}%`, background: color.accent }} />;
}

/** Бюджет недели (методология, раздел 4): полоса по дисциплинам и запас до лимита. */
export function BudgetView({
  budget,
  disciplines,
}: {
  budget: Budget;
  disciplines: SemesterView['disciplines'];
}) {
  const name = (id: string) => disciplines.find((d) => d.id === id)?.name ?? id;
  const share = (m: number) => formatPercent(m / (budget.averageMinutes || 1));
  return (
    <div className="stack">
      <div className="row between">
        <span>
          <strong style={{ fontSize: 22, fontWeight: 650 }}>
            {formatHours(budget.averageMinutes)}
          </strong>{' '}
          <span className="muted">в неделю из {formatHours(budget.capMinutes)}</span>
        </span>
        <span className="faint">
          основные {share(budget.mainMinutes)} · дополнительные {share(budget.additionalMinutes)} ·
          резерв {formatHours(budget.reserveMinutes)}
        </span>
      </div>
      <div className="stacked">
        {budget.items.map((item) => (
          <BudgetSegment
            key={item.disciplineId}
            id={item.disciplineId}
            share={item.weeklyMinutes / budget.capMinutes}
          />
        ))}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {budget.items.map((item) => (
          <BudgetRow
            key={item.disciplineId}
            id={item.disciplineId}
            name={name(item.disciplineId)}
            frequency={formatFrequency(item.frequency)}
            minutes={item.weeklyMinutes}
          />
        ))}
      </div>
    </div>
  );
}

function SkeletonChip({ slot, name }: { slot: SkeletonSlot; name: string }) {
  const color = useColor(slot.disciplineId);
  return (
    <div
      className="lesson"
      style={{ ...accent(color), padding: '8px 10px 8px 14px', fontSize: 13 }}
    >
      <div className="grow" title={name}>
        <strong className="clip">{name}</strong>
        <div className="faint">
          {formatClock(slot.startMinute)}–{formatClock(slot.startMinute + slot.durationMinutes)}
          {slot.parity !== undefined && ' · раз в 2 нед.'}
        </div>
      </div>
    </div>
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
    <div
      className="grid-4"
      style={{ gridTemplateColumns: 'repeat(7, minmax(110px, 1fr))', overflowX: 'auto' }}
    >
      {WEEKDAYS.map((d) => (
        <div className="stack" style={{ gap: 6 }} key={d}>
          <span className="faint" style={{ fontWeight: 600 }}>
            {WEEKDAY_SHORT[d]}
          </span>
          {slots
            .filter((s) => s.weekday === d)
            .sort((a, b) => a.startMinute - b.startMinute)
            .map((s) => (
              <SkeletonChip
                key={s.id}
                slot={s}
                name={names.get(s.disciplineId) ?? s.disciplineId}
              />
            ))}
          {!slots.some((s) => s.weekday === d) && <span className="faint">свободно</span>}
        </div>
      ))}
    </div>
  );
}

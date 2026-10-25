import { useState } from 'react';
import { api, ApiError, errorText } from '../api';
import { ErrorText, Loading } from '../components';
import { day, fromInput, local, ORIGIN, STATUS, time, toInput, weekStart } from '../format';
import { useApi, useRefresh } from '../hooks';
import type { SessionView, Today, Violation } from '../types';

/** Ручной перенос: если правила нарушаются — показать какие и спросить (раздел 6, п. 9). */
function MoveForm({ s, zone, onDone }: { s: SessionView; zone: string; onDone: () => void }) {
  const { refresh } = useRefresh();
  const [value, setValue] = useState(toInput(s.start, zone));
  const [violations, setViolations] = useState<Violation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const move = async (confirm: boolean) => {
    setError(null);
    try {
      await api.post(`/api/sessions/${s.id}/move`, { start: fromInput(value, zone), confirm });
      refresh();
      onDone();
    } catch (e) {
      const details =
        e instanceof ApiError ? (e.details as { violations?: Violation[] } | undefined) : undefined;
      if (details?.violations) setViolations(details.violations);
      else setError(errorText(e));
    }
  };

  return (
    <div className="stack">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => (setValue(e.target.value), setViolations(null))}
      />
      <div className="row">
        <button onClick={() => void move(false)}>Перенести</button>
        <button className="secondary" onClick={onDone}>
          Отмена
        </button>
      </div>
      {violations && (
        <div className="warning">
          Так нарушаются правила:
          <ul>
            {violations.map((v, i) => (
              <li key={i}>{v.message}</li>
            ))}
          </ul>
          <button className="danger" onClick={() => void move(true)}>
            Перенести всё равно
          </button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function SessionCard({ s, today }: { s: SessionView; today: Today }) {
  const { refresh } = useRefresh();
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zone = today.timezone;
  const future = s.status === 'planned' && s.start > today.now;

  const skip = async () => {
    if (
      !confirm(
        `Пропустить «${s.disciplineName}» ${day(s.start, zone)}? Это не будет считаться пропуском.`,
      )
    )
      return;
    try {
      await api.post(`/api/sessions/${s.id}/skip`);
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className={`slot ${s.status}`}>
      <strong>
        {time(s.start, zone)}–{time(s.end, zone)}
      </strong>{' '}
      {s.disciplineName}
      <div className="muted">
        {STATUS[s.status]}
        {ORIGIN[s.origin] && ` · ${ORIGIN[s.origin]}`}
        {s.moveReason && !s.moveReason.startsWith(ORIGIN[s.origin]) && ` (${s.moveReason})`}
      </div>
      {s.acceptedViolations && s.acceptedViolations.length > 0 && (
        <div className="muted">с твоего согласия нарушено правило</div>
      )}
      {future && !moving && (
        <div className="row">
          <button className="secondary" onClick={() => setMoving(true)}>
            Перенести
          </button>
          <button className="secondary" onClick={() => void skip()}>
            Пропустить
          </button>
        </div>
      )}
      {moving && <MoveForm s={s} zone={zone} onDone={() => setMoving(false)} />}
      <ErrorText error={error} />
    </div>
  );
}

export function ScheduleScreen({ today }: { today: Today }) {
  const zone = today.timezone;
  const [offset, setOffset] = useState(0);
  const monday = local(weekStart(today.now, zone), zone).plus({ weeks: offset });
  const from = monday.toMillis();
  const to = monday.plus({ weeks: 1 }).toMillis();
  const { data, error } = useApi<SessionView[]>(
    today.semester ? `/api/schedule?from=${from}&to=${to}` : null,
  );

  if (!today.semester) {
    return (
      <section>
        <h2>Расписание</h2>
        <p>
          Семестр ещё не составлен — <a href="#semester">составить</a>.
        </p>
      </section>
    );
  }
  const days = Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }));
  const todayKey = local(today.now, zone).toISODate();

  return (
    <section>
      <div className="row">
        <h2 style={{ margin: 0 }}>
          Неделя {day(from, zone)} — {day(to - 1, zone)}
        </h2>
        <button className="secondary" onClick={() => setOffset(offset - 1)}>
          ←
        </button>
        <button className="secondary" onClick={() => setOffset(0)}>
          Эта неделя
        </button>
        <button className="secondary" onClick={() => setOffset(offset + 1)}>
          →
        </button>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="week" style={{ marginTop: 8 }}>
          {days.map((d) => (
            <div className={`day ${d.toISODate() === todayKey ? 'today' : ''}`} key={d.toISODate()}>
              <strong>{day(d.toMillis(), zone)}</strong>
              {data
                .filter((s) => local(s.start, zone).toISODate() === d.toISODate())
                .map((s) => (
                  <SessionCard key={s.id} s={s} today={today} />
                ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

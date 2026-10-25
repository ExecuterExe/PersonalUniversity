import { useState } from 'react';
import { api } from '../api';
import { ErrorText, Loading } from '../components';
import { formatHours, formatPercent, range } from '../format';
import { useAction, useApi } from '../hooks';
import type { DecisionView, MakeupPreview, Today } from '../types';

const pct = (v: number | null) => (v === null ? '—' : formatPercent(v));

function Options({
  d,
  zone,
  value,
  onChange,
}: {
  d: DecisionView;
  zone: string;
  value: number | undefined;
  onChange: (start: number) => void;
}) {
  if (!d.options || d.options.length === 0)
    return <p className="muted">Подходящих вариантов нет.</p>;
  return (
    <div className="stack">
      {d.options.map((o) => (
        <label className="inline" key={o.start}>
          <input type="radio" checked={value === o.start} onChange={() => onChange(o.start)} />
          {range(o.start, o.end, zone)}
          <span className="muted">
            {' '}
            · {o.label.split(' · ')[1]}
            {o.weekLoadAfter !== o.weekLoadBefore &&
              ` · нагрузка недели ${formatHours(o.weekLoadBefore)} → ${formatHours(o.weekLoadAfter)}`}
          </span>
        </label>
      ))}
    </div>
  );
}

function Checkpoint({ d, today }: { d: DecisionView; today: Today }) {
  const review = d.checkpoint!;
  const { run, error, busy } = useAction();
  const [weeks, setWeeks] = useState(2);
  const [biweekly, setBiweekly] = useState('');
  const [archive, setArchive] = useState<string[]>([]);
  const weekly = (today.semester?.disciplines ?? []).filter((x) => x.frequency === 1);
  const resolve = (body: object) => run(() => api.post(`/api/decisions/${d.id}/resolve`, body));

  return (
    <div className="stack">
      <table>
        <thead>
          <tr>
            <th>Дисциплина</th>
            <th>Цель и метрики</th>
            <th>Часы: факт / план</th>
            <th>Прогресс</th>
            <th>Посещаемость</th>
            <th>Прогноз к концу</th>
          </tr>
        </thead>
        <tbody>
          {review.disciplines.map((s) => (
            <tr key={s.disciplineId}>
              <td>{s.name}</td>
              <td>
                {s.goal}
                <div className="muted">{s.metrics}</div>
              </td>
              <td>
                {formatHours(s.actualMinutes)} / {formatHours(s.plannedMinutes)}
              </td>
              <td>{pct(s.progress)}</td>
              <td>
                {pct(s.attendance)} ({s.held} из {s.held + s.missed})
              </td>
              <td>{pct(s.forecast)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {review.facts.map((f) => (
        <p key={f}>{f}</p>
      ))}
      {review.calibration.map((c) => (
        <p key={c.disciplineId} className="muted">
          Подсказка: занятия в среднем {Math.round(c.medianActualMinutes)} из {c.currentMinutes} мин
          — можно сделать {c.suggestedMinutes}.
        </p>
      ))}
      <div className="row">
        {d.actions.includes('ack') && (
          <button disabled={busy} onClick={() => void resolve({ action: 'ack' })}>
            Всё в порядке, продолжаем
          </button>
        )}
        <input
          type="number"
          min={1}
          max={8}
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          style={{ width: 60 }}
        />
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void resolve({ action: 'extend', weeks })}
        >
          Продлить семестр на {weeks} нед.
        </button>
      </div>
      {d.actions.includes('biweekly') && weekly.length > 0 && (
        <div className="row">
          <select value={biweekly} onChange={(e) => setBiweekly(e.target.value)}>
            <option value="">— дисциплина раз в неделю —</option>
            {weekly.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <button
            className="secondary"
            disabled={!biweekly || busy}
            onClick={() => void resolve({ action: 'biweekly', disciplineId: biweekly })}
          >
            Сделать раз в 2 недели
          </button>
        </div>
      )}
      {d.actions.includes('finish') && (
        <div className="stack">
          <p>Что отправить в архив (остальные можно взять в новый семестр):</p>
          {review.disciplines.map((s) => (
            <label className="inline" key={s.disciplineId}>
              <input
                type="checkbox"
                checked={archive.includes(s.disciplineId)}
                onChange={(e) =>
                  setArchive(
                    e.target.checked
                      ? [...archive, s.disciplineId]
                      : archive.filter((x) => x !== s.disciplineId),
                  )
                }
              />
              {s.name}
            </label>
          ))}
          <div>
            <button disabled={busy} onClick={() => void resolve({ action: 'finish', archive })}>
              Завершить семестр
            </button>
          </div>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function DecisionCard({
  d,
  today,
  choice,
  setChoice,
}: {
  d: DecisionView;
  today: Today;
  choice: number | undefined;
  setChoice: (start: number) => void;
}) {
  const { run, error, busy } = useAction();
  const [compromise, setCompromise] = useState<number | undefined>(undefined);
  const zone = today.timezone;
  const resolve = (body: object) => run(() => api.post(`/api/decisions/${d.id}/resolve`, body));
  const has = (action: string) => d.actions.includes(action);

  return (
    <section>
      <h2>{d.title}</h2>
      {d.session && <p className="muted">{range(d.session.start, d.session.end, zone)}</p>}
      {d.events?.map((e, i) => (
        <p key={i} className="muted">
          Событие: «{e.title}», {range(e.start, e.end, zone)}
        </p>
      ))}

      {d.kind === 'checkpoint' && <Checkpoint d={d} today={today} />}

      {(d.kind === 'missed' || d.kind === 'conflict') && (
        <Options d={d} zone={zone} value={choice} onChange={setChoice} />
      )}
      {d.compromises && d.compromises.length > 0 && (
        <div className="stack">
          <p>Обычного переноса нет. Можно так, только для этого занятия:</p>
          {d.compromises.map((c) => (
            <label className="inline" key={c.index}>
              <input
                type="radio"
                checked={compromise === c.index}
                onChange={() => setCompromise(c.index)}
              />
              {c.title}
            </label>
          ))}
        </div>
      )}
      {d.skeletonChange && (
        <p className="warning">Похоже, это постоянное событие. {d.skeletonChange.description}?</p>
      )}

      <div className="row">
        {has('makeup') && (
          <button
            disabled={choice === undefined || busy}
            onClick={() => void resolve({ action: 'makeup', start: choice })}
          >
            Отработать
          </button>
        )}
        {has('leave') && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void resolve({ action: 'leave' })}
          >
            Оставить пропущенным
          </button>
        )}
        {has('move') && (
          <button
            disabled={choice === undefined || busy}
            onClick={() => void resolve({ action: 'move', start: choice })}
          >
            Перенести
          </button>
        )}
        {has('compromise') && d.compromises && d.compromises.length > 0 && (
          <button
            disabled={compromise === undefined || busy}
            onClick={() => void resolve({ action: 'compromise', index: compromise })}
          >
            Согласиться
          </button>
        )}
        {has('skeleton') && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void resolve({ action: 'skeleton' })}
          >
            Перенести насовсем
          </button>
        )}
        {has('skip') && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void resolve({ action: 'skip' })}
          >
            Пропустить занятие
          </button>
        )}
        {has('keep') && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void resolve({ action: 'keep' })}
          >
            {d.kind === 'calendar-edit' ? 'Оставить так' : 'Оставить как есть'}
          </button>
        )}
        {has('revert') && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void resolve({ action: 'revert' })}
          >
            Вернуть как было
          </button>
        )}
        {has('restore') && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void resolve({ action: 'restore' })}
          >
            Вернуть в календарь
          </button>
        )}
        {has('accept') && (
          <button disabled={busy} onClick={() => void resolve({ action: 'accept' })}>
            Да, сделать
          </button>
        )}
        {has('dismiss') && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void resolve({ action: 'dismiss' })}
          >
            Нет, оставить
          </button>
        )}
      </div>
      <ErrorText error={error} />
    </section>
  );
}

export function DecisionsScreen({ today }: { today: Today }) {
  const { data, error } = useApi<DecisionView[]>('/api/decisions');
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<MakeupPreview | null>(null);
  const { run, error: previewError } = useAction();
  if (!data) return <Loading error={error} />;
  if (data.length === 0) {
    return (
      <section>
        <h2>Решения</h2>
        <p className="muted">Вопросов нет.</p>
      </section>
    );
  }
  const missed = data.filter((d) => d.kind === 'missed' && choices[d.id] !== undefined);
  const allMissed = data.filter((d) => d.kind === 'missed');
  const lead = today.semester?.leadDays ?? 0;

  // После отпуска или болезни пропусков много — разобрать их одним действием (раздел 8).
  const leaveAll = () => {
    if (!confirm(`Оставить все пропуски (${allMissed.length}) как есть? Отрабатывать их не нужно.`))
      return;
    void run(async () => {
      for (const d of allMissed) {
        await api.post(`/api/decisions/${d.id}/resolve`, { action: 'leave' });
      }
    });
  };

  return (
    <>
      {allMissed.length > 1 && (
        <section>
          <p>Пропусков: {allMissed.length}. Можно отработать нужные ниже, а остальные оставить.</p>
          <button className="secondary" onClick={leaveAll}>
            Оставить все пропуски как есть
          </button>
        </section>
      )}
      {data.map((d) => (
        <DecisionCard
          key={d.id}
          d={d}
          today={today}
          choice={choices[d.id]}
          setChoice={(start) => {
            setChoices({ ...choices, [d.id]: start });
            setPreview(null);
          }}
        />
      ))}
      {missed.length > 1 && (
        <section>
          <h2>Если отработать выбранное</h2>
          <button
            className="secondary"
            onClick={async () => {
              const result = await run(() =>
                api.post<MakeupPreview>('/api/decisions/makeup-preview', {
                  choices: missed.map((d) => ({ decisionId: d.id, start: choices[d.id] })),
                }),
              );
              if (result) setPreview(result);
            }}
          >
            Посчитать нагрузку
          </button>
          {preview && (
            <table>
              <tbody>
                {preview.weeks.map((w) => (
                  <tr key={w.weekIndex}>
                    <td>Неделя {w.weekIndex + (lead ? 0 : 1)}</td>
                    <td className={w.overCap ? 'error' : ''}>
                      {formatHours(w.beforeMinutes)} → {formatHours(w.afterMinutes)} (лимит{' '}
                      {formatHours(w.capMinutes)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {preview && preview.invalid.length > 0 && (
            <p className="warning">Некоторые варианты вместе не помещаются — выбери другие.</p>
          )}
          <ErrorText error={previewError} />
        </section>
      )}
    </>
  );
}

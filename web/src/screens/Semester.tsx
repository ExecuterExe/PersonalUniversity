import { useState } from 'react';
import { api } from '../api';
import { BudgetTable, ErrorText, Loading, SkeletonGrid } from '../components';
import { day, formatFrequency, formatHours, local, time } from '../format';
import { useAction, useApi } from '../hooks';
import type { AppSettings, ChangeView, Discipline, SemesterView, Today } from '../types';

function SemesterSummary({ sem, zone }: { sem: SemesterView; zone: string }) {
  const names = new Map(sem.disciplines.map((d) => [d.id, d.name]));
  return (
    <div className="stack">
      <p>
        {sem.startDate} — {sem.endDate}: {sem.fullWeeks} нед.
        {sem.leadDays > 0 && ` + ${sem.leadDays} дн. в начале`}
        {sem.currentWeek !== null && ` · сейчас неделя ${sem.currentWeek}`}
      </p>
      {sem.warnings.map((w, i) => (
        <p className="warning" key={i}>
          {w.message}
        </p>
      ))}
      {sem.budget && <BudgetTable budget={sem.budget} disciplines={sem.disciplines} />}
      <h3>Типичная неделя</h3>
      <SkeletonGrid slots={sem.skeleton} names={names} />
      {sem.moved.length > 0 && (
        <>
          <h3>Перенесено из-за событий в календаре</h3>
          <ul>
            {sem.moved.map((m) => (
              <li key={m.sessionId}>
                «{names.get(m.disciplineId)}»: {day(m.from, zone)} {time(m.from, zone)} →{' '}
                {day(m.to, zone)} {time(m.to, zone)} ({m.reason})
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DraftView({ draft, zone }: { draft: SemesterView; zone: string }) {
  const { run, error, busy } = useAction();
  return (
    <section>
      <h2>Черновик семестра</h2>
      {draft.failure ? (
        <div className="stack">
          <p className="error">{draft.failure.message}</p>
          {draft.compromises.length > 0 ? (
            <>
              <p>Что можно сделать (любой вариант):</p>
              {draft.compromises.map((c) => (
                <div className="row" key={c.index}>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(() => api.post(`/api/semesters/draft/compromises/${c.index}`))
                    }
                  >
                    Выбрать
                  </button>
                  {c.title} — самая тяжёлая неделя {formatHours(c.peakMinutes)}
                </div>
              ))}
            </>
          ) : (
            <p>Подходящих компромиссов не нашлось — поменяй настройки или состав дисциплин.</p>
          )}
        </div>
      ) : (
        <SemesterSummary sem={draft} zone={zone} />
      )}
      <div className="row" style={{ marginTop: 12 }}>
        {!draft.failure && (
          <button
            disabled={busy}
            onClick={() => void run(() => api.post('/api/semesters/draft/confirm'))}
          >
            Подтвердить — начать семестр
          </button>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void run(() => api.post('/api/semesters/draft/refresh'))}
        >
          Пересчитать
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={() => {
            if (confirm('Удалить черновик?')) void run(() => api.del('/api/semesters/draft'));
          }}
        >
          Удалить черновик
        </button>
      </div>
      <ErrorText error={error} />
    </section>
  );
}

/** now — время сервера: по умолчанию семестр начинается завтра по его часам. */
export function NewSemesterForm({ zone, now }: { zone: string; now: number }) {
  const { data: disciplines, error } = useApi<Discipline[]>('/api/disciplines');
  const { data: settings } = useApi<AppSettings>('/api/settings');
  const [startDate, setStartDate] = useState(
    () => local(now, zone).plus({ days: 1 }).toISODate() ?? '',
  );
  const [weeks, setWeeks] = useState<number | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const { run, error: createError, busy } = useAction();
  if (!disciplines || !settings) return <Loading error={error} />;
  if (disciplines.length === 0) return <p>Сначала добавь дисциплины.</p>;
  const ids = chosen ?? disciplines.map((d) => d.id);
  const fullWeeks = weeks ?? settings.defaultSemesterWeeks;

  return (
    <div className="stack">
      <div className="row">
        <label>
          Начало
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          Полных недель
          <input
            type="number"
            min={1}
            max={52}
            value={fullWeeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="muted">
        Если семестр начинается не с понедельника, первые дни добавятся к этим неделям.
      </p>
      <h3>Дисциплины семестра</h3>
      {disciplines.map((d) => (
        <label className="inline" key={d.id}>
          <input
            type="checkbox"
            checked={ids.includes(d.id)}
            onChange={(e) =>
              setChosen(e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id))
            }
          />
          {d.name}
        </label>
      ))}
      <div>
        <button
          disabled={busy || ids.length === 0}
          onClick={() =>
            void run(() =>
              api.post('/api/semesters/draft', { startDate, fullWeeks, disciplineIds: ids }),
            )
          }
        >
          Составить расписание
        </button>
      </div>
      <ErrorText error={createError} />
    </div>
  );
}

/** Добавить или убрать дисциплину посреди семестра: сначала «было → станет» (раздел 4). */
function ChangesPanel({ sem }: { sem: SemesterView }) {
  const { data: disciplines } = useApi<Discipline[]>('/api/disciplines');
  const [type, setType] = useState<'add' | 'remove'>('add');
  const [disciplineId, setDisciplineId] = useState('');
  const [preview, setPreview] = useState<ChangeView | null>(null);
  const [compromise, setCompromise] = useState<number | undefined>(undefined);
  const { run, error, busy } = useAction();
  const active = new Set(sem.disciplines.filter((d) => d.frequency !== null).map((d) => d.id));
  const options =
    type === 'add'
      ? (disciplines ?? []).filter((d) => !active.has(d.id))
      : sem.disciplines.filter((d) => active.has(d.id));

  const body = () => ({
    type,
    disciplineId,
    ...(compromise === undefined ? {} : { compromiseIndex: compromise }),
  });

  return (
    <div className="stack">
      <div className="row">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as 'add' | 'remove');
            setDisciplineId('');
            setPreview(null);
          }}
        >
          <option value="add">Добавить дисциплину</option>
          <option value="remove">Убрать дисциплину</option>
        </select>
        <select
          value={disciplineId}
          onChange={(e) => {
            setDisciplineId(e.target.value);
            setPreview(null);
            setCompromise(undefined);
          }}
        >
          <option value="">— выбери —</option>
          {options.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          disabled={!disciplineId || busy}
          onClick={async () => {
            const result = await run(() =>
              api.post<ChangeView>('/api/semesters/active/changes/preview', body()),
            );
            if (result) setPreview(result);
          }}
        >
          Что изменится
        </button>
      </div>
      {preview && (
        <div className="card">
          <p>
            Нагрузка: {formatHours(preview.before.averageMinutes)} →{' '}
            {preview.after ? formatHours(preview.after.averageMinutes) : '—'} в неделю (лимит{' '}
            {formatHours(preview.before.capMinutes)}).
          </p>
          {preview.frequencyChanges.map((c) => (
            <p key={c.disciplineId}>
              «{c.name}»: {c.from ? formatFrequency(c.from) : 'нет'} →{' '}
              {c.to ? formatFrequency(c.to) : 'убирается'}
            </p>
          ))}
          <p className="muted">
            Добавится занятий: {preview.addedSessions}, уберётся: {preview.removedSessions}. Прошлое
            не меняется.
          </p>
          {preview.failure && <p className="error">{preview.failure}</p>}
          {preview.compromises.map((c) => (
            <label className="inline" key={c.index}>
              <input
                type="radio"
                checked={compromise === c.index}
                onChange={() => setCompromise(c.index)}
              />
              {c.title}
            </label>
          ))}
          <button
            disabled={busy || (!preview.ok && compromise === undefined)}
            onClick={async () => {
              if (await run(() => api.post('/api/semesters/active/changes/apply', body()))) {
                setPreview(null);
                setDisciplineId('');
              }
            }}
          >
            Применить
          </button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export function SemesterScreen({ today }: { today: Today }) {
  const { data: draft, error } = useApi<SemesterView>(
    today.draftPending ? '/api/semesters/draft' : null,
  );
  const zone = today.timezone;

  if (today.semester) {
    return (
      <>
        <section>
          <h2>Семестр</h2>
          <SemesterSummary sem={today.semester} zone={zone} />
        </section>
        <section>
          <h2>Изменения посреди семестра</h2>
          <ChangesPanel sem={today.semester} />
        </section>
      </>
    );
  }
  if (today.draftPending)
    return draft ? <DraftView draft={draft} zone={zone} /> : <Loading error={error} />;
  return (
    <section>
      <h2>Новый семестр</h2>
      <NewSemesterForm zone={zone} now={today.now} />
    </section>
  );
}

import { ALLOWED_DURATIONS } from '@ou/engine';
import { useState } from 'react';
import { api } from '../api';
import { ErrorText, Loading } from '../components';
import { formatDuration, PRIORITY } from '../format';
import { useAction, useApi } from '../hooks';
import type { Discipline, Priority, Source } from '../types';

interface DisciplineInput {
  name: string;
  priority: Priority;
  durationMinutes: number;
  goal: string;
  metrics: string;
}

const EMPTY: DisciplineInput = {
  name: '',
  priority: 'main',
  durationMinutes: 90,
  goal: '',
  metrics: '',
};

/** Цель и метрики обязательны — так договорились с самого начала. */
export function DisciplineForm({
  initial = EMPTY,
  submitLabel,
  onSubmit,
  lockPlan = false,
}: {
  initial?: DisciplineInput;
  submitLabel: string;
  onSubmit: (input: DisciplineInput) => Promise<unknown>;
  lockPlan?: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<DisciplineInput>) => setForm({ ...form, ...patch });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(form).then((ok) => {
          if (ok && initial === EMPTY) setForm(EMPTY);
        });
      }}
    >
      <label>
        Название
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="row">
        <label className="inline">
          <input
            type="radio"
            checked={form.priority === 'main'}
            disabled={lockPlan}
            onChange={() => set({ priority: 'main' })}
          />
          основная — несколько раз в неделю
        </label>
        <label className="inline">
          <input
            type="radio"
            checked={form.priority === 'additional'}
            disabled={lockPlan}
            onChange={() => set({ priority: 'additional' })}
          />
          дополнительная — раз в неделю
        </label>
      </div>
      <label>
        Длительность занятия
        <select
          value={form.durationMinutes}
          disabled={lockPlan}
          onChange={(e) => set({ durationMinutes: Number(e.target.value) })}
        >
          {ALLOWED_DURATIONS.map((m) => (
            <option key={m} value={m}>
              {formatDuration(m)}
            </option>
          ))}
        </select>
      </label>
      {lockPlan && (
        <p className="muted">
          Дисциплина идёт в семестре: приоритет поменяется со следующего, длительность — через
          подсказку о калибровке.
        </p>
      )}
      <label>
        Цель — чего хочу достичь
        <textarea value={form.goal} onChange={(e) => set({ goal: e.target.value })} />
      </label>
      <label>
        Метрики — как пойму, что цель достигнута
        <textarea value={form.metrics} onChange={(e) => set({ metrics: e.target.value })} />
      </label>
      <div>
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

function Sources({ disciplineId, sources }: { disciplineId: string; sources: Source[] }) {
  const { run, error } = useAction();
  const [kind, setKind] = useState<'link' | 'note'>('link');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const add = async () => {
    const body =
      kind === 'link'
        ? { kind, url, title: title || undefined }
        : { kind, note, title: title || undefined };
    if (await run(() => api.post(`/api/disciplines/${disciplineId}/sources`, body))) {
      setUrl('');
      setTitle('');
      setNote('');
    }
  };

  return (
    <div className="stack">
      {sources.length === 0 && <p className="muted">Источников пока нет.</p>}
      <ul>
        {sources.map((s) => (
          <li key={s.id}>
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            ) : (
              <strong>{s.title}</strong>
            )}
            {s.kind === 'note' && s.note && s.note !== s.title && (
              <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                {s.note}
              </div>
            )}{' '}
            <button
              className="danger"
              onClick={() => void run(() => api.del(`/api/sources/${s.id}`))}
            >
              Удалить
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <label className="inline">
          <input type="radio" checked={kind === 'link'} onChange={() => setKind('link')} /> ссылка
        </label>
        <label className="inline">
          <input type="radio" checked={kind === 'note'} onChange={() => setKind('note')} /> заметка
          (книга, глава…)
        </label>
      </div>
      {kind === 'link' ? (
        <input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
      ) : (
        <textarea
          placeholder="Например: «SQL. Быстрое погружение», главы 1–3"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <input
        placeholder="Название (необязательно)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div>
        <button className="secondary" onClick={() => void add()}>
          Добавить источник
        </button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function DisciplineCard({ id, inSemester }: { id: string; inSemester: boolean }) {
  const { data, error } = useApi<Discipline & { sources: Source[] }>(`/api/disciplines/${id}`);
  const { run, error: actionError } = useAction();
  if (!data) return <Loading error={error} />;
  return (
    <div className="stack">
      <h2>{data.name}</h2>
      {data.continueHint && <p className="warning">С чего продолжить: {data.continueHint}</p>}
      <h3>Источники</h3>
      <Sources disciplineId={id} sources={data.sources} />
      <h3>Карточка</h3>
      <DisciplineForm
        key={data.id + data.durationMinutes + data.priority}
        initial={data}
        lockPlan={inSemester}
        submitLabel="Сохранить"
        onSubmit={(input) => run(() => api.patch(`/api/disciplines/${id}`, input))}
      />
      {data.archivedAt === null ? (
        <div>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Отправить «${data.name}» в архив?`))
                void run(() => api.post(`/api/disciplines/${id}/archive`));
            }}
          >
            В архив
          </button>
        </div>
      ) : (
        <p className="muted">В архиве.</p>
      )}
      <ErrorText error={actionError} />
    </div>
  );
}

export function DisciplinesScreen({
  semesterDisciplineIds = [],
}: {
  semesterDisciplineIds?: string[];
}) {
  const [archived, setArchived] = useState(false);
  const { data, error } = useApi<Discipline[]>(`/api/disciplines?archived=${archived}`);
  const [selected, setSelected] = useState<string | null>(null);
  const { run, error: createError } = useAction();

  return (
    <>
      <section>
        <h2>Дисциплины</h2>
        {!data ? (
          <Loading error={error} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Приоритет</th>
                <th>Занятие</th>
                <th>Цель</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} onClick={() => setSelected(d.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <a href="#disciplines" onClick={(e) => e.preventDefault()}>
                      {d.name}
                    </a>
                    {d.archivedAt !== null && <span className="muted"> (архив)</span>}
                  </td>
                  <td>{PRIORITY[d.priority]}</td>
                  <td>{formatDuration(d.durationMinutes)}</td>
                  <td>{d.goal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <label className="inline">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{' '}
          показать архив
        </label>
      </section>
      {selected && (
        <section>
          <DisciplineCard id={selected} inSemester={semesterDisciplineIds.includes(selected)} />
        </section>
      )}
      <section>
        <h2>Новая дисциплина</h2>
        <DisciplineForm
          submitLabel="Добавить"
          onSubmit={(input) => run(() => api.post<Discipline>('/api/disciplines', input))}
        />
        <ErrorText error={createError} />
      </section>
    </>
  );
}

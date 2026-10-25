import { ALLOWED_DURATIONS } from '@ou/engine';
import {
  Archive,
  BookOpen,
  ExternalLink,
  Link2,
  NotebookPen,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useConfirm } from '../confirm';
import { useAccent } from '../colors';
import { formatDuration, formatHours, formatPercent, PRIORITY } from '../format';
import { useAction, useApi } from '../hooks';
import type { Discipline, Priority, Source, Stats } from '../types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorText,
  Field,
  Loading,
  Option,
  PageHeader,
  Progress,
  Segmented,
} from '../ui';

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
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<DisciplineInput>) => setForm({ ...form, ...patch });
  return (
    <form
      className="stack-lg"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onSubmit(form)
          .then((ok) => {
            if (ok && initial === EMPTY) setForm(EMPTY);
          })
          .finally(() => setBusy(false));
      }}
    >
      <Field label="Название">
        <input
          className="input"
          placeholder="Например, SQL"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <div className="field">
        Приоритет
        <div className="grid-2" style={{ gap: 10 }}>
          <Option
            on={form.priority === 'main'}
            disabled={lockPlan}
            onClick={() => set({ priority: 'main' })}
          >
            <span className="title">Основная</span>
            <span className="sub">несколько раз в неделю</span>
          </Option>
          <Option
            on={form.priority === 'additional'}
            disabled={lockPlan}
            onClick={() => set({ priority: 'additional' })}
          >
            <span className="title">Дополнительная</span>
            <span className="sub">раз в неделю</span>
          </Option>
        </div>
      </div>
      <div className="field">
        Длительность занятия
        <div className="chips">
          {ALLOWED_DURATIONS.map((m) => (
            <button
              type="button"
              key={m}
              className={`chip ${form.durationMinutes === m ? 'on' : ''}`}
              disabled={lockPlan}
              onClick={() => set({ durationMinutes: m })}
            >
              {formatDuration(m)}
            </button>
          ))}
        </div>
      </div>
      {lockPlan && (
        <p className="faint">
          Дисциплина идёт в семестре: приоритет поменяется со следующего, длительность — через
          подсказку о калибровке.
        </p>
      )}
      <Field label="Цель" hint="Чего хочу достичь">
        <textarea
          className="textarea"
          value={form.goal}
          onChange={(e) => set({ goal: e.target.value })}
        />
      </Field>
      <Field label="Метрики" hint="Как пойму, что цель достигнута">
        <textarea
          className="textarea"
          value={form.metrics}
          onChange={(e) => set({ metrics: e.target.value })}
        />
      </Field>
      <div>
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Sources({ disciplineId, sources }: { disciplineId: string; sources: Source[] }) {
  const { run, error, busy } = useAction();
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
      {sources.length === 0 && (
        <p className="faint">Источников пока нет — добавь ссылку или книгу.</p>
      )}
      {sources.map((s) => (
        <div className="source" key={s.id}>
          {s.url ? (
            <Link2 size={17} color="var(--primary)" />
          ) : (
            <StickyNote size={17} color="var(--violet)" />
          )}
          <div className="grow">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title} <ExternalLink size={12} style={{ verticalAlign: -1 }} />
              </a>
            ) : (
              <strong>{s.title}</strong>
            )}
            {s.kind === 'note' && s.note && s.note !== s.title && (
              <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>
                {s.note}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={15} />}
            aria-label="Удалить источник"
            onClick={() => void run(() => api.del(`/api/sources/${s.id}`))}
          />
        </div>
      ))}
      <div className="card flat stack" style={{ padding: 14, background: 'var(--surface-2)' }}>
        <Segmented
          value={kind}
          options={[
            { value: 'link', label: 'Ссылка' },
            { value: 'note', label: 'Заметка' },
          ]}
          onChange={setKind}
        />
        {kind === 'link' ? (
          <input
            className="input"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        ) : (
          <textarea
            className="textarea"
            placeholder="Например: «SQL. Быстрое погружение», главы 1–3"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        <input
          className="input"
          placeholder="Название (необязательно)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={15} />}
            disabled={busy}
            onClick={() => void add()}
          >
            Добавить источник
          </Button>
        </div>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function DisciplineDetail({
  id,
  inSemester,
  onClose,
}: {
  id: string;
  inSemester: boolean;
  onClose: () => void;
}) {
  const { data, error } = useApi<Discipline & { sources: Source[] }>(`/api/disciplines/${id}`);
  const { data: stats } = useApi<Stats | null>('/api/stats');
  const { run, error: actionError } = useAction();
  const confirm = useConfirm();
  const style = useAccent(id);
  if (!data) return <Loading error={error} height={240} />;
  const progress = stats?.disciplines.find((x) => x.disciplineId === id);
  const pct = (v: number | null) => (v === null ? '—' : formatPercent(v));
  return (
    <Card
      style={style}
      title={data.name}
      icon={
        <span className="swatch-sm">
          <BookOpen size={17} />
        </span>
      }
      action={
        <div className="row" style={{ gap: 6 }}>
          {data.archivedAt === null ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Archive size={15} />}
              onClick={() =>
                void confirm({
                  title: `Отправить «${data.name}» в архив?`,
                  text: 'Её можно будет вернуть из архива.',
                  ok: 'В архив',
                }).then((yes) => {
                  if (yes) void run(() => api.post(`/api/disciplines/${id}/archive`));
                })
              }
            >
              В архив
            </Button>
          ) : (
            <Badge>в архиве</Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<X size={16} />}
            aria-label="Закрыть"
            onClick={onClose}
          />
        </div>
      }
    >
      <div className="stack-lg">
        {progress && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row between">
              <h3>Прогресс в семестре</h3>
              <span className="muted">
                <strong style={{ color: 'var(--text)' }}>
                  {formatHours(progress.actualMinutes)}
                </strong>{' '}
                из {formatHours(progress.plannedMinutes)} · {pct(progress.progress)}
              </span>
            </div>
            <Progress
              accent
              value={progress.progress ?? 0}
              label={`${data.name}: ${formatHours(progress.actualMinutes)} из ${formatHours(progress.plannedMinutes)}`}
            />
            <span className="faint">
              проведено {progress.held} · пропущено {progress.missed} · посещаемость{' '}
              {pct(progress.attendance)} · прогноз к концу {pct(progress.forecast)}
            </span>
          </div>
        )}
        {data.continueHint && (
          <Alert>
            <strong>С чего продолжить:</strong> {data.continueHint}
          </Alert>
        )}
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <h3>Источники</h3>
            <Sources disciplineId={id} sources={data.sources} />
          </div>
          <div className="stack">
            <h3>Карточка</h3>
            <DisciplineForm
              key={data.id + data.durationMinutes + data.priority}
              initial={data}
              lockPlan={inSemester}
              submitLabel="Сохранить"
              onSubmit={(input) => run(() => api.patch(`/api/disciplines/${id}`, input))}
            />
          </div>
        </div>
        <ErrorText error={actionError} />
      </div>
    </Card>
  );
}

function DisciplineTile({
  d,
  selected,
  inSemester,
  onSelect,
}: {
  d: Discipline;
  selected: boolean;
  inSemester: boolean;
  onSelect: () => void;
}) {
  const style = useAccent(d.id);
  return (
    <button
      type="button"
      className={`discipline-card ${selected ? 'on' : ''}`}
      style={style}
      onClick={onSelect}
    >
      <div className="row between">
        <span className="swatch">
          <BookOpen size={18} />
        </span>
        {inSemester && <Badge tone="success">в семестре</Badge>}
        {d.archivedAt !== null && <Badge>архив</Badge>}
      </div>
      <h3 style={{ marginTop: 4 }}>{d.name}</h3>
      <div className="row" style={{ gap: 6 }}>
        <Badge tone={d.priority === 'main' ? 'primary' : 'violet'}>{PRIORITY[d.priority]}</Badge>
        <Badge>{formatDuration(d.durationMinutes)}</Badge>
      </div>
      <p className="goal">{d.goal}</p>
    </button>
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
  const [creating, setCreating] = useState(false);
  const { run, error: createError } = useAction();
  const list = data?.filter((d) => archived || d.archivedAt === null);

  const form = (
    <Card
      title="Новая дисциплина"
      icon={<NotebookPen size={19} color="var(--primary)" />}
      action={
        <Button
          variant="ghost"
          size="sm"
          icon={<X size={16} />}
          aria-label="Закрыть"
          onClick={() => setCreating(false)}
        />
      }
    >
      <DisciplineForm
        submitLabel="Добавить"
        onSubmit={async (input) => {
          const created = await run(() => api.post<Discipline>('/api/disciplines', input));
          if (created) {
            setCreating(false);
            setSelected(created.id);
          }
          return created;
        }}
      />
      <ErrorText error={createError} />
    </Card>
  );

  return (
    <>
      <PageHeader
        icon={<BookOpen size={24} />}
        title="Дисциплины"
        subtitle="Что изучаешь, зачем и по каким материалам"
        actions={
          <>
            <Segmented
              value={archived ? 'all' : 'active'}
              options={[
                { value: 'active', label: 'Активные' },
                { value: 'all', label: 'Вместе с архивом' },
              ]}
              onChange={(v) => setArchived(v === 'all')}
            />
            <Button icon={<Plus size={17} />} onClick={() => setCreating(true)}>
              Новая дисциплина
            </Button>
          </>
        }
      />
      <div className="stack-lg">
        {creating && form}
        {!list ? (
          <Loading error={error} />
        ) : list.length === 0 ? (
          !creating && (
            <Card>
              <Empty
                icon={<BookOpen size={26} />}
                title="Дисциплин пока нет"
                action={
                  <Button icon={<Plus size={17} />} onClick={() => setCreating(true)}>
                    Добавить первую
                  </Button>
                }
              >
                Добавь то, что хочешь изучать: цель, метрики и длительность занятия.
              </Empty>
            </Card>
          )
        ) : (
          <div className="grid-3">
            {list.map((d) => (
              <DisciplineTile
                key={d.id}
                d={d}
                selected={d.id === selected}
                inSemester={semesterDisciplineIds.includes(d.id)}
                onSelect={() => setSelected(d.id === selected ? null : d.id)}
              />
            ))}
          </div>
        )}
        {selected && (
          <DisciplineDetail
            key={selected}
            id={selected}
            inSemester={semesterDisciplineIds.includes(selected)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </>
  );
}

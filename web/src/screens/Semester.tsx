import {
  ArrowRight,
  CalendarCheck2,
  CalendarPlus,
  CalendarRange,
  Clock3,
  GitCompareArrows,
  Layers,
  ListChecks,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useColor } from '../colors';
import { BudgetView, SkeletonGrid } from '../components';
import { formatFrequency, formatHours, local, time } from '../format';
import { useAction, useApi } from '../hooks';
import type { AppSettings, ChangeView, Discipline, SemesterView, Today } from '../types';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Loading,
  Option,
  PageHeader,
  Segmented,
  Stat,
} from '../ui';

const dateLabel = (iso: string) => local(Date.parse(iso), 'UTC').setLocale('ru').toFormat('d MMMM');

function SemesterStats({ sem }: { sem: SemesterView }) {
  return (
    <div className="grid-4">
      <Stat
        icon={<CalendarRange size={16} />}
        label="Длительность"
        value={`${sem.fullWeeks} нед.`}
        note={
          sem.leadDays > 0
            ? `+ ${sem.leadDays} дн. в начале`
            : `${dateLabel(sem.startDate)} — ${dateLabel(sem.endDate)}`
        }
      />
      <Stat
        icon={<Clock3 size={16} />}
        label="Сейчас"
        value={
          sem.currentWeek !== null && sem.currentWeek > 0
            ? `${sem.currentWeek}-я неделя`
            : 'скоро старт'
        }
        note={`до ${dateLabel(sem.endDate)}`}
      />
      <Stat icon={<ListChecks size={16} />} label="Занятий в семестре" value={sem.sessionsCount} />
      <Stat
        icon={<Wallet size={16} />}
        label="В неделю"
        value={sem.budget ? formatHours(sem.budget.averageMinutes) : '—'}
        note={sem.budget ? `лимит ${formatHours(sem.budget.capMinutes)}` : undefined}
      />
    </div>
  );
}

function MovedRow({
  m,
  name,
  zone,
}: {
  m: SemesterView['moved'][number];
  name: string;
  zone: string;
}) {
  const color = useColor(m.disciplineId);
  const when = (t: number) =>
    `${local(t, zone).setLocale('ru').toFormat('ccc, d MMM')} ${time(t, zone)}`;
  return (
    <div className="row between">
      <span className="row" style={{ gap: 8 }}>
        <span className="dot" style={{ background: color.accent }} />
        <strong>{name}</strong>
        <span className="muted">
          {when(m.from)} <ArrowRight size={13} style={{ verticalAlign: -2 }} /> {when(m.to)}
        </span>
      </span>
      <span className="faint">{m.reason}</span>
    </div>
  );
}

function SemesterSummary({ sem, zone }: { sem: SemesterView; zone: string }) {
  const names = new Map(sem.disciplines.map((d) => [d.id, d.name]));
  return (
    <div className="stack-lg">
      {sem.warnings.map((w, i) => (
        <Alert tone="warning" key={i}>
          {w.message}
        </Alert>
      ))}
      <SemesterStats sem={sem} />
      {sem.budget && (
        <Card title="Бюджет недели" icon={<Wallet size={19} color="var(--primary)" />}>
          <BudgetView budget={sem.budget} disciplines={sem.disciplines} />
        </Card>
      )}
      <Card title="Типичная неделя" icon={<Layers size={19} color="var(--violet)" />}>
        <SkeletonGrid slots={sem.skeleton} names={names} />
      </Card>
      {sem.moved.length > 0 && (
        <Card
          title="Перенесено из-за событий в календаре"
          icon={<GitCompareArrows size={19} color="var(--primary)" />}
        >
          <div className="stack">
            {sem.moved.map((m) => (
              <MovedRow
                key={m.sessionId}
                m={m}
                name={names.get(m.disciplineId) ?? ''}
                zone={zone}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function DraftView({ draft, zone }: { draft: SemesterView; zone: string }) {
  const { run, error, busy } = useAction();
  return (
    <>
      <PageHeader
        title="Черновик семестра"
        subtitle={`${dateLabel(draft.startDate)} — ${dateLabel(draft.endDate)}. Пока не подтвердишь, в календаре ничего не появится.`}
        actions={
          <>
            <Button
              variant="ghost"
              icon={<Trash2 size={16} />}
              disabled={busy}
              onClick={() => {
                if (confirm('Удалить черновик?')) void run(() => api.del('/api/semesters/draft'));
              }}
            >
              Удалить
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw size={16} />}
              disabled={busy}
              onClick={() => void run(() => api.post('/api/semesters/draft/refresh'))}
            >
              Пересчитать
            </Button>
            {!draft.failure && (
              <Button
                icon={<CalendarCheck2 size={17} />}
                disabled={busy}
                onClick={() => void run(() => api.post('/api/semesters/draft/confirm'))}
              >
                Подтвердить и начать
              </Button>
            )}
          </>
        }
      />
      <div className="stack-lg">
        <ErrorText error={error} />
        {draft.failure ? (
          <Card>
            <div className="stack">
              <Alert tone="danger">{draft.failure.message}</Alert>
              {draft.compromises.length > 0 ? (
                <>
                  <p className="muted">Что можно сделать — подойдёт любой вариант:</p>
                  {draft.compromises.map((c) => (
                    <div key={c.index} className="option" style={{ cursor: 'default' }}>
                      <span className="grow">
                        <span className="title">{c.title}</span>
                        <span className="sub">
                          самая тяжёлая неделя — {formatHours(c.peakMinutes)}
                        </span>
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(() => api.post(`/api/semesters/draft/compromises/${c.index}`))
                        }
                      >
                        Выбрать
                      </Button>
                    </div>
                  ))}
                </>
              ) : (
                <p className="muted">
                  Подходящих компромиссов не нашлось — поменяй настройки или состав дисциплин.
                </p>
              )}
            </div>
          </Card>
        ) : (
          <SemesterSummary sem={draft} zone={zone} />
        )}
      </div>
    </>
  );
}

function DisciplineCheck({
  d,
  checked,
  onChange,
}: {
  d: Discipline;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const color = useColor(d.id);
  return (
    <label className="option" style={{ cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 17, height: 17, accentColor: 'var(--primary)' }}
      />
      <span className="dot" style={{ background: color.accent }} />
      <span className="grow">
        <span className="title">{d.name}</span>
        <span className="sub">{d.priority === 'main' ? 'основная' : 'дополнительная'}</span>
      </span>
    </label>
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
  if (disciplines.length === 0) return <Alert>Сначала добавь дисциплины.</Alert>;
  const ids = chosen ?? disciplines.map((d) => d.id);
  const fullWeeks = weeks ?? settings.defaultSemesterWeeks;

  return (
    <div className="stack-lg">
      <div className="grid-2">
        <Field label="Начало">
          <input
            className="input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field
          label="Полных недель"
          hint="Если начало не в понедельник, первые дни добавятся к ним"
        >
          <input
            className="input"
            type="number"
            min={1}
            max={52}
            value={fullWeeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
          />
        </Field>
      </div>
      <div className="field">
        Дисциплины семестра
        <div className="grid-2" style={{ gap: 10 }}>
          {disciplines.map((d) => (
            <DisciplineCheck
              key={d.id}
              d={d}
              checked={ids.includes(d.id)}
              onChange={(on) => setChosen(on ? [...ids, d.id] : ids.filter((x) => x !== d.id))}
            />
          ))}
        </div>
      </div>
      <div>
        <Button
          size="lg"
          icon={<CalendarPlus size={18} />}
          disabled={busy || ids.length === 0}
          onClick={() =>
            void run(() =>
              api.post('/api/semesters/draft', { startDate, fullWeeks, disciplineIds: ids }),
            )
          }
        >
          {busy ? 'Составляю…' : 'Составить расписание'}
        </Button>
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
        <Segmented
          value={type}
          options={[
            { value: 'add', label: 'Добавить' },
            { value: 'remove', label: 'Убрать' },
          ]}
          onChange={(v) => {
            setType(v);
            setDisciplineId('');
            setPreview(null);
          }}
        />
        <select
          className="select"
          style={{ width: 'auto', minWidth: 220 }}
          value={disciplineId}
          onChange={(e) => {
            setDisciplineId(e.target.value);
            setPreview(null);
            setCompromise(undefined);
          }}
        >
          <option value="">Выбери дисциплину…</option>
          {options.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={!disciplineId || busy}
          onClick={async () => {
            const result = await run(() =>
              api.post<ChangeView>('/api/semesters/active/changes/preview', body()),
            );
            if (result) setPreview(result);
          }}
        >
          Что изменится
        </Button>
      </div>
      {options.length === 0 && (
        <p className="faint">
          {type === 'add'
            ? 'Все дисциплины уже в семестре — новую можно создать в «Дисциплинах».'
            : 'Убирать нечего.'}
        </p>
      )}
      {preview && (
        <div className="card flat stack" style={{ background: 'var(--surface-2)' }}>
          <div className="row" style={{ gap: 14 }}>
            <span className="stat-inline">
              <span className="faint">Сейчас</span>
              <strong>{formatHours(preview.before.averageMinutes)}</strong>
            </span>
            <ArrowRight size={18} color="var(--text-3)" />
            <span className="stat-inline">
              <span className="faint">Станет</span>
              <strong>{preview.after ? formatHours(preview.after.averageMinutes) : '—'}</strong>
            </span>
            <span className="faint">в неделю · лимит {formatHours(preview.before.capMinutes)}</span>
          </div>
          {preview.frequencyChanges.map((c) => (
            <p key={c.disciplineId}>
              <strong>{c.name}</strong>: {c.from ? formatFrequency(c.from) : 'нет'} →{' '}
              {c.to ? formatFrequency(c.to) : 'убирается'}
            </p>
          ))}
          <div className="row" style={{ gap: 6 }}>
            <Badge tone="success">+{preview.addedSessions} занятий</Badge>
            <Badge tone="danger">−{preview.removedSessions} занятий</Badge>
            <span className="faint">Прошлое не меняется, прогресс сохраняется.</span>
          </div>
          {preview.failure && <Alert tone="danger">{preview.failure}</Alert>}
          {preview.compromises.map((c) => (
            <Option
              key={c.index}
              on={compromise === c.index}
              onClick={() => setCompromise(c.index)}
            >
              {c.title}
            </Option>
          ))}
          <div>
            <Button
              disabled={busy || (!preview.ok && compromise === undefined)}
              onClick={async () => {
                if (await run(() => api.post('/api/semesters/active/changes/apply', body()))) {
                  setPreview(null);
                  setDisciplineId('');
                }
              }}
            >
              Применить
            </Button>
          </div>
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
  const sem = today.semester;

  if (sem) {
    return (
      <>
        <PageHeader
          title="Семестр"
          subtitle={`${dateLabel(sem.startDate)} — ${dateLabel(sem.endDate)}`}
          actions={<Badge tone="success">идёт</Badge>}
        />
        <div className="stack-lg">
          <SemesterSummary sem={sem} zone={zone} />
          <Card
            title="Изменения посреди семестра"
            icon={<GitCompareArrows size={19} color="var(--violet)" />}
          >
            <ChangesPanel sem={sem} />
          </Card>
        </div>
      </>
    );
  }
  if (today.draftPending) {
    return draft ? (
      <DraftView draft={draft} zone={zone} />
    ) : (
      <>
        <PageHeader title="Черновик семестра" />
        <Loading error={error} height={300} />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Новый семестр"
        subtitle="Выбери даты и дисциплины — расписание составится вокруг календаря"
      />
      <Card>
        <NewSemesterForm zone={zone} now={today.now} />
      </Card>
    </>
  );
}

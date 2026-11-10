import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Copy,
  Layers,
  NotebookPen,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { useAccent } from '../colors';
import { useApi } from '../hooks';
import type { PracticeSummary, Today } from '../types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorText,
  Field,
  Loading,
  PageHeader,
  Segmented,
} from '../ui';

const PAGE_SIZE = 12;
const NO_RECORDS: PracticeSummary[] = [];

const SummaryRow = memo(function SummaryRow({
  summary,
  checked,
  disabled,
  toggle,
  formatter,
}: {
  summary: PracticeSummary;
  checked: boolean;
  disabled: boolean;
  toggle: (id: string) => void;
  formatter: Intl.DateTimeFormat;
}) {
  const [open, setOpen] = useState(false);
  const style = useAccent(summary.disciplineId);
  const date = useMemo(
    () => formatter.format(summary.sessionStart),
    [formatter, summary.sessionStart],
  );
  return (
    <article className={`practice-note ${checked ? 'is-selected' : ''}`} style={style}>
      <label className="practice-note-pick">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled && !checked}
          onChange={() => toggle(summary.id)}
          aria-label={`Выбрать: ${summary.disciplineName}, ${date}`}
        />
        <span className="practice-note-body">
          <span className="practice-note-meta">
            <strong>
              <span className="dot" />
              {summary.disciplineName}
            </strong>
            <time dateTime={new Date(summary.sessionStart).toISOString()}>{date}</time>
          </span>
          <span className="practice-note-preview">
            {(summary.retelling || summary.keyConcepts).slice(0, 200)}
          </span>
        </span>
      </label>
      <button
        type="button"
        className="practice-note-expand"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Свернуть запись' : 'Читать полностью'}
      </button>
      {open && (
        <div className="practice-note-full">
          {summary.keyConcepts && (
            <p>
              <strong>Ключевые понятия</strong>
              {summary.keyConcepts}
            </p>
          )}
          {summary.retelling && (
            <p>
              <strong>Описание</strong>
              {summary.retelling}
            </p>
          )}
          {summary.continueFrom && (
            <p>
              <strong>С чего продолжить</strong>
              {summary.continueFrom}
            </p>
          )}
          {summary.nextQuestion && (
            <p>
              <strong>Вопрос следующему себе</strong>
              {summary.nextQuestion}
            </p>
          )}
        </div>
      )}
    </article>
  );
});

/** Список не перерисовывается при вводе пожелания или редактировании промпта. */
const RecordsPicker = memo(function RecordsPicker({
  data,
  selectedIds,
  toggle,
  replace,
  timezone,
}: {
  data: PracticeSummary[];
  selectedIds: string[];
  toggle: (id: string) => void;
  replace: (ids: string[]) => void;
  timezone: string;
}) {
  const [discipline, setDiscipline] = useState('');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase('ru'));
  const [onlySelected, setOnlySelected] = useState(false);
  const [page, setPage] = useState(0);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat('ru-RU', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [timezone],
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const names = useMemo(
    () => [...new Map(data.map((s) => [s.disciplineId, s.disciplineName]))],
    [data],
  );
  const indexed = useMemo(
    () =>
      data.map((s) => ({
        summary: s,
        text: `${s.disciplineName}\n${s.keyConcepts}\n${s.retelling}\n${s.continueFrom}\n${s.nextQuestion ?? ''}`.toLocaleLowerCase(
          'ru',
        ),
      })),
    [data],
  );
  const filtered = useMemo(
    () =>
      indexed
        .filter(
          ({ summary: s, text }) =>
            (!discipline || s.disciplineId === discipline) &&
            (!onlySelected || selected.has(s.id)) &&
            (!deferredSearch || text.includes(deferredSearch)),
        )
        .map((s) => s.summary),
    [indexed, discipline, onlySelected, selected, deferredSearch],
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [currentPage, discipline, deferredSearch, onlySelected]);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const latest = data.find((s) => !discipline || s.disciplineId === discipline);
  return (
    <Card
      className="practice-library"
      title={<>Итоги занятий</>}
      action={<Badge>{data.length} записей</Badge>}
    >
      <div className="stack">
        <div className="practice-search">
          <Search size={17} />
          <input
            aria-label="Поиск по записям"
            placeholder="Найти тему или слово в записях"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          {search && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => {
                setSearch('');
                setPage(0);
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <select
          aria-label="Дисциплина"
          className="select"
          value={discipline}
          onChange={(e) => {
            setDiscipline(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Все дисциплины</option>
          {names.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <div className="practice-library-tools">
          <div className="practice-tabs" role="group" aria-label="Какие записи показать">
            <button
              type="button"
              aria-pressed={!onlySelected}
              onClick={() => {
                setOnlySelected(false);
                setPage(0);
              }}
            >
              Все
            </button>
            <button
              type="button"
              aria-pressed={onlySelected}
              onClick={() => {
                setOnlySelected(true);
                setPage(0);
              }}
            >
              Выбранные <span>{selectedIds.length}</span>
            </button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!latest}
            onClick={() => replace(latest ? [latest.id] : [])}
          >
            Выбрать последнее занятие
          </Button>
        </div>

        <div
          className="practice-note-list"
          ref={listRef}
          tabIndex={0}
          aria-label="Список итогов занятий"
          aria-busy={search.trim().toLocaleLowerCase('ru') !== deferredSearch}
        >
          {visible.length ? (
            visible.map((s) => (
              <SummaryRow
                key={s.id}
                summary={s}
                checked={selected.has(s.id)}
                disabled={selected.size >= 100}
                toggle={toggle}
                formatter={formatter}
              />
            ))
          ) : (
            <div className="practice-no-results">
              <Search size={24} />
              <strong>
                {onlySelected && !selectedIds.length
                  ? 'Пока ничего не выбрано'
                  : 'Записи не найдены'}
              </strong>
              <span>Попробуй другую дисциплину или измени поиск.</span>
            </div>
          )}
        </div>
        {filtered.length > PAGE_SIZE && (
          <div className="practice-pagination">
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft size={16} />}
              aria-label="Предыдущая страница"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            />
            <span>
              {currentPage * PAGE_SIZE + 1}–
              {Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} из {filtered.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowRight size={16} />}
              aria-label="Следующая страница"
              disabled={currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            />
          </div>
        )}
      </div>
    </Card>
  );
});

/** Большой текст монтируется только при раскрытии; ввод не обновляет весь экран. */
function PromptResult({ initial, stale }: { initial: string; stale: boolean }) {
  const [open, setOpen] = useState(false);
  const [editorInitial, setEditorInitial] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [hasText, setHasText] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState(0);
  const draft = useRef(initial);
  const editor = useRef<HTMLTextAreaElement>(null);
  const resultPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    resultPanel.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  useEffect(() => {
    if (manualCopy && open) {
      editor.current?.focus();
      editor.current?.select();
    }
  }, [manualCopy, open]);
  async function copy() {
    setError(null);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(draft.current);
      setCopied(true);
    } catch {
      setEditorInitial(draft.current);
      setOpen(true);
      setManualCopy((v) => v + 1);
      setError(
        'Не удалось скопировать автоматически. Текст выделен — нажми Ctrl+C или скопируй вручную.',
      );
    }
  }
  return (
    <section
      ref={resultPanel}
      className={`practice-result ${stale ? 'is-stale' : ''}`}
      aria-label="Готовый промпт"
    >
      <div className="practice-result-heading">
        <span className="practice-result-icon">
          <CheckCheck size={20} />
        </span>
        <div>
          <strong>{stale ? 'Промпт нужно обновить' : 'Промпт готов'}</strong>
          <p>
            {stale
              ? 'Выбор или настройки изменились. Нажми «Пересобрать промпт».'
              : 'Скопируй в чат с ИИ и переходи к заданию.'}
          </p>
        </div>
      </div>
      <Button
        className="practice-wide"
        icon={copied && !stale ? <Check size={17} /> : <Copy size={17} />}
        disabled={stale || !hasText}
        onClick={() => void copy()}
      >
        {copied && !stale ? 'Скопировано' : 'Скопировать промпт'}
      </Button>
      <button
        type="button"
        className="practice-preview-toggle"
        aria-expanded={open}
        onClick={() => {
          if (!open) setEditorInitial(draft.current);
          setOpen(!open);
        }}
      >
        {open ? 'Скрыть текст' : 'Посмотреть и изменить текст'}
      </button>
      {open && (
        <Field label="Текст промпта">
          <textarea
            ref={editor}
            className="input practice-prompt"
            rows={12}
            defaultValue={editorInitial}
            onChange={(e) => {
              draft.current = e.target.value;
              setCopied(false);
              setHasText(e.target.value.trim().length > 0);
            }}
          />
        </Field>
      )}
      <ErrorText error={error} />
      <span className="sr-only" role="status">
        {copied && !stale ? 'Промпт скопирован' : ''}
      </span>
    </section>
  );
}

export function PracticeScreen({ today }: { today: Today }) {
  const { data, error: loadError } = useApi<PracticeSummary[]>('/api/practice/summaries');
  const [step, setStep] = useState<'records' | 'task'>('records');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<'single' | 'interdisciplinary'>('single');
  const [minutes, setMinutes] = useState('30');
  const [difficulty, setDifficulty] = useState<'reinforce' | 'challenge'>('reinforce');
  const [wish, setWish] = useState('');
  const [result, setResult] = useState<{
    prompt: string;
    inputKey: string;
    version: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const records = data ?? NO_RECORDS;
  const byId = useMemo(() => new Map(records.map((s) => [s.id, s])), [records]);
  const selected = useMemo(
    () => selectedIds.map((id) => byId.get(id)).filter((s): s is PracticeSummary => !!s),
    [byId, selectedIds],
  );
  const recordsKey = useMemo(() => JSON.stringify(selected), [selected]);
  const input = useMemo(
    () => ({ summaryIds: selectedIds, mode, minutes: Number(minutes), difficulty, wish }),
    [selectedIds, mode, minutes, difficulty, wish],
  );
  const inputKey = useMemo(() => JSON.stringify(input) + recordsKey, [input, recordsKey]);
  const groups = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const s of selected) {
      const item = counts.get(s.disciplineId);
      counts.set(s.disciplineId, {
        id: s.disciplineId,
        name: s.disciplineName,
        count: (item?.count ?? 0) + 1,
      });
    }
    return [...counts.values()];
  }, [selected]);
  const toggle = useCallback(
    (id: string) =>
      setSelectedIds((ids) =>
        ids.includes(id) ? ids.filter((s) => s !== id) : ids.length < 100 ? [...ids, id] : ids,
      ),
    [],
  );
  const missing = selectedIds.length !== selected.length;
  const interdisciplinaryReady = groups.length >= 2;
  const canGenerate =
    selected.length > 0 && !missing && (mode !== 'interdisciplinary' || interdisciplinaryReady);
  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const value = await api.post<{ prompt: string }>('/api/practice/prompt', input);
      setResult((r) => ({ prompt: value.prompt, inputKey, version: (r?.version ?? 0) + 1 }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const header = <PageHeader icon={<NotebookPen size={24} />} title="Практика" />;
  if (!data)
    return (
      <>
        {header}
        <Loading error={loadError} />
      </>
    );
  if (!data.length)
    return (
      <>
        {header}
        <Card>
          <Empty icon={<NotebookPen size={30} />} title="Первое задание начинается с записи">
            Сохрани итог занятия на экране «Сегодня», чтобы собрать по нему задание.
          </Empty>
        </Card>
      </>
    );
  return (
    <div className="practice-page">
      {header}
      <ErrorText error={loadError} />
      <div className="practice-flow">
        <div className="stats-nav library-nav" role="group" aria-label="Этап практики">
          <button
            type="button"
            aria-pressed={step === 'records'}
            onClick={() => setStep('records')}
          >
            Выбор занятий
          </button>
          <button type="button" aria-pressed={step === 'task'} onClick={() => setStep('task')}>
            Задание{selected.length > 0 && ` · ${selected.length}`}
          </button>
        </div>
        <div hidden={step !== 'records'}>
          <RecordsPicker
            data={data}
            selectedIds={selectedIds}
            toggle={toggle}
            replace={setSelectedIds}
            timezone={today.timezone}
          />
          <div className="practice-forward">
            <span>
              {selected.length
                ? `Выбрано занятий: ${selected.length}`
                : 'Выбери хотя бы одно занятие'}
            </span>
            <Button disabled={!selected.length} onClick={() => setStep('task')}>
              К заданию →
            </Button>
          </div>
        </div>
        <div hidden={step !== 'task'}>
          <aside className="practice-compose" aria-label="Настройки практики">
            {result && (
              <PromptResult
                key={result.version}
                initial={result.prompt}
                stale={result.inputKey !== inputKey}
              />
            )}
            <Card title={<>Параметры задания</>}>
              <div className="stack-lg">
                <div className="practice-chosen">
                  <div className="row between">
                    <strong>
                      {selected.length ? (
                        `Выбрано занятий: ${selected.length}`
                      ) : (
                        <button type="button" onClick={() => setStep('records')}>
                          Выбрать занятия →
                        </button>
                      )}
                    </strong>
                    {selectedIds.length > 0 && (
                      <button type="button" onClick={() => setSelectedIds([])}>
                        Сбросить
                      </button>
                    )}
                  </div>
                  {groups.length > 0 && (
                    <div className="practice-chosen-subjects">
                      {groups.map((g) => (
                        <span key={g.id}>
                          {g.name} <b>{g.count}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  {selectedIds.length >= 100 && (
                    <p className="faint">Достигнут лимит: 100 записей.</p>
                  )}
                </div>
                {missing && (
                  <Alert tone="warning">
                    Часть записей больше недоступна.{' '}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedIds(selected.map((s) => s.id))}
                    >
                      Убрать недоступные
                    </Button>
                  </Alert>
                )}
                <div className="field">
                  Формат
                  <div className="practice-format">
                    <button
                      type="button"
                      aria-pressed={mode === 'single'}
                      onClick={() => setMode('single')}
                    >
                      <NotebookPen size={19} />
                      <strong>Обычное</strong>
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === 'interdisciplinary'}
                      onClick={() => setMode('interdisciplinary')}
                    >
                      <Layers size={19} />
                      <strong>На стыке тем</strong>
                    </button>
                  </div>
                </div>
                {mode === 'interdisciplinary' && !interdisciplinaryReady && (
                  <p className="practice-inline-hint">Добавь занятия хотя бы из двух дисциплин.</p>
                )}
                <div className="field">
                  Время на задание
                  <Segmented
                    value={minutes}
                    onChange={setMinutes}
                    options={[
                      { value: '15', label: '15 мин' },
                      { value: '30', label: '30 мин' },
                      { value: '60', label: '60 мин' },
                    ]}
                  />
                </div>
                <div className="field">
                  Сложность
                  <Segmented
                    value={difficulty}
                    onChange={setDifficulty}
                    options={[
                      { value: 'reinforce', label: 'Закрепить основы' },
                      { value: 'challenge', label: 'Посложнее' },
                    ]}
                  />
                </div>
                <details className="lesson-next">
                  <summary>Добавить пожелание к заданию</summary>
                  <Field label="На чём сделать акцент?">
                    <textarea
                      className="input"
                      rows={2}
                      maxLength={2000}
                      value={wish}
                      onChange={(e) => setWish(e.target.value)}
                      placeholder="Например: путаюсь в JOIN, хочу разобраться на примере"
                    />
                  </Field>
                </details>
                <div>
                  <Button
                    className="practice-wide"
                    icon={<Sparkles size={17} />}
                    disabled={!canGenerate || busy}
                    onClick={() => void generate()}
                  >
                    {busy ? 'Собираю…' : result ? 'Пересобрать промпт' : 'Собрать промпт'}
                  </Button>
                  <p className="practice-local-note">Скопируй текст в любой чат с ИИ</p>
                  {result && (
                    <p className="practice-local-note">Пересборка заменит ручные правки текста.</p>
                  )}
                </div>
                <ErrorText error={error} />
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

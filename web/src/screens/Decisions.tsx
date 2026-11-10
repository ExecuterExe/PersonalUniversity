import {
  CalendarClock,
  CalendarX2,
  Check,
  Flag,
  Gauge,
  Inbox,
  PartyPopper,
  Scale,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useConfirm } from '../confirm';
import { useAccent, useColor } from '../colors';
import { formatHours, formatPercent, local, time } from '../format';
import { useAction, useApi } from '../hooks';
import type { CheckpointReview, DecisionView, MakeupPreview, MoveOption, Today } from '../types';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorText,
  Loading,
  Option,
  PageHeader,
  Progress,
} from '../ui';

const pct = (v: number | null) => (v === null ? '—' : formatPercent(v));

const KIND: Record<DecisionView['kind'], { icon: LucideIcon; color: string }> = {
  missed: { icon: CalendarX2, color: 'var(--danger)' },
  conflict: { icon: TriangleAlert, color: 'var(--warning)' },
  calibration: { icon: Gauge, color: 'var(--primary)' },
  checkpoint: { icon: Flag, color: 'var(--violet)' },
  'calendar-edit': { icon: CalendarClock, color: 'var(--primary)' },
};

function OptionText({ o, zone }: { o: MoveOption; zone: string }) {
  return (
    <span className="row between" style={{ width: '100%' }}>
      <span>
        <strong>{local(o.start, zone).setLocale('ru').toFormat('ccc, d MMMM')}</strong>,{' '}
        {time(o.start, zone)}–{time(o.end, zone)}{' '}
        <span className="faint">· {o.label.split(' · ')[1]}</span>
      </span>
      {o.weekLoadAfter !== o.weekLoadBefore && (
        <span className="faint">
          неделя {formatHours(o.weekLoadBefore)} → {formatHours(o.weekLoadAfter)}
        </span>
      )}
    </span>
  );
}

function SessionLine({ d, zone }: { d: DecisionView; zone: string }) {
  const color = useColor(d.session?.disciplineId ?? '');
  if (!d.session) return null;
  return (
    <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="dot" style={{ background: color.accent }} />
      <span>
        {d.session.disciplineName} ·{' '}
        {local(d.session.start, zone).setLocale('ru').toFormat('cccc, d MMMM')},{' '}
        {time(d.session.start, zone)}–{time(d.session.end, zone)}
      </span>
    </p>
  );
}

/** Дисциплина в обзоре контрольной точки: факт против плана, цель и метрики рядом. */
function ReviewRow({ s }: { s: CheckpointReview['disciplines'][number] }) {
  const style = useAccent(s.disciplineId);
  const color = useColor(s.disciplineId);
  return (
    <div className="card flat" style={{ ...style, padding: 16 }}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="row between">
          <span className="row" style={{ gap: 8 }}>
            <span className="dot" style={{ background: color.accent }} />
            <strong>{s.name}</strong>
          </span>
          <span className="faint">
            {formatHours(s.actualMinutes)} из {formatHours(s.plannedMinutes)} · посещаемость{' '}
            {pct(s.attendance)} ({s.held} из {s.held + s.missed}) · прогноз {pct(s.forecast)}
          </span>
        </div>
        <Progress
          accent
          value={s.progress ?? 0}
          label={`${s.name}: ${formatHours(s.actualMinutes)} из ${formatHours(s.plannedMinutes)}`}
        />
        <p className="small muted">
          <strong>Цель:</strong> {s.goal}
        </p>
        <p className="small muted">
          <strong>Метрики:</strong> {s.metrics}
        </p>
      </div>
    </div>
  );
}

function CheckpointReviewView({ d, today }: { d: DecisionView; today: Today }) {
  const review = d.checkpoint!;
  const { run, error, busy } = useAction();
  const [weeks, setWeeks] = useState(2);
  const [biweekly, setBiweekly] = useState('');
  const [archive, setArchive] = useState<string[]>([]);
  const weekly = (today.semester?.disciplines ?? []).filter((x) => x.frequency === 1);
  const resolve = (body: object) => run(() => api.post(`/api/decisions/${d.id}/resolve`, body));

  return (
    <div className="stack-lg">
      {review.forecast.overall !== null && (
        <Alert tone={review.forecast.overall >= 0.7 ? 'success' : 'warning'}>
          При текущем темпе к концу семестра получится примерно {pct(review.forecast.overall)}{' '}
          плана.
        </Alert>
      )}
      <div className="stack">
        {review.disciplines.map((s) => (
          <ReviewRow key={s.disciplineId} s={s} />
        ))}
      </div>
      {review.facts.map((f) => (
        <Alert key={f}>{f}</Alert>
      ))}
      {review.calibration.map((c) => (
        <p key={c.disciplineId} className="faint">
          Подсказка: занятия в среднем {Math.round(c.medianActualMinutes)} из {c.currentMinutes} мин
          — можно сделать {c.suggestedMinutes}.
        </p>
      ))}
      <div className="row">
        {d.actions.includes('ack') && (
          <Button
            icon={<Check size={16} />}
            disabled={busy}
            onClick={() => void resolve({ action: 'ack' })}
          >
            Всё в порядке, продолжаем
          </Button>
        )}
        <input
          className="input narrow"
          type="number"
          min={1}
          max={8}
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
        />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void resolve({ action: 'extend', weeks })}
        >
          Продлить семестр на {weeks} нед.
        </Button>
      </div>
      {d.actions.includes('biweekly') && weekly.length > 0 && (
        <div className="row">
          <select
            className="select"
            style={{ width: 'auto' }}
            value={biweekly}
            onChange={(e) => setBiweekly(e.target.value)}
          >
            <option value="">Дисциплина раз в неделю…</option>
            {weekly.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={!biweekly || busy}
            onClick={() => void resolve({ action: 'biweekly', disciplineId: biweekly })}
          >
            Сделать раз в 2 недели
          </Button>
        </div>
      )}
      {d.actions.includes('finish') && (
        <div className="stack">
          <p className="muted">Что отправить в архив? Остальные можно взять в новый семестр.</p>
          {review.disciplines.map((s) => (
            <label className="check" key={s.disciplineId}>
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
            <Button
              icon={<PartyPopper size={16} />}
              disabled={busy}
              onClick={() => void resolve({ action: 'finish', archive })}
            >
              Завершить семестр
            </Button>
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
  const { icon: Icon, color } = KIND[d.kind];
  const hasOptions = (d.options?.length ?? 0) > 0;

  return (
    <Card title={d.title} icon={<Icon size={20} color={color} />}>
      <div className="stack">
        <SessionLine d={d} zone={zone} />
        {d.events?.map((e, i) => (
          <p key={i} className="faint">
            Событие «{e.title}»: {local(e.start, zone).setLocale('ru').toFormat('d MMMM')},{' '}
            {time(e.start, zone)}–{time(e.end, zone)}
          </p>
        ))}

        {d.kind === 'checkpoint' && <CheckpointReviewView d={d} today={today} />}

        {(d.kind === 'missed' || d.kind === 'conflict') &&
          (d.options && d.options.length > 0 ? (
            <div className="stack" style={{ gap: 8 }}>
              {d.options.map((o) => (
                <Option key={o.start} on={choice === o.start} onClick={() => setChoice(o.start)}>
                  <OptionText o={o} zone={zone} />
                </Option>
              ))}
            </div>
          ) : (
            <p className="faint">Подходящего места для переноса нет.</p>
          ))}

        {d.compromises && d.compromises.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <p className="muted">Можно так — только для этого занятия:</p>
            {d.compromises.map((c) => (
              <Option
                key={c.index}
                on={compromise === c.index}
                onClick={() => setCompromise(c.index)}
              >
                {c.title}
              </Option>
            ))}
          </div>
        )}
        {d.skeletonChange && (
          <Alert>Похоже, это постоянное событие. {d.skeletonChange.description}?</Alert>
        )}

        <div className="row">
          {has('makeup') && hasOptions && (
            <Button
              disabled={choice === undefined || busy}
              onClick={() => void resolve({ action: 'makeup', start: choice })}
            >
              Отработать
            </Button>
          )}
          {has('leave') && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void resolve({ action: 'leave' })}
            >
              Оставить пропущенным
            </Button>
          )}
          {has('move') && hasOptions && (
            <Button
              disabled={choice === undefined || busy}
              onClick={() => void resolve({ action: 'move', start: choice })}
            >
              Перенести
            </Button>
          )}
          {has('compromise') && d.compromises && d.compromises.length > 0 && (
            <Button
              disabled={compromise === undefined || busy}
              onClick={() => void resolve({ action: 'compromise', index: compromise })}
            >
              Согласиться
            </Button>
          )}
          {has('skeleton') && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void resolve({ action: 'skeleton' })}
            >
              Перенести насовсем
            </Button>
          )}
          {has('skip') && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void resolve({ action: 'skip' })}
            >
              Пропустить занятие
            </Button>
          )}
          {has('keep') && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void resolve({ action: 'keep' })}
            >
              {d.kind === 'calendar-edit' ? 'Оставить так' : 'Оставить как есть'}
            </Button>
          )}
          {has('revert') && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void resolve({ action: 'revert' })}
            >
              Вернуть как было
            </Button>
          )}
          {has('restore') && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void resolve({ action: 'restore' })}
            >
              Вернуть в календарь
            </Button>
          )}
          {has('accept') && (
            <Button disabled={busy} onClick={() => void resolve({ action: 'accept' })}>
              Да, сделать
            </Button>
          )}
          {has('dismiss') && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void resolve({ action: 'dismiss' })}
            >
              Нет, оставить
            </Button>
          )}
        </div>
        <ErrorText error={error} />
      </div>
    </Card>
  );
}

export function DecisionsScreen({ today }: { today: Today }) {
  const { data, error } = useApi<DecisionView[]>('/api/decisions');
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [opened, setOpened] = useState<string | null>(null);
  const [preview, setPreview] = useState<MakeupPreview | null>(null);
  const { run, error: actionError, busy } = useAction();
  const confirm = useConfirm();
  const header = <PageHeader icon={<Inbox size={24} />} title="Решения" />;
  if (!data) {
    return (
      <>
        {header}
        <Loading error={error} />
      </>
    );
  }
  if (data.length === 0) {
    return (
      <>
        {header}
        <section className="decisions-clear">
          <span>
            <Check size={24} />
          </span>
          <div>
            <h2>На сегодня всё разобрано</h2>
            <p>Открытых вопросов нет.</p>
            <a href="#today">Перейти к занятиям →</a>
          </div>
        </section>
        <ErrorText error={error} />
      </>
    );
  }
  // Пропуски и конфликты — по времени занятия, остальное — по времени вопроса.
  const sorted = [...data].sort(
    (a, b) => (a.session?.start ?? a.createdAt) - (b.session?.start ?? b.createdAt),
  );
  const chosenMissed = data.filter((d) => d.kind === 'missed' && choices[d.id] !== undefined);
  const active = sorted.find((d) => d.id === opened) ?? sorted[0]!;
  const allMissed = data.filter((d) => d.kind === 'missed');
  const lead = today.semester?.leadDays ?? 0;

  // После отпуска или болезни пропусков много — разобрать их одним действием (раздел 8).
  const leaveAll = async () => {
    if (
      !(await confirm({
        title: `Оставить все пропуски (${allMissed.length}) как есть?`,
        text: 'Отрабатывать их не нужно.',
        ok: 'Оставить все',
      }))
    )
      return;
    void run(async () => {
      for (const d of allMissed) {
        await api.post(`/api/decisions/${d.id}/resolve`, { action: 'leave' });
      }
    });
  };

  return (
    <>
      {header}
      <div className="decision-home">
        <ErrorText error={error} />
        <div className="decision-workspace">
          <nav className="decision-queue" aria-label="Открытые вопросы">
            <h2>
              Требуют решения <small>{sorted.length}</small>
            </h2>
            <div className="decision-list">
              {sorted.map((d) => {
                const { icon: Icon, color } = KIND[d.kind];
                return (
                  <button
                    type="button"
                    key={d.id}
                    aria-pressed={d.id === active.id}
                    onClick={() => setOpened(d.id)}
                  >
                    <Icon size={17} color={color} />
                    <span>
                      <strong>{d.title}</strong>
                      <small>
                        {d.session ? d.session.disciplineName + ' · ' : ''}
                        {local(d.session?.start ?? d.createdAt, today.timezone)
                          .setLocale('ru')
                          .toFormat('d MMM, HH:mm')}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            <select
              className="select decision-select"
              aria-label="Выбрать вопрос"
              value={active.id}
              onChange={(e) => setOpened(e.target.value)}
            >
              {sorted.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ·{' '}
                  {local(d.session?.start ?? d.createdAt, today.timezone).toFormat('dd.MM HH:mm')}
                </option>
              ))}
            </select>
          </nav>
          <div className="decision-detail">
            {sorted.map((d) => (
              <div key={d.id} hidden={active.id !== d.id}>
                <DecisionCard
                  d={d}
                  today={today}
                  choice={choices[d.id]}
                  setChoice={(start) => {
                    setChoices((v) => ({ ...v, [d.id]: start }));
                    setPreview(null);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="stack">
          {allMissed.length > 1 && (
            <Card className="tinted">
              <div className="row between">
                <span>
                  Пропусков: <strong>{allMissed.length}</strong>. Отработай нужные, а остальные
                  можно оставить разом.
                </span>
                <Button variant="secondary" disabled={busy} onClick={() => void leaveAll()}>
                  Оставить все как есть
                </Button>
              </div>
            </Card>
          )}
          {chosenMissed.length > 1 && (
            <Card
              title="Если отработать выбранное"
              icon={<Scale size={18} color="var(--primary)" />}
            >
              <div className="stack">
                <div>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      const result = await run(() =>
                        api.post<MakeupPreview>('/api/decisions/makeup-preview', {
                          choices: chosenMissed.map((d) => ({
                            decisionId: d.id,
                            start: choices[d.id],
                          })),
                        }),
                      );
                      if (result) setPreview(result);
                    }}
                  >
                    Посчитать нагрузку
                  </Button>
                </div>
                {preview?.weeks.map((w) => (
                  <div key={w.weekIndex} className="row between">
                    <span>Неделя {w.weekIndex + (lead ? 0 : 1)}</span>
                    <span className={w.overCap ? 'error-text' : 'muted'}>
                      {formatHours(w.beforeMinutes)} → {formatHours(w.afterMinutes)} из{' '}
                      {formatHours(w.capMinutes)}
                      {w.overCap && <Badge tone="danger">больше лимита</Badge>}
                    </span>
                  </div>
                ))}
                {preview && preview.invalid.length > 0 && (
                  <Alert tone="warning">
                    Некоторые варианты вместе не помещаются — выбери другие.
                  </Alert>
                )}
              </div>
            </Card>
          )}
          <ErrorText error={actionError} />
        </div>
      </div>
    </>
  );
}

import { durationMinutes, plannedFocusMinutes, plural, SESSION_FORMS } from '@ou/engine';
import {
  BarChart3,
  CalendarCheck2,
  Flame,
  Hourglass,
  LineChart,
  ChevronDown,
  PieChart,
  Wallet,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useAccent, useColor, useColors } from '../colors';
import { BudgetView } from '../components';
import { formatDuration, formatHours, formatPercent, local, weekStart } from '../format';
import { useApi } from '../hooks';
import type { AppSettings, SessionView, Stats, Today } from '../types';
import { Alert, Card, Empty, Loading, PageHeader, Progress, Segmented, ErrorText } from '../ui';

const pct = (v: number | null) => (v === null ? '—' : formatPercent(v));

type Row = Stats['disciplines'][number];

/** Строка дисциплины: факт против плана всего семестра, цифры — рядом с полосой. */
function DisciplineMeter({ s }: { s: Row }) {
  const style = useAccent(s.disciplineId);
  const color = useColor(s.disciplineId);
  return (
    <div className="stack" style={{ ...style, gap: 8 }}>
      <div className="row between">
        <span className="row" style={{ gap: 8 }}>
          <span className="dot" style={{ background: color.accent }} />
          <strong>{s.name}</strong>
        </span>
        <span className="muted">
          <strong style={{ color: 'var(--text)' }}>{formatHours(s.actualMinutes)}</strong> из{' '}
          {formatHours(s.plannedMinutes)} · {pct(s.progress)}
        </span>
      </div>
      <Progress
        accent
        value={s.progress ?? 0}
        label={`${s.name}: ${formatHours(s.actualMinutes)} из ${formatHours(s.plannedMinutes)}`}
      />
      <span className="faint">
        проведено {s.held} · пропущено {s.missed}
        {s.skipped > 0 && ` · отменено заранее ${s.skipped}`} · посещаемость {pct(s.attendance)} ·
        прогноз к концу {pct(s.forecast)}
      </span>
    </div>
  );
}

interface WeekBar {
  start: number;
  label: string;
  current: boolean;
  minutes: Map<string, number>;
  total: number;
}

/** Чистая учёба по неделям семестра, по дисциплинам. Только факт — план показан полосами выше. */
function WeeklyChart({ stats, today }: { stats: Stats; today: Today }) {
  const zone = today.timezone;
  const from = DateTime.fromISO(stats.semester.startDate, { zone }).toMillis();
  const end = DateTime.fromISO(stats.semester.endDate, { zone }).plus({ days: 1 }).toMillis();
  const to = Math.min(today.now, end);
  const { data, error } = useApi<SessionView[]>(
    to > from ? `/api/schedule?from=${from}&to=${to}` : null,
  );
  const needsSettings = data?.some((s) => s.status === 'held' && s.actualMinutes == null);
  const settings = useApi<AppSettings>(needsSettings ? '/api/settings' : null);
  const colorOf = useColors();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const series = stats.disciplines.map((d) => ({ id: d.disciplineId, name: d.name }));

  const card = (body: ReactNode) => (
    <Card
      title="Чистая учёба по неделям"
      icon={<LineChart size={19} color="var(--primary)" />}
      action={
        <Segmented
          value={view}
          options={[
            { value: 'chart', label: 'График' },
            { value: 'table', label: 'Таблица' },
          ]}
          onChange={setView}
        />
      }
    >
      {body}
    </Card>
  );
  if (to <= from) return card(<p className="muted">Семестр ещё не начался.</p>);
  if (!data || (needsSettings && !settings.data))
    return card(<Loading error={error ?? settings.error} height={160} />);

  const thisWeek = weekStart(today.now, zone);
  const weeks: WeekBar[] = [];
  for (let w = local(weekStart(from, zone), zone); w.toMillis() < to; w = w.plus({ weeks: 1 })) {
    weeks.push({
      start: w.toMillis(),
      // Первая неделя подписана датой начала семестра, а не понедельником до него.
      label: (w.toMillis() < from ? local(from, zone) : w)
        .setLocale('ru')
        .toFormat('d MMM')
        .replace('.', ''),
      current: w.toMillis() === thisWeek,
      minutes: new Map(),
      total: 0,
    });
  }
  for (const s of data) {
    if (s.status !== 'held') continue;
    const minutes =
      s.actualMinutes ?? plannedFocusMinutes(durationMinutes(s), settings.data!.pomodoro);
    const week = weeks.find((w) => w.start === weekStart(s.start, zone));
    if (!week) continue;
    week.minutes.set(s.disciplineId, (week.minutes.get(s.disciplineId) ?? 0) + minutes);
    week.total += minutes;
  }
  weeks.reverse();
  const max = Math.max(0, ...weeks.map((w) => w.total));
  if (!max)
    return card(
      <Empty icon={<LineChart size={26} />} title="Пока нет учебного времени">
        Здесь появятся недели с проведёнными занятиями.
      </Empty>,
    );

  if (view === 'table') {
    return card(
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Неделя с</th>
              {series.map((d) => (
                <th key={d.id} className="num">
                  {d.name}
                </th>
              ))}
              <th className="num">Всего</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start}>
                <td>{w.label}</td>
                {series.map((d) => (
                  <td key={d.id} className="num">
                    {formatDuration(w.minutes.get(d.id) ?? 0)}
                  </td>
                ))}
                <td className="num">{formatDuration(w.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  }

  return card(
    <div className="stats-weeks">
      {weeks.map((w) => (
        <details key={w.start} className="stats-week">
          <summary>
            <span className="stats-week-label">
              {w.label}
              {w.current && <small>Эта неделя</small>}
            </span>
            <span className="stats-week-track" aria-hidden="true">
              {series.map((d) => {
                const minutes = w.minutes.get(d.id);
                return minutes ? (
                  <i
                    key={d.id}
                    style={{ width: `${(minutes / max) * 100}%`, background: colorOf(d.id).accent }}
                  />
                ) : null;
              })}
            </span>
            <strong>{formatDuration(w.total)}</strong>
            <ChevronDown size={15} />
          </summary>
          <div className="stats-week-detail">
            {w.total ? (
              series
                .filter((d) => w.minutes.has(d.id))
                .map((d) => (
                  <div key={d.id}>
                    <span className="dot" style={{ background: colorOf(d.id).accent }} />
                    {d.name}
                    <strong>{formatDuration(w.minutes.get(d.id)!)}</strong>
                  </div>
                ))
            ) : (
              <span>Нет учебного времени</span>
            )}
          </div>
        </details>
      ))}
    </div>,
  );
}

function DisciplineTable({ rows }: { rows: Row[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Дисциплина</th>
            <th className="num">Факт</th>
            <th className="num">План</th>
            <th className="num">Прогресс</th>
            <th className="num">Проведено</th>
            <th className="num">Пропущено</th>
            <th className="num">Посещаемость</th>
            <th className="num">Прогноз</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.disciplineId}>
              <td>{s.name}</td>
              <td className="num">{formatHours(s.actualMinutes)}</td>
              <td className="num">{formatHours(s.plannedMinutes)}</td>
              <td className="num">{pct(s.progress)}</td>
              <td className="num">{s.held}</td>
              <td className="num">{s.missed}</td>
              <td className="num">{pct(s.attendance)}</td>
              <td className="num">{pct(s.forecast)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimeDistribution({ rows, total }: { rows: Row[]; total: number }) {
  const colorOf = useColors();
  const sorted = [...rows]
    .filter((d) => d.actualMinutes > 0)
    .sort((a, b) => b.actualMinutes - a.actualMinutes);
  return (
    <Card title="Время по дисциплинам" icon={<PieChart size={19} />}>
      {total ? (
        <>
          <div className="stats-band" aria-hidden="true">
            {sorted.map((d) => (
              <i
                key={d.disciplineId}
                style={{ flex: d.actualMinutes, background: colorOf(d.disciplineId).accent }}
              />
            ))}
          </div>
          <ul className="stats-shares">
            {sorted.map((d) => (
              <li key={d.disciplineId}>
                <span className="dot" style={{ background: colorOf(d.disciplineId).accent }} />
                <span>{d.name}</span>
                <strong>{formatDuration(d.actualMinutes)}</strong>
                <small>{formatPercent(d.actualMinutes / total)}</small>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Empty icon={<Hourglass size={26} />} title="Первое занятие ещё впереди">
          После занятия здесь будет видно, на какие дисциплины ушло время.
        </Empty>
      )}
    </Card>
  );
}

export function StatsScreen({ today }: { today: Today }) {
  const { data, error } = useApi<Stats | null>('/api/stats');
  const [view, setView] = useState<'bars' | 'table'>('bars');
  const [section, setSection] = useState<'overview' | 'weeks' | 'plan'>('overview');
  const header = (
    <PageHeader
      icon={<BarChart3 size={24} />}
      title="Статистика"
      subtitle={
        data
          ? [data.semester.startDate, data.semester.endDate]
              .map((date) => DateTime.fromISO(date).setLocale('ru').toFormat('d MMM yyyy'))
              .join(' — ')
          : undefined
      }
    />
  );
  if (data === undefined) {
    return (
      <>
        {header}
        <Loading error={error} height={300} />
      </>
    );
  }
  if (data === null) {
    return (
      <>
        {header}
        <Card>
          <Empty icon={<BarChart3 size={26} />} title="Статистики пока нет">
            Появится, когда начнётся семестр.
          </Empty>
        </Card>
      </>
    );
  }

  const rows = data.disciplines;
  const actual = rows.reduce((sum, s) => sum + s.actualMinutes, 0);
  const planned = rows.reduce((sum, s) => sum + s.plannedMinutes, 0);
  const held = rows.reduce((sum, s) => sum + s.held, 0);
  const missed = rows.reduce((sum, s) => sum + s.missed, 0);
  const names = new Map(rows.map((s) => [s.disciplineId, s.name]));

  return (
    <div className="stats-page">
      {header}
      <ErrorText error={error} />
      <section className="stats-summary" aria-label="Итоги семестра">
        <div className="stats-time">
          <span>
            <Hourglass size={16} />
            Чистое время учёбы
          </span>
          <strong>{formatDuration(actual)}</strong>
          <small>За семестр, без перерывов</small>
        </div>
        <div className="stats-metric">
          <span>
            <CalendarCheck2 size={16} />
            Посещаемость
          </span>
          <strong>{held + missed ? formatPercent(held / (held + missed)) : '—'}</strong>
          <small>
            Проведено {held} · пропущено {missed}
          </small>
        </div>
        <div className="stats-metric">
          <span>
            <Flame size={16} />
            Без пропусков
          </span>
          <strong>{data.streak}</strong>
          <small>{plural(data.streak, SESSION_FORMS)} подряд</small>
        </div>
      </section>
      <div className="stats-nav" role="group" aria-label="Раздел статистики">
        {(
          [
            { id: 'overview', label: 'Обзор' },
            { id: 'weeks', label: 'По неделям' },
            { id: 'plan', label: 'План' },
          ] as const
        ).map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={section === item.id}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {section === 'overview' && <TimeDistribution rows={rows} total={actual} />}
      {section === 'weeks' && <WeeklyChart key={data.semester.id} stats={data} today={today} />}
      {section === 'plan' && (
        <div className="stack-lg">
          <Card title="План семестра" icon={<BarChart3 size={18} />}>
            <div className="stats-plan-line">
              <strong>
                {formatDuration(actual)} из {formatDuration(planned)}
              </strong>
              <span>{planned ? formatPercent(actual / planned) : '—'}</span>
            </div>
            <Progress value={planned ? actual / planned : 0} label="Выполнение плана семестра" />
            <p className="stats-forecast">
              {data.forecast.overall === null
                ? 'Для прогноза пока мало данных.'
                : `Прогноз к концу семестра при текущем темпе — ${pct(data.forecast.overall)} плана.`}
            </p>
          </Card>
          <Card
            title="По дисциплинам"
            icon={<BarChart3 size={19} color="var(--primary)" />}
            action={
              <Segmented
                value={view}
                options={[
                  { value: 'bars', label: 'Полосы' },
                  { value: 'table', label: 'Таблица' },
                ]}
                onChange={setView}
              />
            }
          >
            {view === 'bars' ? (
              <div className="stack-lg">
                {rows.map((s) => (
                  <DisciplineMeter key={s.disciplineId} s={s} />
                ))}
              </div>
            ) : (
              <DisciplineTable rows={rows} />
            )}
          </Card>

          {data.calibration.length > 0 && (
            <div className="stack">
              {data.calibration.map((c) => (
                <Alert key={c.disciplineId}>
                  «{names.get(c.disciplineId)}»: медианная длительность занятий —{' '}
                  {Math.round(c.medianActualMinutes)} из {c.currentMinutes} мин — можно сделать{' '}
                  {c.suggestedMinutes}.
                </Alert>
              ))}
            </div>
          )}

          <Card title="Бюджет недели" icon={<Wallet size={19} color="var(--violet)" />}>
            <BudgetView budget={data.budget} disciplines={data.semester.disciplines} />
          </Card>
        </div>
      )}
    </div>
  );
}

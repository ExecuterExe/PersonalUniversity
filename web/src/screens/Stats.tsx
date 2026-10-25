import { plural, SESSION_FORMS } from '@ou/engine';
import {
  BarChart3,
  CalendarCheck2,
  Flame,
  Hourglass,
  LineChart,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useAccent, useColor, useColors } from '../colors';
import { BudgetView } from '../components';
import { formatHours, formatPercent, local, weekStart } from '../format';
import { useApi } from '../hooks';
import type { SessionView, Stats, Today } from '../types';
import { Alert, Card, Empty, Loading, PageHeader, Progress, Segmented, Stat } from '../ui';

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

/** Шаг шкалы, при котором делений не больше четырёх. */
function niceTop(maxHours: number): { top: number; step: number } {
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => maxHours / s <= 4) ?? 50;
  return { top: Math.max(step, Math.ceil(maxHours / step) * step), step };
}

const hoursLabel = (h: number) => `${String(h).replace('.', ',')} ч`;

/** Чистая учёба по неделям семестра, по дисциплинам. Только факт — план показан полосами выше. */
function WeeklyChart({ stats, today }: { stats: Stats; today: Today }) {
  const zone = today.timezone;
  const from = DateTime.fromISO(stats.semester.startDate, { zone }).toMillis();
  const { data, error } = useApi<SessionView[]>(`/api/schedule?from=${from}&to=${today.now}`);
  const colorOf = useColors();
  const [hover, setHover] = useState<number | null>(null);
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
  if (!data) return card(<Loading error={error} height={200} />);

  const thisWeek = weekStart(today.now, zone);
  const weeks: WeekBar[] = [];
  for (
    let w = local(weekStart(from, zone), zone);
    w.toMillis() <= thisWeek;
    w = w.plus({ weeks: 1 })
  ) {
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
    if (s.status !== 'held' || !s.actualMinutes) continue;
    const week = weeks.find((w) => w.start === weekStart(s.start, zone));
    if (!week) continue;
    week.minutes.set(s.disciplineId, (week.minutes.get(s.disciplineId) ?? 0) + s.actualMinutes);
    week.total += s.actualMinutes;
  }
  const { top, step } = niceTop(Math.max(0, ...weeks.map((w) => w.total)) / 60);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const empty = weeks.every((w) => w.total === 0);

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
                    {formatHours(w.minutes.get(d.id) ?? 0)}
                  </td>
                ))}
                <td className="num">{formatHours(w.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  }

  return card(
    <div className="stack">
      {series.length > 1 && (
        <div className="row" style={{ gap: 16 }}>
          {series.map((d) => (
            <span key={d.id} className="row small muted" style={{ gap: 6 }}>
              <span className="dot" style={{ background: colorOf(d.id).accent }} />
              {d.name}
            </span>
          ))}
        </div>
      )}
      <div className="wchart">
        <div className="wchart-plot">
          {ticks.map((t) => (
            <div key={t} className="wchart-grid" style={{ bottom: `${(t / top) * 100}%` }}>
              <span>{hoursLabel(t)}</span>
            </div>
          ))}
          <div className="wchart-cols">
            {weeks.map((w, i) => (
              <div
                key={w.start}
                className="wchart-col"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="wchart-stack" style={{ height: `${(w.total / 60 / top) * 100}%` }}>
                  {series
                    .filter((d) => (w.minutes.get(d.id) ?? 0) > 0)
                    .map((d) => (
                      <span
                        key={d.id}
                        style={{ flexGrow: w.minutes.get(d.id), background: colorOf(d.id).accent }}
                      />
                    ))}
                </div>
                {hover === i && (
                  <div
                    className={`wchart-tip ${i < 2 ? 'left' : i > weeks.length - 3 ? 'right' : ''}`}
                    style={{ bottom: `calc(${(w.total / 60 / top) * 100}% + 8px)` }}
                  >
                    <strong>Неделя с {w.label}</strong>
                    {series.map((d) => (
                      <span key={d.id} className="row between" style={{ gap: 12 }}>
                        <span className="row" style={{ gap: 6 }}>
                          <span className="dot" style={{ background: colorOf(d.id).accent }} />
                          {d.name}
                        </span>
                        {formatHours(w.minutes.get(d.id) ?? 0)}
                      </span>
                    ))}
                    <span className="row between" style={{ gap: 12 }}>
                      <span>Всего</span>
                      <strong>{formatHours(w.total)}</strong>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="wchart-x">
          {weeks.map((w) => (
            <span key={w.start} className={w.current ? 'current' : ''}>
              {w.label}
            </span>
          ))}
        </div>
      </div>
      {empty && (
        <p className="faint">Пока нет проведённых занятий — график заполнится по ходу семестра.</p>
      )}
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

export function StatsScreen({ today }: { today: Today }) {
  const { data, error } = useApi<Stats | null>('/api/stats');
  const [view, setView] = useState<'bars' | 'table'>('bars');
  const header = (
    <PageHeader title="Статистика" subtitle="Время — только чистая учёба, без перерывов Помодоро" />
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
    <>
      {header}
      <div className="stack-lg">
        <div className="grid-4">
          <Stat
            icon={<Flame size={16} color="var(--violet)" />}
            label="Серия без пропусков"
            value={data.streak}
            note={plural(data.streak, SESSION_FORMS) + ' подряд'}
          />
          <Stat
            icon={<Hourglass size={16} color="var(--primary)" />}
            label="Чистая учёба"
            value={formatHours(actual)}
            note={`из ${formatHours(planned)} за семестр`}
          />
          <Stat
            icon={<CalendarCheck2 size={16} color="var(--primary)" />}
            label="Посещаемость"
            value={held + missed > 0 ? formatPercent(held / (held + missed)) : '—'}
            note={`${held} из ${held + missed} ${plural(held + missed, SESSION_FORMS)}`}
          />
          <Stat
            icon={<TrendingUp size={16} color="var(--violet)" />}
            label="Прогноз к концу"
            value={pct(data.forecast.overall)}
            note={data.forecast.overall === null ? 'пока рано судить' : 'плана при нынешнем темпе'}
          />
        </div>

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
                «{names.get(c.disciplineId)}»: занятия в среднем идут{' '}
                {Math.round(c.medianActualMinutes)} из {c.currentMinutes} мин — можно сделать{' '}
                {c.suggestedMinutes}.
              </Alert>
            ))}
          </div>
        )}

        <WeeklyChart stats={data} today={today} />

        <Card title="Бюджет недели" icon={<Wallet size={19} color="var(--violet)" />}>
          <BudgetView budget={data.budget} disciplines={data.semester.disciplines} />
        </Card>
      </div>
    </>
  );
}

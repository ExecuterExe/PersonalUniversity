import { BudgetTable, Loading } from '../components';
import { formatHours, formatPercent } from '../format';
import { useApi } from '../hooks';
import type { Stats } from '../types';

const pct = (v: number | null) => (v === null ? '—' : formatPercent(v));

export function StatsScreen() {
  const { data, error } = useApi<Stats | null>('/api/stats');
  if (data === undefined) return <Loading error={error} />;
  if (data === null) {
    return (
      <section>
        <h2>Статистика</h2>
        <p className="muted">Появится, когда начнётся семестр.</p>
      </section>
    );
  }
  return (
    <>
      <section>
        <h2>Статистика семестра</h2>
        <p>
          Серия без пропусков: {data.streak} · прогноз к концу семестра:{' '}
          {pct(data.forecast.overall)} плана
        </p>
        <table>
          <thead>
            <tr>
              <th>Дисциплина</th>
              <th>Чистая учёба: факт / план</th>
              <th>Прогресс</th>
              <th>Проведено</th>
              <th>Пропущено</th>
              <th>Посещаемость</th>
              <th>Прогноз</th>
            </tr>
          </thead>
          <tbody>
            {data.disciplines.map((s) => (
              <tr key={s.disciplineId}>
                <td>{s.name}</td>
                <td>
                  {formatHours(s.actualMinutes)} / {formatHours(s.plannedMinutes)}
                </td>
                <td>{pct(s.progress)}</td>
                <td>{s.held}</td>
                <td>{s.missed}</td>
                <td>{pct(s.attendance)}</td>
                <td>{pct(s.forecast)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Время — только чистая учёба, без перерывов Помодоро.</p>
      </section>
      <section>
        <h2>Бюджет недели</h2>
        <BudgetTable budget={data.budget} disciplines={data.semester.disciplines} />
      </section>
    </>
  );
}

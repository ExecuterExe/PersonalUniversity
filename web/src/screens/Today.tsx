import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorText, Loading } from '../components';
import { countdown, formatDuration, ORIGIN, range, STATUS, time } from '../format';
import { useAction, useApi, useNow, useRefresh } from '../hooks';
import type { SessionDetails, SessionView, TimerView, Today } from '../types';

const PHASE = { focus: 'Фокус', break: 'Перерыв', 'long-break': 'Длинный перерыв' } as const;

/** Короткий сигнал при смене фазы Помодоро. */
function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Без звука — не страшно.
  }
}

/** Какую смену фазы уже отметили сигналом — общая на все перерисовки таймера. */
let signalledPhase = '';

/** Таймер считает сам между запросами; новые данные с сервера — новый экземпляр (см. key ниже). */
function TimerPanel({ view }: { view: TimerView }) {
  const { refresh } = useRefresh();
  const { run, error, busy } = useAction();
  const [base] = useState(() => ({ view, at: Date.now() }));
  const now = useNow(500);

  const v = base.view;
  const elapsed = v.paused ? 0 : now - base.at;
  const phaseLeft = v.phaseLengthMs - v.phaseElapsedMs - elapsed;
  const remaining = Math.max(0, v.plannedMs - v.activeMs - elapsed);
  const focus = v.focusMs + (v.phase === 'focus' && !v.paused ? elapsed : 0);

  useEffect(() => {
    const key = `${v.sessionId}-${v.cycle}-${v.phase}`;
    if (phaseLeft <= 0 && !v.paused && signalledPhase !== key) {
      signalledPhase = key;
      beep();
      refresh();
    }
  }, [phaseLeft, v.sessionId, v.cycle, v.phase, v.paused, refresh]);

  useEffect(() => {
    document.title = `${countdown(phaseLeft)} · ${PHASE[v.phase]}`;
    return () => {
      document.title = 'Мой университет';
    };
  }, [phaseLeft, v.phase]);

  const finish = () => {
    const early = remaining > 60_000;
    if (early && !confirm('Завершить раньше времени? Запишется, сколько было на самом деле.'))
      return;
    void run(() => api.post('/api/timer/finish'));
  };

  return (
    <div className="stack">
      <div className="muted">
        {PHASE[v.phase]} · цикл {v.cycle}
        {v.paused && ' · пауза'}
      </div>
      <div className="timer">{countdown(phaseLeft)}</div>
      <div className="muted">
        Чистая учёба: {Math.floor(focus / 60_000)} мин ·{' '}
        {remaining > 0 ? `до конца занятия ${countdown(remaining)}` : 'время занятия вышло'}
      </div>
      <div className="row">
        {v.paused ? (
          <button disabled={busy} onClick={() => void run(() => api.post('/api/timer/resume'))}>
            Продолжить
          </button>
        ) : (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(() => api.post('/api/timer/pause'))}
          >
            Пауза
          </button>
        )}
        <button className={remaining > 0 ? 'danger' : ''} disabled={busy} onClick={finish}>
          Завершить
        </button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function SessionInProgress({ timer }: { timer: TimerView }) {
  const { data, error } = useApi<SessionDetails>(`/api/sessions/${timer.sessionId}`);
  return (
    <section>
      <h2>Сейчас: {data?.session.disciplineName ?? '…'}</h2>
      <TimerPanel key={`${timer.activeMs}-${timer.paused}`} view={timer} />
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="stack">
          {data.continueHint && <p className="warning">С чего продолжить: {data.continueHint}</p>}
          <p className="muted">Цель: {data.goal}</p>
          {data.sources.length > 0 && (
            <>
              <h3>Источники</h3>
              <ul>
                {data.sources.map((s) => (
                  <li key={s.id}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Итог занятия: без него следующее не начнётся (методология, раздел 8). */
export function SummaryForm({ session, zone }: { session: SessionView; zone: string }) {
  const [keyConcepts, setKeyConcepts] = useState('');
  const [retelling, setRetelling] = useState('');
  const [continueFrom, setContinueFrom] = useState('');
  const { run, error, busy } = useAction();
  return (
    <section>
      <h2>Итог: {session.disciplineName}</h2>
      <p className="muted">
        {range(session.start, session.end, zone)}
        {session.actualMinutes !== undefined &&
          ` · чистая учёба ${formatDuration(session.actualMinutes)}`}
      </p>
      <p className="warning">Сначала попробуй вспомнить, не заглядывая в материалы.</p>
      <div className="stack">
        <label>
          Ключевые понятия
          <textarea value={keyConcepts} onChange={(e) => setKeyConcepts(e.target.value)} />
        </label>
        <label>
          Короткий пересказ
          <textarea value={retelling} onChange={(e) => setRetelling(e.target.value)} />
        </label>
        <p className="muted">Достаточно заполнить одно из двух.</p>
        <label>
          С чего продолжить в следующий раз (необязательно)
          <input
            value={continueFrom}
            onChange={(e) => setContinueFrom(e.target.value)}
            placeholder="Например: глава 3, раздел о сигналах"
          />
        </label>
        <div>
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                api.post(`/api/sessions/${session.id}/summary`, {
                  keyConcepts,
                  retelling,
                  continueFrom,
                }),
              )
            }
          >
            Записать итог
          </button>
        </div>
        <ErrorText error={error} />
      </div>
    </section>
  );
}

function SessionRow({ s, today }: { s: SessionView; today: Today }) {
  const { run, error, busy } = useAction();
  const zone = today.timezone;
  const startable =
    s.status === 'planned' && s.end > today.now && !today.timer && !today.pendingSummary;
  return (
    <tr>
      <td>
        {time(s.start, zone)}–{time(s.end, zone)}
      </td>
      <td>
        {s.disciplineName}
        {today.continueHints[s.disciplineId] && s.status === 'planned' && (
          <div className="muted">С чего продолжить: {today.continueHints[s.disciplineId]}</div>
        )}
      </td>
      <td>
        {STATUS[s.status]}
        {ORIGIN[s.origin] && <div className="muted">{ORIGIN[s.origin]}</div>}
      </td>
      <td>
        {startable && (
          <button
            disabled={busy}
            onClick={() => void run(() => api.post(`/api/sessions/${s.id}/start`))}
          >
            Начать
          </button>
        )}
        <ErrorText error={error} />
      </td>
    </tr>
  );
}

function Unplanned({ today }: { today: Today }) {
  const disciplines = today.semester?.disciplines.filter((d) => d.frequency !== null) ?? [];
  const [id, setId] = useState('');
  const { run, error, busy } = useAction();
  if (disciplines.length === 0 || today.timer || today.pendingSummary) return null;
  return (
    <section>
      <h2>Позаниматься вне расписания</h2>
      <div className="row">
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">— дисциплина —</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          disabled={!id || busy}
          onClick={() => void run(() => api.post('/api/sessions/unplanned', { disciplineId: id }))}
        >
          Начать
        </button>
      </div>
      <p className="muted">Пойдёт в статистику, расписание не изменится.</p>
      <ErrorText error={error} />
    </section>
  );
}

export function TodayScreen({ today }: { today: Today }) {
  const zone = today.timezone;
  if (!today.semester) {
    return (
      <section>
        <h2>Сегодня</h2>
        {today.draftPending ? (
          <p>
            Черновик расписания ждёт подтверждения — <a href="#semester">посмотреть</a>.
          </p>
        ) : (
          <p>
            Семестр ещё не составлен — <a href="#semester">составить расписание</a>.
          </p>
        )}
      </section>
    );
  }
  const upcoming = today.sessions.some((s) => s.status === 'planned' && s.end > today.now);
  return (
    <>
      {today.timer && <SessionInProgress timer={today.timer} />}
      {!today.timer && today.pendingSummary && (
        <SummaryForm session={today.pendingSummary} zone={zone} />
      )}
      {today.openDecisions > 0 && (
        <p className="warning">
          Есть вопросы, которые ждут твоего решения: <a href="#decisions">{today.openDecisions}</a>.
        </p>
      )}
      <section>
        <h2>
          Сегодня{today.semester.currentWeek !== null && ` · неделя ${today.semester.currentWeek}`}
        </h2>
        {today.sessions.length === 0 ? (
          <p className="muted">Сегодня занятий нет.</p>
        ) : (
          <table>
            <tbody>
              {today.sessions.map((s) => (
                <SessionRow key={s.id} s={s} today={today} />
              ))}
            </tbody>
          </table>
        )}
        {!upcoming && today.next && (
          <p>
            Следующее: {today.next.disciplineName}, {range(today.next.start, today.next.end, zone)}
          </p>
        )}
      </section>
      <Unplanned today={today} />
    </>
  );
}

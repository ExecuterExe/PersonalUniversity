import { useState } from 'react';
import { api } from '../api';
import { ErrorText, Loading, WeekdayPicker, WindowsEditor } from '../components';
import { inputToMinutes, minutesToInput, WEEKDAYS } from '../format';
import { useAction, useApi } from '../hooks';
import type { AppSettings, GoogleCalendar, GoogleStatus } from '../types';

const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
const when = (t: number | null, never: string) => (t ? new Date(t).toLocaleString('ru') : never);

/** Время для учёбы, неудобное время, лимиты, Помодоро. */
export function SettingsForm({ onSaved }: { onSaved?: () => void }) {
  const { data, error } = useApi<AppSettings>('/api/settings');
  if (!data) return <Loading error={error} />;
  return <SettingsEditor initial={data} {...(onSaved ? { onSaved } : {})} />;
}

function SettingsEditor({ initial, onSaved }: { initial: AppSettings; onSaved?: () => void }) {
  const [form, setForm] = useState(initial);
  const { run, error: saveError, busy } = useAction();
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<AppSettings>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };
  const save = async () => {
    const result = await run(() => api.put<AppSettings>('/api/settings', form));
    if (result) {
      setSaved(true);
      onSaved?.();
    }
  };

  return (
    <div className="stack">
      <h3>Когда удобно учиться</h3>
      <WindowsEditor value={form.studyWindows} onChange={(studyWindows) => set({ studyWindows })} />

      <h3>Когда неудобно</h3>
      <p className="muted">
        Сервис сюда ничего не поставит и не предложит даже в компромиссах. Например, пары.
      </p>
      {form.inconvenient.map((item, i) => (
        <div className="row card" key={i}>
          <input
            placeholder="Что это"
            value={item.label}
            onChange={(e) =>
              set({
                inconvenient: form.inconvenient.map((x, j) =>
                  j === i ? { ...x, label: e.target.value } : x,
                ),
              })
            }
          />
          <input
            type="time"
            value={minutesToInput(item.start)}
            onChange={(e) =>
              set({
                inconvenient: form.inconvenient.map((x, j) =>
                  j === i ? { ...x, start: inputToMinutes(e.target.value) } : x,
                ),
              })
            }
          />
          –
          <input
            type="time"
            value={minutesToInput(item.end)}
            onChange={(e) =>
              set({
                inconvenient: form.inconvenient.map((x, j) =>
                  j === i ? { ...x, end: inputToMinutes(e.target.value) || 24 * 60 } : x,
                ),
              })
            }
          />
          <WeekdayPicker
            value={item.weekdays}
            onChange={(weekdays) =>
              set({
                inconvenient: form.inconvenient.map((x, j) => (j === i ? { ...x, weekdays } : x)),
              })
            }
          />
          <button
            className="secondary"
            onClick={() => set({ inconvenient: form.inconvenient.filter((_, j) => j !== i) })}
          >
            Убрать
          </button>
        </div>
      ))}
      <div>
        <button
          className="secondary"
          onClick={() =>
            set({
              inconvenient: [
                ...form.inconvenient,
                { start: 8 * 60, end: 10 * 60, weekdays: [...WEEKDAYS], label: '' },
              ],
            })
          }
        >
          Добавить неудобное время
        </button>
      </div>

      <h3>Дни без учёбы</h3>
      <WeekdayPicker
        value={form.excludedWeekdays}
        onChange={(excludedWeekdays) => set({ excludedWeekdays })}
      />

      <h3>Буфер и лимиты</h3>
      <div className="row">
        <label>
          Буфер до и после событий, мин
          <input
            type="number"
            min={0}
            max={120}
            value={form.bufferMinutes}
            onChange={(e) => set({ bufferMinutes: Number(e.target.value) })}
          />
        </label>
        <label>
          Не больше часов в день
          <input
            type="number"
            step={0.5}
            min={0.5}
            value={hours(form.maxDailyMinutes)}
            onChange={(e) => set({ maxDailyMinutes: Math.round(Number(e.target.value) * 60) })}
          />
        </label>
        <label>
          Не больше часов в неделю
          <input
            type="number"
            step={0.5}
            min={0.5}
            value={hours(form.maxWeeklyMinutes)}
            onChange={(e) => set({ maxWeeklyMinutes: Math.round(Number(e.target.value) * 60) })}
          />
        </label>
        <label>
          Занятий в день, не больше
          <input
            type="number"
            min={1}
            max={4}
            value={form.maxSessionsPerDay}
            onChange={(e) => set({ maxSessionsPerDay: Number(e.target.value) })}
          />
        </label>
        <label>
          Семестр по умолчанию, недель
          <input
            type="number"
            min={1}
            max={52}
            value={form.defaultSemesterWeeks}
            onChange={(e) => set({ defaultSemesterWeeks: Number(e.target.value) })}
          />
        </label>
      </div>

      <h3>Помодоро</h3>
      <div className="row">
        <label>
          Фокус, мин
          <input
            type="number"
            min={5}
            value={form.pomodoro.focusMinutes}
            onChange={(e) =>
              set({ pomodoro: { ...form.pomodoro, focusMinutes: Number(e.target.value) } })
            }
          />
        </label>
        <label>
          Перерыв, мин
          <input
            type="number"
            min={1}
            value={form.pomodoro.breakMinutes}
            onChange={(e) =>
              set({ pomodoro: { ...form.pomodoro, breakMinutes: Number(e.target.value) } })
            }
          />
        </label>
        <label>
          Длинный перерыв, мин
          <input
            type="number"
            min={1}
            value={form.pomodoro.longBreakMinutes}
            onChange={(e) =>
              set({ pomodoro: { ...form.pomodoro, longBreakMinutes: Number(e.target.value) } })
            }
          />
        </label>
        <label>
          Длинный — после циклов
          <input
            type="number"
            min={1}
            value={form.pomodoro.cyclesBeforeLongBreak}
            onChange={(e) =>
              set({ pomodoro: { ...form.pomodoro, cyclesBeforeLongBreak: Number(e.target.value) } })
            }
          />
        </label>
      </div>
      <p className="muted">Часовой пояс: {form.timezone}</p>

      <div className="row">
        <button onClick={save} disabled={busy}>
          Сохранить настройки
        </button>
        {saved && <span className="ok">Сохранено</span>}
      </div>
      <ErrorText error={saveError} />
    </div>
  );
}

/** Подключение Google Календаря и выбор календарей для занятости. */
export function GooglePanel() {
  const { data: status, error } = useApi<GoogleStatus>('/api/google/status');
  const ready = status?.connected && !status.needsReauth;
  const { data: calendars } = useApi<GoogleCalendar[]>(ready ? '/api/google/calendars' : null);
  const { run, error: actionError, busy } = useAction();
  if (!status) return <Loading error={error} />;

  if (!status.configured) {
    return <p>Ключи Google не заданы — см. docs/google-setup.md.</p>;
  }
  if (!status.connected) {
    return (
      <p>
        Google Календарь не подключён. <a href="/auth/google">Подключить</a> — лучше открыть в
        обычном браузере.
      </p>
    );
  }
  const toggle = (id: string, on: boolean) => {
    const current = (calendars ?? []).filter((c) => c.selected).map((c) => c.id);
    const next = on ? [...current, id] : current.filter((x) => x !== id);
    return run(() => api.put('/api/google/calendars', { busyCalendarIds: next }));
  };

  return (
    <div className="stack">
      <p>
        Подключён: {status.email ?? 'аккаунт Google'}.{' '}
        {status.needsReauth && (
          <strong className="error">
            Доступ истёк — <a href="/auth/google">войти заново</a>.
          </strong>
        )}
      </p>
      {status.lastSyncError && <p className="warning">Последняя ошибка: {status.lastSyncError}</p>}
      <p className="muted">
        Занятость обновлена: {when(status.busyUpdatedAt, 'ещё нет')}
        {' · '}
        Синхронизация: {when(status.lastSyncAt, 'ещё не было')}
        {' · '}
        Календарь «Мой университет»:{' '}
        {status.calendarCreated ? 'создан' : 'появится после подтверждения семестра'}
      </p>
      {calendars && (
        <>
          <h3>Из каких календарей брать занятость</h3>
          {calendars.map((c) => (
            <label className="inline" key={c.id}>
              <input
                type="checkbox"
                disabled={!c.usable || busy}
                checked={c.selected && c.usable}
                onChange={(e) => void toggle(c.id, e.target.checked)}
              />
              {c.summary}
              {c.primary && ' (основной)'}
              {!c.usable && <span className="muted"> — видна только занятость, не читается</span>}
            </label>
          ))}
        </>
      )}
      <div className="row">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void run(() => api.post('/api/google/sync'))}
        >
          Синхронизировать сейчас
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={() => {
            if (confirm('Отключить Google Календарь? Занятия перестанут попадать в календарь.')) {
              void run(() => api.post('/api/google/disconnect'));
            }
          }}
        >
          Отключить
        </button>
      </div>
      <ErrorText error={actionError} />
    </div>
  );
}

export function SettingsScreen() {
  return (
    <>
      <section>
        <h2>Настройки</h2>
        <SettingsForm />
      </section>
      <section>
        <h2>Google Календарь</h2>
        <GooglePanel />
      </section>
      <section>
        <h2>Итоги занятий</h2>
        <p>
          <a href="/api/export/summaries">Скачать все итоги (Markdown)</a> ·{' '}
          <a href="/api/export/summaries?format=json">JSON</a>
        </p>
      </section>
    </>
  );
}

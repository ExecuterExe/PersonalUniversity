import {
  Ban,
  CalendarDays,
  CheckCircle2,
  Clock4,
  Download,
  Gauge,
  LogIn,
  Plus,
  Power,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Timer,
  Trash2,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { WeekdayPicker, WindowsEditor } from '../components';
import { inputToMinutes, minutesToInput, WEEKDAYS } from '../format';
import { useAction, useApi } from '../hooks';
import type { AppSettings, GoogleCalendar, GoogleStatus, ShortcutsStatus } from '../types';
import { Alert, Badge, Button, Card, ErrorText, Field, Loading, PageHeader } from '../ui';

const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
const when = (t: number | null, never: string) =>
  t
    ? new Date(t).toLocaleString('ru', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : never;

function Group({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-group">
      <div className="settings-label">
        <span className="swatch-sm">
          <Icon size={17} />
        </span>
        <div>
          <h3>{title}</h3>
          {hint && <p className="faint">{hint}</p>}
        </div>
      </div>
      <div className="stack">{children}</div>
    </div>
  );
}

/** Время для учёбы, неудобное время, лимиты, Помодоро. */
export function SettingsForm({ onSaved }: { onSaved?: () => void }) {
  const { data, error } = useApi<AppSettings>('/api/settings');
  if (!data) return <Loading error={error} height={360} />;
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
  const setItem = (i: number, patch: Partial<AppSettings['inconvenient'][number]>) =>
    set({ inconvenient: form.inconvenient.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setPomodoro = (patch: Partial<AppSettings['pomodoro']>) =>
    set({ pomodoro: { ...form.pomodoro, ...patch } });
  const save = async () => {
    const result = await run(() => api.put<AppSettings>('/api/settings', form));
    if (result) {
      setSaved(true);
      onSaved?.();
    }
  };

  return (
    <div className="stack">
      <Group
        icon={Clock4}
        title="Когда удобно учиться"
        hint="Окна, внутри которых ставятся занятия"
      >
        <WindowsEditor
          value={form.studyWindows}
          onChange={(studyWindows) => set({ studyWindows })}
        />
      </Group>

      <Group
        icon={Ban}
        title="Когда неудобно"
        hint="Сюда сервис ничего не поставит и не предложит даже в компромиссах. Например, пары."
      >
        {form.inconvenient.map((item, i) => (
          <div
            className="card flat stack"
            style={{ padding: 14, background: 'var(--surface-2)' }}
            key={i}
          >
            <div className="row">
              <input
                className="input"
                style={{ flex: 1, minWidth: 160 }}
                placeholder="Что это — например, «Пары»"
                value={item.label}
                onChange={(e) => setItem(i, { label: e.target.value })}
              />
              <input
                className="input time"
                type="time"
                value={minutesToInput(item.start)}
                onChange={(e) => setItem(i, { start: inputToMinutes(e.target.value) })}
              />
              <span className="muted">—</span>
              <input
                className="input time"
                type="time"
                value={minutesToInput(item.end)}
                onChange={(e) => setItem(i, { end: inputToMinutes(e.target.value) || 24 * 60 })}
              />
              <Button
                variant="ghost"
                icon={<Trash2 size={16} />}
                aria-label="Убрать"
                onClick={() => set({ inconvenient: form.inconvenient.filter((_, j) => j !== i) })}
              />
            </div>
            <WeekdayPicker
              value={item.weekdays}
              onChange={(weekdays) => setItem(i, { weekdays })}
            />
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={15} />}
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
          </Button>
        </div>
      </Group>

      <Group icon={CalendarDays} title="Дни без учёбы" hint="В эти дни занятий не будет совсем">
        <WeekdayPicker
          value={form.excludedWeekdays}
          onChange={(excludedWeekdays) => set({ excludedWeekdays })}
        />
      </Group>

      <Group icon={Gauge} title="Буфер и лимиты">
        <div className="grid-3" style={{ gap: 14 }}>
          <Field label="Буфер до и после событий" hint="минут">
            <input
              className="input"
              type="number"
              min={0}
              max={120}
              value={form.bufferMinutes}
              onChange={(e) => set({ bufferMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Не больше в день" hint="часов">
            <input
              className="input"
              type="number"
              step={0.5}
              min={0.5}
              value={hours(form.maxDailyMinutes)}
              onChange={(e) => set({ maxDailyMinutes: Math.round(Number(e.target.value) * 60) })}
            />
          </Field>
          <Field label="Не больше в неделю" hint="часов">
            <input
              className="input"
              type="number"
              step={0.5}
              min={0.5}
              value={hours(form.maxWeeklyMinutes)}
              onChange={(e) => set({ maxWeeklyMinutes: Math.round(Number(e.target.value) * 60) })}
            />
          </Field>
          <Field label="Занятий в день" hint="не больше">
            <input
              className="input"
              type="number"
              min={1}
              max={4}
              value={form.maxSessionsPerDay}
              onChange={(e) => set({ maxSessionsPerDay: Number(e.target.value) })}
            />
          </Field>
          <Field label="Семестр по умолчанию" hint="недель">
            <input
              className="input"
              type="number"
              min={1}
              max={52}
              value={form.defaultSemesterWeeks}
              onChange={(e) => set({ defaultSemesterWeeks: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Group>

      <Group icon={Timer} title="Помодоро" hint="Фокус и перерывы во время занятия">
        <div className="grid-4" style={{ gap: 14 }}>
          <Field label="Фокус" hint="минут">
            <input
              className="input"
              type="number"
              min={5}
              value={form.pomodoro.focusMinutes}
              onChange={(e) => setPomodoro({ focusMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Перерыв" hint="минут">
            <input
              className="input"
              type="number"
              min={1}
              value={form.pomodoro.breakMinutes}
              onChange={(e) => setPomodoro({ breakMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Длинный перерыв" hint="минут">
            <input
              className="input"
              type="number"
              min={1}
              value={form.pomodoro.longBreakMinutes}
              onChange={(e) => setPomodoro({ longBreakMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Длинный — после" hint="циклов">
            <input
              className="input"
              type="number"
              min={1}
              value={form.pomodoro.cyclesBeforeLongBreak}
              onChange={(e) => setPomodoro({ cyclesBeforeLongBreak: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Group>

      <div className="save-bar">
        <Button icon={<Save size={16} />} onClick={() => void save()} disabled={busy}>
          Сохранить настройки
        </Button>
        {saved && (
          <span className="row" style={{ gap: 6, color: 'var(--success)', fontWeight: 600 }}>
            <CheckCircle2 size={17} /> Сохранено
          </span>
        )}
        <ErrorText error={saveError} />
        <span className="faint" style={{ marginLeft: 'auto' }}>
          Часовой пояс: {form.timezone}
        </span>
      </div>
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
    return <Alert tone="warning">Ключи Google не заданы — см. docs/google-setup.md.</Alert>;
  }
  if (!status.connected) {
    return (
      <div className="stack">
        <p className="muted">
          Календарь не подключён. Сервис будет видеть занятость и сам ставить занятия в отдельный
          календарь «Мой университет».
        </p>
        <div>
          <a className="btn" href="/auth/google">
            <LogIn size={16} /> Подключить Google Календарь
          </a>
        </div>
        <p className="faint">Лучше открыть в обычном браузере.</p>
      </div>
    );
  }
  const toggle = (id: string, on: boolean) => {
    const current = (calendars ?? []).filter((c) => c.selected).map((c) => c.id);
    const next = on ? [...current, id] : current.filter((x) => x !== id);
    return run(() => api.put('/api/google/calendars', { busyCalendarIds: next }));
  };

  return (
    <div className="stack-lg">
      <div className="row between">
        <span className="row" style={{ gap: 8 }}>
          <Badge tone={status.needsReauth ? 'warning' : 'success'}>
            {status.needsReauth ? 'нужен вход' : 'подключён'}
          </Badge>
          <strong>{status.email ?? 'аккаунт Google'}</strong>
        </span>
        <div className="row" style={{ gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={15} />}
            disabled={busy}
            onClick={() => void run(() => api.post('/api/google/sync'))}
          >
            Синхронизировать
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Unplug size={15} />}
            disabled={busy}
            onClick={() => {
              if (confirm('Отключить Google Календарь? Занятия перестанут попадать в календарь.')) {
                void run(() => api.post('/api/google/disconnect'));
              }
            }}
          >
            Отключить
          </Button>
        </div>
      </div>
      {status.needsReauth && (
        <Alert tone="warning">
          Доступ истёк — <a href="/auth/google">войти заново</a>.
        </Alert>
      )}
      {status.lastSyncError && (
        <Alert tone="danger">Последняя ошибка: {status.lastSyncError}</Alert>
      )}
      <div className="grid-3" style={{ gap: 12 }}>
        <div className="card flat" style={{ padding: 14 }}>
          <div className="faint">Занятость обновлена</div>
          <strong>{when(status.busyUpdatedAt, 'ещё нет')}</strong>
        </div>
        <div className="card flat" style={{ padding: 14 }}>
          <div className="faint">Синхронизация</div>
          <strong>{when(status.lastSyncAt, 'ещё не было')}</strong>
        </div>
        <div className="card flat" style={{ padding: 14 }}>
          <div className="faint">Календарь «Мой университет»</div>
          <strong>{status.calendarCreated ? 'создан' : 'после подтверждения семестра'}</strong>
        </div>
      </div>
      {calendars && (
        <div className="stack" style={{ gap: 8 }}>
          <h3>Из каких календарей брать занятость</h3>
          {calendars.map((c) => (
            <label
              className="option"
              key={c.id}
              style={{ cursor: c.usable ? 'pointer' : 'default' }}
            >
              <input
                type="checkbox"
                disabled={!c.usable || busy}
                checked={c.selected && c.usable}
                onChange={(e) => void toggle(c.id, e.target.checked)}
                style={{ width: 17, height: 17, accentColor: 'var(--primary)' }}
              />
              <span className="grow">
                <span className="title">
                  {c.summary}
                  {c.primary && ' · основной'}
                </span>
                {!c.usable && (
                  <span className="sub">видна только занятость, события не читаются</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
      <ErrorText error={actionError} />
    </div>
  );
}

function ShortcutOption({
  on,
  disabled,
  title,
  hint,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  title: string;
  hint: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="option" style={{ cursor: disabled ? 'default' : 'pointer' }}>
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 17, height: 17, accentColor: 'var(--primary)' }}
      />
      <span className="grow">
        <span className="title">{title}</span>
        <span className="sub">{hint}</span>
      </span>
    </label>
  );
}

/** Ярлык и автозапуск: сервис сам открывается на «Сегодня». Напоминаний при этом нет. */
function LaunchPanel() {
  const { data, error } = useApi<ShortcutsStatus>('/api/system/shortcuts');
  const { run, error: actionError, busy } = useAction();
  if (!data) return <Loading error={error} height={80} />;
  if (!data.supported) {
    return <p className="faint">Ярлык и автозапуск доступны только в Windows.</p>;
  }
  const set = (patch: Partial<Pick<ShortcutsStatus, 'desktop' | 'autostart'>>) =>
    void run(() => api.put<ShortcutsStatus>('/api/system/shortcuts', patch));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <ShortcutOption
        on={data.desktop}
        disabled={busy}
        title="Ярлык на рабочем столе"
        hint="Запускает сервис, если он не работает, и открывает «Сегодня»"
        onChange={(desktop) => set({ desktop })}
      />
      <ShortcutOption
        on={data.autostart}
        disabled={busy}
        title="Открывать при входе в Windows"
        hint="Включил компьютер — сервис сам открывается на «Сегодня». Без напоминаний и уведомлений"
        onChange={(autostart) => set({ autostart })}
      />
      <ErrorText error={actionError} />
    </div>
  );
}

export function SettingsScreen() {
  return (
    <>
      <PageHeader
        icon={<SettingsIcon size={24} />}
        title="Настройки"
        subtitle="Время, ограничения, Помодоро и календарь"
      />
      <div className="stack-lg">
        <Card>
          <SettingsForm />
        </Card>
        <Card title="Google Календарь" icon={<CalendarDays size={19} color="var(--primary)" />}>
          <GooglePanel />
        </Card>
        <Card title="Запуск" icon={<Power size={19} color="var(--primary)" />}>
          <LaunchPanel />
        </Card>
        <Card title="Итоги занятий" icon={<Download size={19} color="var(--violet)" />}>
          <div className="row">
            <a className="btn secondary" href="/api/export/summaries">
              <Download size={16} /> Скачать в Markdown
            </a>
            <a className="btn ghost" href="/api/export/summaries?format=json">
              JSON
            </a>
            <span className="faint">Все итоги и «с чего продолжить» по каждому занятию.</span>
          </div>
        </Card>
      </div>
    </>
  );
}

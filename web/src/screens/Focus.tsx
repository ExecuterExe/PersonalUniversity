// Режим погружения: идёт занятие — таймер Помодоро, звуки природы, всё нужное под рукой.
import {
  BookMarked,
  CloudRain,
  Flame,
  Headphones,
  Link2,
  Pause,
  Play,
  Square,
  Trees,
  Waves,
  Wind,
  Droplets,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { useColor } from '../colors';
import { useConfirm } from '../confirm';
import { countdown, local } from '../format';
import { useAction, useApi, useNow, useRefresh } from '../hooks';
import { ambience, loadPrefs, savePrefs, SOUNDS, type SoundId, type SoundPrefs } from '../sounds';
import type { AppSettings, SessionDetails, TimerView } from '../types';
import { Alert, Button, Card, ErrorText, Loading, Progress } from '../ui';

const PHASE = { focus: 'Фокус', break: 'Перерыв', 'long-break': 'Длинный перерыв' } as const;

const SOUND_ICON: Record<SoundId, LucideIcon> = {
  rain: CloudRain,
  waves: Waves,
  forest: Trees,
  fire: Flame,
  stream: Droplets,
  noise: Wind,
};

/** Короткий сигнал при смене фазы Помодоро. */
function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  } catch {
    // Без звука — не страшно.
  }
}

/** Какую смену фазы уже отметили сигналом — общая на все перерисовки таймера. */
let signalledPhase = '';

// Кольцо рисуется в координатах 340×340 и растягивается под ширину экрана.
const RING = 340;
const STROKE = 14;
const RADIUS = 134;
const TICKS_RADIUS = 160;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TICK_STEP = (2 * Math.PI * TICKS_RADIUS) / 60;

/** Кольцо фазы: считает само между запросами; новые данные с сервера — новый экземпляр. */
function PhaseRing({ view, totalCycles }: { view: TimerView; totalCycles: number }) {
  const { refresh } = useRefresh();
  const [base] = useState(() => ({ view, at: Date.now() }));
  const now = useNow(1000);
  const v = base.view;
  const elapsed = v.paused ? 0 : now - base.at;
  const phaseLeft = v.phaseLengthMs - v.phaseElapsedMs - elapsed;
  const share = Math.min(1, Math.max(0, (v.phaseElapsedMs + elapsed) / v.phaseLengthMs));
  const focusPhase = v.phase === 'focus';

  useEffect(() => {
    const key = `${v.sessionId}-${v.cycle}-${v.phase}`;
    if (phaseLeft <= 0 && !v.paused && signalledPhase !== key) {
      signalledPhase = key;
      chime();
      refresh();
    }
  }, [phaseLeft, v.sessionId, v.cycle, v.phase, v.paused, refresh]);

  // Светящаяся «голова» дуги — там, где сейчас время.
  const angle = share * 2 * Math.PI;
  const head = { x: RING / 2 + RADIUS * Math.cos(angle), y: RING / 2 + RADIUS * Math.sin(angle) };

  return (
    <>
      <div className={`ring ${focusPhase ? '' : 'break'} ${v.paused ? 'paused' : ''}`}>
        <svg viewBox={`0 0 ${RING} ${RING}`}>
          <defs>
            <linearGradient id="focus-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5b7bff" />
              <stop offset="55%" stopColor="#8b6cff" />
              <stop offset="100%" stopColor="#d07bff" />
            </linearGradient>
            <linearGradient id="break-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2fd39a" />
              <stop offset="100%" stopColor="#22b8d6" />
            </linearGradient>
          </defs>
          <circle
            className="ring-ticks"
            cx={RING / 2}
            cy={RING / 2}
            r={TICKS_RADIUS}
            fill="none"
            strokeWidth={6}
            strokeDasharray={`1.5 ${TICK_STEP - 1.5}`}
          />
          <circle
            className="ring-track"
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
          />
          <circle
            className="ring-fill"
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            fill="none"
            stroke={`url(#${focusPhase ? 'focus' : 'break'}-gradient)`}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - share)}
          />
          {share > 0.005 && <circle className="ring-head" cx={head.x} cy={head.y} r={5} />}
        </svg>
        <div className="ring-center">
          <span className="countdown">{countdown(phaseLeft)}</span>
          <span className="phase">{v.paused ? 'Пауза' : PHASE[v.phase]}</span>
        </div>
      </div>
      <div className="cycles" aria-label={`Цикл ${v.cycle} из ${totalCycles}`}>
        {Array.from({ length: Math.max(totalCycles, v.cycle) }, (_, i) => (
          <span key={i} className={i + 1 < v.cycle ? 'done' : i + 1 === v.cycle ? 'now' : ''} />
        ))}
      </div>
    </>
  );
}

function SessionProgress({ view }: { view: TimerView }) {
  const [base] = useState(() => ({ view, at: Date.now() }));
  const now = useNow(1000);
  const v = base.view;
  const elapsed = v.paused ? 0 : now - base.at;
  const active = v.activeMs + elapsed;
  const remaining = Math.max(0, v.plannedMs - active);
  const focus = v.focusMs + (v.phase === 'focus' && !v.paused ? elapsed : 0);
  return (
    <div className="stack" style={{ width: '100%', maxWidth: 420, gap: 8 }}>
      <Progress value={active / v.plannedMs} />
      <div className="row between faint">
        <span>Чистая учёба: {Math.floor(focus / 60_000)} мин</span>
        <span>
          {remaining > 0 ? `до конца занятия ${countdown(remaining)}` : 'время занятия вышло'}
        </span>
      </div>
    </div>
  );
}

/** Звуки природы: можно смешивать, у каждого своя громкость; в перерыв замолкают. */
function SoundMixer({ phase, paused }: { phase: TimerView['phase']; paused: boolean }) {
  const [prefs, setPrefs] = useState<SoundPrefs>(loadPrefs);
  const [playing, setPlaying] = useState<SoundId[]>([]);

  const update = (next: SoundPrefs) => {
    setPrefs(next);
    savePrefs(next);
  };

  useEffect(() => {
    if (paused || (phase !== 'focus' && prefs.pauseOnBreak)) ambience.suspend();
    else ambience.resume();
  }, [phase, paused, prefs.pauseOnBreak, playing]);

  useEffect(() => () => ambience.stopAll(), []);

  const toggle = (id: SoundId) => {
    if (playing.includes(id)) {
      ambience.stop(id);
      setPlaying(playing.filter((x) => x !== id));
      const volumes = { ...prefs.volumes };
      delete volumes[id];
      update({ ...prefs, volumes });
    } else {
      const volume = prefs.volumes[id] ?? 0.6;
      ambience.play(id, volume);
      ambience.setMaster(prefs.master);
      setPlaying([...playing, id]);
      update({ ...prefs, volumes: { ...prefs.volumes, [id]: volume } });
    }
  };

  const restore = () => {
    const ids = Object.keys(prefs.volumes) as SoundId[];
    ids.forEach((id) => ambience.play(id, prefs.volumes[id] ?? 0.6));
    ambience.setMaster(prefs.master);
    setPlaying(ids);
  };

  const remembered = Object.keys(prefs.volumes).length > 0 && playing.length === 0;

  return (
    <Card title="Звуки природы" icon={<Headphones size={18} color="var(--violet)" />}>
      <div className="stack">
        <div className="sounds">
          {SOUNDS.map(({ id, label }) => {
            const Icon = SOUND_ICON[id];
            const on = playing.includes(id);
            return (
              <div
                key={id}
                className={`sound ${on ? 'on' : ''}`}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                onClick={() => toggle(id)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    toggle(id);
                  }
                }}
              >
                <Icon size={22} />
                {label}
                {on && (
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={prefs.volumes[id] ?? 0.6}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const volume = Number(e.target.value);
                      ambience.play(id, volume);
                      update({ ...prefs, volumes: { ...prefs.volumes, [id]: volume } });
                    }}
                    aria-label={`Громкость: ${label}`}
                  />
                )}
              </div>
            );
          })}
        </div>
        {remembered && (
          <Button variant="secondary" size="sm" onClick={restore}>
            Включить как в прошлый раз
          </Button>
        )}
        <label className="field">
          Общая громкость
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.master}
            onChange={(e) => {
              const master = Number(e.target.value);
              ambience.setMaster(master);
              update({ ...prefs, master });
            }}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.pauseOnBreak}
            onChange={(e) => update({ ...prefs, pauseOnBreak: e.target.checked })}
          />
          Замолкать в перерыв
        </label>
      </div>
    </Card>
  );
}

/**
 * Пока занятие идёт, экран не гаснет, а компьютер не засыпает от бездействия —
 * если браузер это умеет. На паузе — как обычно.
 */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    // Браузер снимает блокировку, когда вкладку прячут, — берём заново, когда она снова видна.
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((next) => {
          if (cancelled) void next.release();
          else lock = next;
        })
        .catch(() => undefined);
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [active]);
}

/** Почему таймер стоит, если его остановил сервис, и что с этим сделать. */
function AutoPauseNote({
  pause,
  zone,
  busy,
  onCount,
}: {
  pause: NonNullable<TimerView['autoPause']>;
  zone: string;
  busy: boolean;
  onCount: () => void;
}) {
  const today = local(useNow(60_000), zone).toISODate();
  const at = (t: number) => {
    const dt = local(t, zone).setLocale('ru');
    return dt.toISODate() === today ? dt.toFormat('HH:mm') : dt.toFormat('d MMMM, HH:mm');
  };
  if (pause.reason === 'away') {
    return (
      <Alert tone="info">
        Время занятия вышло, когда страница была закрыта, — таймер остановлен в {at(pause.from)}.
        Можно завершить занятие или продолжить.
      </Alert>
    );
  }
  return (
    <Alert tone="warning">
      <div className="stack" style={{ gap: 8 }}>
        <span>
          Компьютер спал или был выключен с {at(pause.from)}
          {pause.to ? ` до ${at(pause.to)}` : ''} — это время не засчитано в учёбу.
        </span>
        <div>
          <Button variant="secondary" size="sm" disabled={busy} onClick={onCount}>
            Я занимался — засчитать
          </Button>
        </div>
      </div>
    </Alert>
  );
}

export function FocusView({ timer }: { timer: TimerView }) {
  const { data: details, error } = useApi<SessionDetails>(`/api/sessions/${timer.sessionId}`);
  const { data: settings } = useApi<AppSettings>('/api/settings');
  const color = useColor(details?.session.disciplineId ?? '');
  const { run, error: actionError, busy } = useAction();
  const confirm = useConfirm();
  const pomodoro = settings?.pomodoro;
  const totalCycles = pomodoro
    ? Math.ceil(timer.plannedMs / ((pomodoro.focusMinutes + pomodoro.breakMinutes) * 60_000))
    : timer.cycle;
  const key = `${timer.activeMs}-${timer.paused}`;
  useWakeLock(!timer.paused);

  const finish = async () => {
    const early = timer.plannedMs - timer.activeMs > 60_000;
    if (
      early &&
      !(await confirm({
        title: 'Завершить раньше времени?',
        text: 'Запишется, сколько ты занимался на самом деле.',
        ok: 'Завершить',
        cancel: 'Продолжить заниматься',
      }))
    )
      return;
    void run(() => api.post('/api/timer/finish'));
  };

  return (
    <div className="focus">
      <div className="focus-stage">
        <div className="focus-title">
          <span className="eyebrow">Режим погружения</span>
          <h2>
            <span
              className="dot"
              style={{ background: color.accent, '--accent': color.accent } as CSSProperties}
            />
            {details?.session.disciplineName ?? 'Занятие'}
          </h2>
        </div>
        {timer.autoPause && settings && (
          <AutoPauseNote
            pause={timer.autoPause}
            zone={settings.timezone}
            busy={busy}
            onCount={() => void run(() => api.post('/api/timer/resume', { countPaused: true }))}
          />
        )}
        <PhaseRing key={key} view={timer} totalCycles={totalCycles} />
        <SessionProgress key={`p-${key}`} view={timer} />
        <div className="row">
          {timer.paused ? (
            <Button
              size="lg"
              icon={<Play size={18} />}
              disabled={busy}
              onClick={() => void run(() => api.post('/api/timer/resume'))}
            >
              Продолжить
            </Button>
          ) : (
            <Button
              size="lg"
              variant="secondary"
              icon={<Pause size={18} />}
              disabled={busy}
              onClick={() => void run(() => api.post('/api/timer/pause'))}
            >
              Пауза
            </Button>
          )}
          <Button
            size="lg"
            variant="ghost"
            icon={<Square size={16} />}
            disabled={busy}
            onClick={() => void finish()}
          >
            Завершить
          </Button>
        </div>
        <ErrorText error={actionError} />
      </div>

      <div className="stack-lg">
        <SoundMixer phase={timer.phase} paused={timer.paused} />
        {!details ? (
          <Loading error={error} height={80} />
        ) : (
          <>
            {details.continueHint && (
              <Alert tone="info">
                <strong>С чего продолжить:</strong> {details.continueHint}
              </Alert>
            )}
            <Card title="Под рукой" icon={<BookMarked size={18} color="var(--primary)" />}>
              <div className="stack">
                <p className="muted small">
                  <strong>Цель:</strong> {details.goal}
                </p>
                {details.sources.length === 0 && (
                  <p className="faint">
                    Источников пока нет — их можно добавить в карточке дисциплины.
                  </p>
                )}
                {details.sources.map((s) => (
                  <div className="source" key={s.id}>
                    {s.url ? (
                      <Link2 size={16} color="var(--primary)" />
                    ) : (
                      <BookMarked size={16} color="var(--violet)" />
                    )}
                    <div className="grow">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title}
                        </a>
                      ) : (
                        <strong>{s.title}</strong>
                      )}
                      {s.kind === 'note' && s.note && s.note !== s.title && (
                        <div className="faint">{s.note}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

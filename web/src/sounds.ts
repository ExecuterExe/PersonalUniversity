// Звуки природы — синтез прямо в браузере (Web Audio): без файлов, лицензий и интернета.

export type SoundId = 'rain' | 'waves' | 'forest' | 'fire' | 'stream' | 'noise';

export const SOUNDS: { id: SoundId; label: string }[] = [
  { id: 'rain', label: 'Дождь' },
  { id: 'waves', label: 'Море' },
  { id: 'forest', label: 'Лес' },
  { id: 'fire', label: 'Костёр' },
  { id: 'stream', label: 'Ручей' },
  { id: 'noise', label: 'Тихий шум' },
];

type NoiseKind = 'white' | 'pink' | 'brown';

interface Channel {
  gain: GainNode;
  stop: () => void;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Микшер: несколько звуков одновременно, у каждого своя громкость, плюс общая. */
class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly channels = new Map<SoundId, Channel>();
  private readonly buffers = new Map<NoiseKind, AudioBuffer>();

  private audio(): { ctx: AudioContext; master: GainNode } {
    if (!this.ctx || !this.master) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    }
    return { ctx: this.ctx, master: this.master };
  }

  private buffer(kind: NoiseKind): AudioBuffer {
    const cached = this.buffers.get(kind);
    if (cached) return cached;
    const { ctx } = this.audio();
    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0,
      last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'white') {
        data[i] = white * 0.5;
      } else if (kind === 'pink') {
        // Розовый шум, фильтр Пола Келлета.
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
    }
    this.buffers.set(kind, buffer);
    return buffer;
  }

  private loop(kind: NoiseKind): AudioBufferSourceNode {
    const { ctx } = this.audio();
    const source = ctx.createBufferSource();
    source.buffer = this.buffer(kind);
    source.loop = true;
    source.loopStart = rand(0, 3);
    source.start(0, source.loopStart);
    return source;
  }

  private filter(type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
    const f = this.audio().ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  /** Медленное колебание параметра: волны, ветер, журчание. */
  private lfo(target: AudioParam, rate: number, depth: number): OscillatorNode {
    const { ctx } = this.audio();
    const osc = ctx.createOscillator();
    const amount = ctx.createGain();
    osc.frequency.value = rate;
    amount.gain.value = depth;
    osc.connect(amount).connect(target);
    osc.start();
    return osc;
  }

  /** Короткий всплеск шума — капля, треск, плеск. */
  private burst(
    out: AudioNode,
    length: number,
    frequency: number,
    level: number,
    type: BiquadFilterType = 'bandpass',
  ) {
    const { ctx } = this.audio();
    const source = ctx.createBufferSource();
    source.buffer = this.buffer('white');
    const f = this.filter(type, frequency, 2.5);
    const env = ctx.createGain();
    const t = ctx.currentTime;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(f).connect(env).connect(out);
    source.start(t, rand(0, 3), length + 0.02);
  }

  /** Птица: несколько быстрых свистов с изменением высоты. */
  private chirp(out: AudioNode) {
    const { ctx } = this.audio();
    const base = rand(2400, 3800);
    for (let i = 0, n = Math.round(rand(2, 5)); i < n; i++) {
      const t = ctx.currentTime + i * rand(0.09, 0.16);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * rand(1.15, 1.4), t + 0.06);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.035, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  /** Случайные события (капли, треск, птицы), пока звук включён. */
  private repeat(min: number, max: number, action: () => void): () => void {
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(
        () => {
          if (this.ctx?.state === 'running') action();
          next();
        },
        rand(min, max),
      );
    };
    next();
    return () => clearTimeout(timer);
  }

  private build(id: SoundId, out: GainNode): () => void {
    const nodes: AudioScheduledSourceNode[] = [];
    const stops: (() => void)[] = [];
    const level = (value: number) => {
      const g = this.audio().ctx.createGain();
      g.gain.value = value;
      g.connect(out);
      return g;
    };

    if (id === 'rain') {
      const src = this.loop('pink');
      src
        .connect(this.filter('highpass', 500))
        .connect(this.filter('lowpass', 7000))
        .connect(level(0.55));
      const drops = level(1);
      stops.push(
        this.repeat(25, 120, () =>
          this.burst(drops, rand(0.01, 0.03), rand(2500, 6500), rand(0.05, 0.2)),
        ),
      );
      nodes.push(src);
    } else if (id === 'waves') {
      const src = this.loop('brown');
      const amp = level(0.5);
      src.connect(this.filter('lowpass', 750)).connect(amp);
      nodes.push(src, this.lfo(amp.gain, 0.09, 0.4), this.lfo(amp.gain, 0.031, 0.15));
    } else if (id === 'forest') {
      const src = this.loop('pink');
      const wind = this.filter('bandpass', 650, 0.5);
      src.connect(wind).connect(level(0.45));
      nodes.push(src, this.lfo(wind.frequency, 0.05, 300));
      const birds = level(1);
      stops.push(this.repeat(2500, 7000, () => this.chirp(birds)));
    } else if (id === 'fire') {
      const src = this.loop('brown');
      src.connect(this.filter('lowpass', 420)).connect(level(0.7));
      const crackle = level(1);
      stops.push(
        this.repeat(30, 260, () =>
          this.burst(crackle, rand(0.004, 0.015), rand(1500, 4000), rand(0.08, 0.45), 'highpass'),
        ),
      );
      nodes.push(src);
    } else if (id === 'stream') {
      const src = this.loop('white');
      const low = this.filter('bandpass', 1000, 0.9);
      const high = this.filter('bandpass', 2600, 2);
      src.connect(low).connect(level(0.35));
      src.connect(high).connect(level(0.12));
      nodes.push(src, this.lfo(low.frequency, 0.43, 350), this.lfo(high.frequency, 0.71, 600));
    } else {
      const src = this.loop('brown');
      src.connect(this.filter('lowpass', 900)).connect(level(0.6));
      nodes.push(src);
    }

    return () => {
      stops.forEach((stop) => stop());
      nodes.forEach((n) => n.stop());
    };
  }

  isPlaying(id: SoundId): boolean {
    return this.channels.has(id);
  }

  /** Включить или поменять громкость. Вызывать по нажатию — так браузер разрешает звук. */
  play(id: SoundId, volume: number): void {
    const { ctx, master } = this.audio();
    void ctx.resume();
    const existing = this.channels.get(id);
    if (existing) {
      existing.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.15);
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const stop = this.build(id, gain);
    gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.4);
    this.channels.set(id, { gain, stop });
  }

  stop(id: SoundId): void {
    const channel = this.channels.get(id);
    if (!channel || !this.ctx) return;
    this.channels.delete(id);
    channel.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    setTimeout(() => {
      channel.stop();
      channel.gain.disconnect();
    }, 900);
  }

  stopAll(): void {
    for (const id of [...this.channels.keys()]) this.stop(id);
  }

  setMaster(volume: number): void {
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.1);
  }

  /** Перерыв или пауза — звуки замолкают, потом продолжаются с того же места. */
  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.channels.size > 0) void this.ctx?.resume();
  }
}

export const ambience = new Ambience();

export interface SoundPrefs {
  volumes: Partial<Record<SoundId, number>>;
  master: number;
  pauseOnBreak: boolean;
}

const KEY = 'ou.sounds';
const DEFAULT_PREFS: SoundPrefs = { volumes: {}, master: 0.8, pauseOnBreak: true };

/** Что было включено в прошлый раз — удобство одного браузера, без него всё тоже работает. */
export function loadPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<SoundPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: SoundPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Без хранилища просто не запомнится.
  }
}

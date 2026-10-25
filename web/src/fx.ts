// Маленький праздник после записанного итога: конфетти и похвала. Без библиотек и без звука.

const COLORS = ['#4f6cf2', '#7b5ce8', '#a78bfa', '#38bdf8', '#f472b6', '#facc15', '#34d399'];
const DURATION_MS = 2600;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  angle: number;
  spin: number;
  round: boolean;
}

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function burst(width: number, height: number): Piece[] {
  const pieces: Piece[] = [];
  // Два залпа из нижних углов навстречу друг другу: слева — вверх и вправо, справа — вверх и влево.
  const scale = Math.max(0.7, height / 900);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 80; i++) {
      const tilt = (12 + Math.random() * 38) * (Math.PI / 180);
      const speed = (17 + Math.random() * 13) * scale;
      pieces.push({
        x: side < 0 ? width * 0.06 : width * 0.94,
        y: height + 10,
        vx: -side * Math.sin(tilt) * speed,
        vy: -Math.cos(tilt) * speed,
        size: 6 + Math.random() * 6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.4,
        round: Math.random() < 0.3,
      });
    }
  }
  return pieces;
}

function confetti() {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(ratio, ratio);
  const pieces = burst(width, height);
  const started = performance.now();
  let last = started;

  const frame = (now: number) => {
    const t = now - started;
    // Шаг — в долях кадра 60 Гц: на быстрых мониторах конфетти летят с той же скоростью.
    const step = Math.min(6, Math.max(0, now - last) / (1000 / 60));
    last = now;
    const drag = Math.pow(0.985, step);
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = Math.max(0, Math.min(1, (DURATION_MS - t) / 600));
    for (const p of pieces) {
      p.vy += 0.32 * step;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.angle += p.spin * step;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Прямоугольник «кувыркается»: высота меняется с поворотом.
        ctx.fillRect(
          -p.size / 2,
          -p.size / 4,
          p.size,
          (p.size / 2) * Math.abs(Math.cos(p.angle * 2)) + 1,
        );
      }
      ctx.restore();
    }
    if (t < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

function cheer(title: string, text: string) {
  const box = document.createElement('div');
  box.className = 'cheer';
  box.setAttribute('role', 'status');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = text;
  box.append(strong, span);
  document.body.append(box);
  setTimeout(() => box.remove(), DURATION_MS + 100);
}

/** Отметить сделанное: похвала всегда, конфетти — если система не просит обходиться без анимации. */
export function celebrate(title: string, text: string) {
  cheer(title, text);
  if (!calm()) confetti();
}

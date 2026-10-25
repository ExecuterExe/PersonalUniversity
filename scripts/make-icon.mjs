// Рисует значок «Мой университет» (шапочка выпускника на сине-фиолетовом квадрате)
// и сохраняет web/public/favicon.ico: он же — значок вкладки и ярлыка на рабочем столе.
// Запуск: node scripts/make-icon.mjs — нужен, только если поменялся рисунок.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const OUT = new URL('../web/public/favicon.ico', import.meta.url);
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SAMPLES = 4; // сглаживание: 4×4 точки на пиксель

const FROM = [0x4f, 0x6c, 0xf2];
const TO = [0x7b, 0x5c, 0xe8];

/** Фигуры в единичном квадрате: точка внутри многоугольника. */
function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const near = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

// Верх шапочки — ромб, под ним — тулья, справа — кисточка.
const TOP = [
  [0.14, 0.42],
  [0.5, 0.26],
  [0.86, 0.42],
  [0.5, 0.58],
];
const TOP_GAP = TOP.map(([x, y]) => [0.5 + (x - 0.5) * 1.1, 0.42 + (y - 0.42) * 1.28]);
const BASE = [
  [0.29, 0.5],
  [0.71, 0.5],
  [0.71, 0.66],
  [0.5, 0.74],
  [0.29, 0.66],
];

/** Цвет точки: null — прозрачно, иначе [r, g, b]. */
function colorAt(x, y) {
  if (!inRoundedSquare(x, y, 0.23)) return null;
  const white = [255, 255, 255];
  const t = Math.min(1, Math.max(0, (x + y) / 2));
  const bg = FROM.map((c, i) => Math.round(c + (TO[i] - c) * t));
  const tassel =
    (x >= 0.835 && x <= 0.885 && y >= 0.42 && y <= 0.66) || near(x, y, 0.86, 0.68, 0.05);
  if (inPolygon(x, y, TOP)) return white;
  if (tassel) return white;
  if (inPolygon(x, y, TOP_GAP)) return bg;
  if (inPolygon(x, y, BASE)) return white;
  return bg;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = colorAt((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = (py * size + px) * 4;
      if (a > 0) {
        rgba[o] = Math.round(r / a);
        rgba[o + 1] = Math.round(g / a);
        rgba[o + 2] = Math.round(b / a);
      }
      rgba[o + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return rgba;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size) {
  const rgba = render(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // глубина цвета
  ihdr.writeUInt8(6, 9); // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const images = SIZES.map(png);
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // значок
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((data, i) => {
  const size = SIZES[i];
  const e = 6 + i * 16;
  header.writeUInt8(size >= 256 ? 0 : size, e);
  header.writeUInt8(size >= 256 ? 0 : size, e + 1);
  header.writeUInt16LE(1, e + 4); // плоскости
  header.writeUInt16LE(32, e + 6); // бит на пиксель
  header.writeUInt32LE(data.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += data.length;
});

mkdirSync(new URL('.', OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, ...images]));
console.log(`Значок сохранён: ${fileURLToPath(OUT)} (${offset} байт)`);

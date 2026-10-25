import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/**
 * Собранный интерфейс (web/dist) с того же адреса, что и API: сервис — один процесс,
 * а вход через Google возвращается туда же, где открыт интерфейс.
 */
export function registerWeb(app: FastifyInstance, dir: string): void {
  const root = normalize(dir + sep);
  const index = join(root, 'index.html');

  app.get('/*', async (req, reply) => {
    let path: string;
    try {
      path = decodeURIComponent(req.url.split('?')[0] ?? '/');
    } catch {
      return reply.status(400).send({ error: 'Некорректный адрес' });
    }
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      return reply.status(404).send({ error: 'Не найдено' });
    }

    const file = normalize(join(root, path));
    const found = file.startsWith(root) && existsSync(file) && statSync(file).isFile();
    // Адреса без расширения — экраны интерфейса; отсутствующий файл с расширением — честный 404.
    if (!found && extname(path)) return reply.status(404).send({ error: 'Не найдено' });
    const target = found ? file : index;

    const immutable = target.includes(`${sep}assets${sep}`);
    return reply
      .header('content-type', TYPES[extname(target)] ?? 'application/octet-stream')
      .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(readFileSync(target));
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createShortcut, hasShortcut, removeShortcut, shortcutsSupported } from './shortcuts';

const shortcutsBody = z.object({
  desktop: z.boolean().optional(),
  autostart: z.boolean().optional(),
});

function status() {
  if (!shortcutsSupported) return { supported: false, desktop: false, autostart: false };
  return { supported: true, desktop: hasShortcut('desktop'), autostart: hasShortcut('startup') };
}

/** Ярлык на рабочем столе и автозапуск с Windows — переключаются из настроек. */
export function registerSystemRoutes(app: FastifyInstance): void {
  app.get('/api/system/shortcuts', () => status());

  app.put('/api/system/shortcuts', (req) => {
    const body = shortcutsBody.parse(req.body);
    if (shortcutsSupported) {
      if (body.desktop !== undefined) {
        if (body.desktop) createShortcut('desktop');
        else removeShortcut('desktop');
      }
      if (body.autostart !== undefined) {
        if (body.autostart) createShortcut('startup');
        else removeShortcut('startup');
      }
    }
    return status();
  });
}

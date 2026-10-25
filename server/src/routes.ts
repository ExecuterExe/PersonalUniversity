import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from './domain/context';
import { appSettings } from './domain/context';
import {
  listDecisions,
  makeupPreview,
  makeupPreviewInput,
  resolveDecision,
  resolveInput,
} from './domain/decisions';
import {
  addSource,
  archiveDiscipline,
  createDiscipline,
  deleteSource,
  disciplineInput,
  disciplinePatch,
  getDiscipline,
  sourceInput,
  sourcePatch,
  updateDiscipline,
  updateSource,
} from './domain/disciplines';
import { exportSummaries, summariesMarkdown } from './domain/maintenance';
import { stats, today } from './domain/overview';
import {
  applyChange,
  applyDraftCompromise,
  changeInput,
  confirmDraft,
  createDraft,
  discardDraft,
  draftInput,
  getActive,
  getDraft,
  previewChange,
  refreshDraft,
} from './domain/semesters';
import {
  currentTimer,
  finish,
  moveInput,
  moveSession,
  pause,
  resume,
  resumeInput,
  saveSummary,
  schedule,
  scheduleQuery,
  sessionDetails,
  skipSession,
  startSession,
  startUnplanned,
  summaryInput,
  unplannedInput,
} from './domain/sessions';
import { appSettingsSchema } from './settings';

const idParam = z.object({ id: z.string().min(1) });
const indexParam = z.object({ index: z.coerce.number().int().min(0) });

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  // Главный экран и статистика
  app.get('/api/today', () => today(deps));
  app.get('/api/stats', () => stats(deps));

  // Настройки
  app.get('/api/settings', () => appSettings(deps.store));
  app.put('/api/settings', (req) => {
    const settings = appSettingsSchema.parse(req.body);
    deps.store.saveSettings(settings);
    return settings;
  });

  // Дисциплины и источники
  app.get('/api/disciplines', (req) => {
    const { archived } = z.object({ archived: z.stringbool().default(false) }).parse(req.query);
    return deps.store.listDisciplines(archived);
  });
  app.post('/api/disciplines', (req, reply) => {
    reply.status(201);
    return createDiscipline(deps, disciplineInput.parse(req.body));
  });
  app.get('/api/disciplines/:id', (req) => {
    const { id } = idParam.parse(req.params);
    return { ...getDiscipline(deps, id), sources: deps.store.listSources(id) };
  });
  app.patch('/api/disciplines/:id', (req) =>
    updateDiscipline(deps, idParam.parse(req.params).id, disciplinePatch.parse(req.body)),
  );
  app.post('/api/disciplines/:id/archive', (req) =>
    archiveDiscipline(deps, idParam.parse(req.params).id),
  );
  app.get('/api/disciplines/:id/sources', (req) => {
    const { id } = idParam.parse(req.params);
    getDiscipline(deps, id);
    return deps.store.listSources(id);
  });
  app.post('/api/disciplines/:id/sources', (req, reply) => {
    reply.status(201);
    return addSource(deps, idParam.parse(req.params).id, sourceInput.parse(req.body));
  });
  app.patch('/api/sources/:id', (req) =>
    updateSource(deps, idParam.parse(req.params).id, sourcePatch.parse(req.body)),
  );
  app.delete('/api/sources/:id', (req, reply) => {
    deleteSource(deps, idParam.parse(req.params).id);
    return reply.status(204).send();
  });

  // Семестр: черновик → компромиссы → подтверждение
  app.post('/api/semesters/draft', (req, reply) => {
    reply.status(201);
    return createDraft(deps, draftInput.parse(req.body));
  });
  app.get('/api/semesters/draft', () => getDraft(deps));
  app.post('/api/semesters/draft/refresh', () => refreshDraft(deps));
  app.delete('/api/semesters/draft', (_req, reply) => {
    discardDraft(deps);
    return reply.status(204).send();
  });
  app.post('/api/semesters/draft/compromises/:index', (req) =>
    applyDraftCompromise(deps, indexParam.parse(req.params).index),
  );
  app.post('/api/semesters/draft/confirm', () => confirmDraft(deps));
  app.get('/api/semesters/active', () => getActive(deps));
  app.post('/api/semesters/active/changes/preview', (req) =>
    previewChange(deps, changeInput.parse(req.body)),
  );
  app.post('/api/semesters/active/changes/apply', (req) =>
    applyChange(deps, changeInput.parse(req.body)),
  );

  // Расписание и занятия
  app.get('/api/schedule', (req) => {
    const { from, to } = scheduleQuery.parse(req.query);
    return schedule(deps, from, to);
  });
  app.post('/api/sessions/unplanned', (req) =>
    startUnplanned(deps, unplannedInput.parse(req.body).disciplineId),
  );
  app.get('/api/sessions/:id', (req) => sessionDetails(deps, idParam.parse(req.params).id));
  app.post('/api/sessions/:id/start', (req) => startSession(deps, idParam.parse(req.params).id));
  app.post('/api/sessions/:id/move', (req) =>
    moveSession(deps, idParam.parse(req.params).id, moveInput.parse(req.body)),
  );
  app.post('/api/sessions/:id/skip', (req) => skipSession(deps, idParam.parse(req.params).id));
  app.post('/api/sessions/:id/summary', (req, reply) => {
    reply.status(201);
    return saveSummary(deps, idParam.parse(req.params).id, summaryInput.parse(req.body));
  });

  // Таймер идущего занятия
  app.get('/api/timer', () => currentTimer(deps));
  app.post('/api/timer/pause', () => pause(deps));
  app.post('/api/timer/resume', (req) =>
    resume(deps, resumeInput.parse(req.body ?? {}).countPaused),
  );
  app.post('/api/timer/finish', () => finish(deps));

  // Решения: вопросы сервиса
  app.get('/api/decisions', () => listDecisions(deps));
  app.post('/api/decisions/makeup-preview', (req) =>
    makeupPreview(deps, makeupPreviewInput.parse(req.body)),
  );
  app.post('/api/decisions/:id/resolve', (req) =>
    resolveDecision(deps, idParam.parse(req.params).id, resolveInput.parse(req.body)),
  );

  // Экспорт итогов
  app.get('/api/export/summaries', (req, reply) => {
    const { format } = z.object({ format: z.enum(['md', 'json']).default('md') }).parse(req.query);
    const data = exportSummaries(deps);
    if (format === 'json') return data;
    return reply
      .type('text/markdown; charset=utf-8')
      .header('content-disposition', 'attachment; filename="summaries.md"')
      .send(summariesMarkdown(data));
  });
}

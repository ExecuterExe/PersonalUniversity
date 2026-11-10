import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from './domain/context';
import {
  acknowledgeAward,
  chooseReward,
  createReward,
  deleteReward,
  preferencesInput,
  setProgressPreferences,
  progress,
  rewardInput,
  rewardPatch,
  setProgressTitle,
  updateReward,
  useReward,
} from './domain/progress';

export function registerProgressRoutes(app: FastifyInstance, deps: Deps) {
  const id = z.object({ id: z.string().min(1) });
  app.get('/api/progress', () => progress(deps));
  app.put('/api/progress/preferences', (req) =>
    setProgressPreferences(deps, preferencesInput.parse(req.body)),
  );
  app.delete('/api/progress/rewards/:id', (req, reply) => {
    deleteReward(deps, id.parse(req.params).id);
    return reply.status(204).send();
  });
  app.post('/api/progress/rewards', (req, reply) => {
    reply.status(201);
    return createReward(deps, rewardInput.parse(req.body));
  });
  app.patch('/api/progress/rewards/:id', (req) =>
    updateReward(deps, id.parse(req.params).id, rewardPatch.parse(req.body)),
  );
  app.post('/api/progress/awards/:id/choose', (req) =>
    chooseReward(
      deps,
      id.parse(req.params).id,
      z.object({ index: z.number().int().min(0).max(1) }).parse(req.body).index,
    ),
  );
  app.post('/api/progress/awards/:id/use', (req) => useReward(deps, id.parse(req.params).id));
  app.post('/api/progress/awards/:id/acknowledge', (req, reply) => {
    acknowledgeAward(deps, id.parse(req.params).id);
    return reply.status(204).send();
  });
  app.put('/api/progress/title', (req, reply) => {
    setProgressTitle(
      deps,
      z.object({ level: z.number().int().min(0).max(50) }).parse(req.body).level,
    );
    return reply.status(204).send();
  });
}

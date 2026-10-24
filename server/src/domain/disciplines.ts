import { ALLOWED_DURATIONS } from '@ou/engine';
import { z } from 'zod';
import type { DisciplineRecord, SourceRecord } from '../db/store';
import { conflict, notFound } from '../errors';
import type { Deps } from './context';

const text = (max: number, empty: string) => z.string().trim().min(1, empty).max(max);

export const disciplineInput = z.object({
  name: text(80, 'Назови дисциплину'),
  priority: z.enum(['main', 'additional']),
  durationMinutes: z
    .number()
    .int()
    .refine(
      (v) => (ALLOWED_DURATIONS as readonly number[]).includes(v),
      'Длительность занятия — 30, 45, 60, 75 или 90 минут',
    ),
  goal: text(2000, 'Напиши цель — чего хочешь достичь этой дисциплиной'),
  metrics: text(2000, 'Напиши метрики — как поймёшь, что цель достигнута'),
});

export const disciplinePatch = disciplineInput.partial();

export function getDiscipline(deps: Deps, id: string): DisciplineRecord {
  const d = deps.store.getDiscipline(id);
  if (!d) throw notFound('Дисциплина');
  return d;
}

export function createDiscipline(
  deps: Deps,
  input: z.infer<typeof disciplineInput>,
): DisciplineRecord {
  const record: DisciplineRecord = {
    id: deps.newId(),
    ...input,
    continueHint: '',
    archivedAt: null,
    createdAt: deps.now(),
  };
  deps.store.saveDiscipline(record);
  return record;
}

/** Идёт ли дисциплина в текущем семестре (не убрана из него). */
function inActiveSemester(deps: Deps, id: string): boolean {
  const active = deps.store.findSemester('active');
  return active !== null && active.frequencies[id] !== undefined;
}

export function updateDiscipline(
  deps: Deps,
  id: string,
  patch: z.infer<typeof disciplinePatch>,
): DisciplineRecord {
  const current = getDiscipline(deps, id);
  const changesPlan =
    (patch.priority !== undefined && patch.priority !== current.priority) ||
    (patch.durationMinutes !== undefined && patch.durationMinutes !== current.durationMinutes);
  if (changesPlan && inActiveSemester(deps, id)) {
    throw conflict(
      'Дисциплина идёт в текущем семестре: приоритет поменяется со следующего семестра, а длительность — через подсказку о калибровке',
    );
  }
  const next = { ...current, ...patch };
  deps.store.saveDiscipline(next);
  return next;
}

export function archiveDiscipline(deps: Deps, id: string): DisciplineRecord {
  const current = getDiscipline(deps, id);
  if (inActiveSemester(deps, id)) {
    throw conflict('Дисциплина идёт в текущем семестре — сначала убери её из расписания');
  }
  const next = { ...current, archivedAt: current.archivedAt ?? deps.now() };
  deps.store.saveDiscipline(next);
  return next;
}

export const sourceInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('link'),
    url: z.url({ protocol: /^https?$/, error: 'Нужна ссылка вида https://…' }),
    title: z.string().trim().max(200).optional(),
    note: z.string().trim().max(5000).optional(),
  }),
  z.object({
    kind: z.literal('note'),
    note: text(5000, 'Напиши текст заметки'),
    title: z.string().trim().max(200).optional(),
  }),
]);

export const sourcePatch = z.object({
  url: z.url({ protocol: /^https?$/, error: 'Нужна ссылка вида https://…' }).optional(),
  title: z.string().trim().max(200).optional(),
  note: z.string().trim().max(5000).optional(),
});

/** Заголовок по умолчанию: сайт для ссылки, первая строка для заметки. */
function defaultTitle(input: { kind: 'link' | 'note'; url?: string; note?: string }): string {
  if (input.kind === 'link' && input.url) return new URL(input.url).host;
  return (input.note ?? '').split('\n')[0]!.slice(0, 80);
}

export function addSource(
  deps: Deps,
  disciplineId: string,
  input: z.infer<typeof sourceInput>,
): SourceRecord {
  getDiscipline(deps, disciplineId);
  const record: SourceRecord = {
    id: deps.newId(),
    disciplineId,
    kind: input.kind,
    title: input.title || defaultTitle(input),
    url: input.kind === 'link' ? input.url : null,
    note: input.note ?? '',
    createdAt: deps.now(),
  };
  deps.store.saveSource(record);
  return record;
}

export function updateSource(
  deps: Deps,
  id: string,
  patch: z.infer<typeof sourcePatch>,
): SourceRecord {
  const current = deps.store.getSource(id);
  if (!current) throw notFound('Источник');
  if (patch.url !== undefined && current.kind !== 'link') {
    throw conflict('У заметки нет ссылки — добавь отдельный источник-ссылку');
  }
  const next: SourceRecord = {
    ...current,
    ...(patch.url !== undefined ? { url: patch.url } : {}),
    ...(patch.title !== undefined ? { title: patch.title || current.title } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
  };
  if (next.kind === 'note' && !next.note) throw conflict('Заметка не может быть пустой');
  deps.store.saveSource(next);
  return next;
}

export function deleteSource(deps: Deps, id: string): void {
  if (!deps.store.deleteSource(id)) throw notFound('Источник');
}

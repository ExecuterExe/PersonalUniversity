import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { appSettings, localDate, type Deps } from './context';

const KEEP_BACKUPS = 14;
const BACKUP_PATTERN = /^ou-\d{4}-\d{2}-\d{2}\.sqlite$/;

/**
 * Копия базы раз в день; хранятся последние 14. Возвращает путь новой копии
 * или null, если сегодня копия уже есть.
 */
export function backupIfDue(deps: Deps, dir: string): string | null {
  const { store } = deps;
  const date = localDate(deps.now(), appSettings(store).timezone);
  if (store.getMeta('lastBackupDate') === date) return null;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `ou-${date}.sqlite`);
  if (existsSync(path)) rmSync(path);
  store.db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  store.setMeta('lastBackupDate', date);
  const old = readdirSync(dir)
    .filter((f) => BACKUP_PATTERN.test(f))
    .sort()
    .reverse()
    .slice(KEEP_BACKUPS);
  for (const f of old) rmSync(join(dir, f));
  return path;
}

export interface ExportedSummary {
  date: string;
  keyConcepts: string;
  retelling: string;
  continueFrom: string;
}

export interface ExportedDiscipline {
  name: string;
  goal: string;
  metrics: string;
  summaries: ExportedSummary[];
}

/** Все итоги занятий по дисциплинам — на будущее, для практических занятий. */
export function exportSummaries(deps: Deps): ExportedDiscipline[] {
  const { store } = deps;
  const timezone = appSettings(store).timezone;
  const byDiscipline = new Map<string, ExportedDiscipline>();
  for (const s of store.listSummaries()) {
    const d = store.getDiscipline(s.disciplineId);
    const session = store.getSession(s.semesterId, s.sessionId);
    const entry = byDiscipline.get(s.disciplineId) ?? {
      name: d?.name ?? s.disciplineId,
      goal: d?.goal ?? '',
      metrics: d?.metrics ?? '',
      summaries: [],
    };
    entry.summaries.push({
      date: localDate(session?.start ?? s.createdAt, timezone),
      keyConcepts: s.keyConcepts,
      retelling: s.retelling,
      continueFrom: s.continueFrom,
    });
    byDiscipline.set(s.disciplineId, entry);
  }
  return [...byDiscipline.values()];
}

export function summariesMarkdown(disciplines: readonly ExportedDiscipline[]): string {
  const lines = ['# Итоги занятий', ''];
  for (const d of disciplines) {
    lines.push(`## ${d.name}`, '', `**Цель:** ${d.goal}`, '', `**Метрики:** ${d.metrics}`, '');
    for (const s of d.summaries) {
      lines.push(`### ${s.date}`, '');
      if (s.keyConcepts) lines.push('**Ключевые понятия**', '', s.keyConcepts, '');
      if (s.retelling) lines.push('**Пересказ**', '', s.retelling, '');
      if (s.continueFrom) lines.push(`**С чего продолжить:** ${s.continueFrom}`, '');
    }
  }
  return lines.join('\n');
}

import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Deps } from './context';
import type { Session } from '@ou/engine';
import { badRequest, conflict, notFound } from '../errors';
import { QUALITIES } from './qualities';

// Будущие звания не отправляются в интерфейс, пока не открыт соответствующий уровень.
export const TITLES = [
  'Переступивший порог',
  'Ловец вопросов',
  'Искатель зацепок',
  'Разведчик смыслов',
  'Собиратель ясности',
  'Ученик с характером',
  'Охотник за причинами',
  'Переводчик сложного',
  'Испытатель гипотез',
  'Картограф неизвестного',
  'Нарушитель шаблонов',
  'Следопыт закономерностей',
  'Укротитель пробелов',
  'Скептик с аргументами',
  'Исследователь глубины',
  'Собиратель связей',
  'Мастер второго взгляда',
  'Навигатор сомнений',
  'Археолог идей',
  'Строитель понимания',
  'Хранитель любопытства',
  'Исследователь без карты',
  'Проводник через сложное',
  'Ловец противоречий',
  'Автор точных вопросов',
  'Архитектор гипотез',
  'Укротитель неопределённости',
  'Мастер содержательных споров',
  'Создатель новых связей',
  'Режиссёр открытий',
  'Настройщик собственного мышления',
  'Проводник между дисциплинами',
  'Искатель скрытых оснований',
  'Мастер неожиданных ракурсов',
  'Собиратель собственной школы',
  'Исследователь на своей территории',
  'Архитектор самостоятельности',
  'Хранитель сложных вопросов',
  'Навигатор непознанного',
  'Автор собственного взгляда',
  'Испытатель границ понимания',
  'Строитель интеллектуальных мостов',
  'Мастер возвращаться к трудному',
  'Создатель пространства идей',
  'Исследователь новых горизонтов',
  'Хранитель огня познания',
  'Архитектор своей траектории',
  'Автор открытых горизонтов',
  'Мастер учиться заново',
  'Основатель собственного университета',
] as const;
export const LESSON_XP = 100;

export function levelFor(xp: number) {
  let level = 1;
  let floor = 0;
  while (level < 50) {
    const cost = 100 + (level - 1) * 20;
    if (xp < floor + cost) break;
    floor += cost;
    level++;
  }
  return { level, floor, next: level === 50 ? null : floor + 100 + (level - 1) * 20 };
}

type Row = Record<string, unknown>;
export interface RewardOffer {
  id: string;
  title: string;
}
export interface StudyAward {
  quality: { id: number; word: string } | null;
  qualityOutcome: 'legacy' | 'found' | 'miss' | 'complete' | 'disabled';
  id: string;
  disciplineName: string;
  xp: number;
  levelBefore: number;
  levelAfter: number;
  unlocked: { level: number; title: string }[];
  offers: RewardOffer[];
  chosenIndex: number | null;
  usedAt: number | null;
  createdAt: number;
}
function awardView(row: Row): StudyAward {
  const before = Number(row.level_before),
    after = Number(row.level_after);
  return {
    quality:
      row.quality_id === null || row.quality_id === undefined
        ? null
        : { id: Number(row.quality_id), word: QUALITIES[Number(row.quality_id)]! },
    qualityOutcome: (row.quality_outcome ?? 'legacy') as StudyAward['qualityOutcome'],
    id: String(row.id),
    disciplineName: String(row.discipline_name),
    xp: Number(row.xp),
    levelBefore: before,
    levelAfter: after,
    unlocked: TITLES.slice(before, after).map((title, i) => ({ level: before + i + 1, title })),
    offers: JSON.parse(String(row.offers)) as RewardOffer[],
    chosenIndex: row.chosen_index === null ? null : Number(row.chosen_index),
    usedAt: row.used_at === null ? null : Number(row.used_at),
    createdAt: Number(row.created_at),
  };
}
function totalXp(deps: Deps): number {
  return Number(
    deps.store.db.prepare('SELECT COALESCE(SUM(xp),0) AS xp FROM study_awards').get()!.xp,
  );
}

export function progressPreferences(deps: Deps) {
  return {
    rewardsEnabled: deps.store.getMeta('pleasantRewardsEnabled') !== '0',
    qualitiesEnabled: deps.store.getMeta('qualityCollectionEnabled') !== '0',
  };
}
export const preferencesInput = z.object({
  rewardsEnabled: z.boolean().optional(),
  qualitiesEnabled: z.boolean().optional(),
});
export function setProgressPreferences(deps: Deps, input: z.infer<typeof preferencesInput>) {
  deps.store.transaction(() => {
    if (input.rewardsEnabled !== undefined)
      deps.store.setMeta('pleasantRewardsEnabled', input.rewardsEnabled ? '1' : '0');
    if (input.qualitiesEnabled !== undefined)
      deps.store.setMeta('qualityCollectionEnabled', input.qualitiesEnabled ? '1' : '0');
  });
  return progressPreferences(deps);
}

/** Первый независимый бросок — ровно 1/2, затем равномерный выбор среди ещё не открытых слов. */
export function rollQuality(
  owned: ReadonlySet<number>,
  draw: (max: number) => number = randomInt,
): { id: number | null; outcome: 'found' | 'miss' | 'complete' } {
  const remaining = QUALITIES.map((_, id) => id).filter((id) => !owned.has(id));
  if (!remaining.length) return { id: null, outcome: 'complete' };
  if (draw(2) !== 0) return { id: null, outcome: 'miss' };
  return { id: remaining[draw(remaining.length)]!, outcome: 'found' };
}

/** Вызывается внутри транзакции сохранения итога. Уникальный ключ защищает от повторного начисления. */
export function awardLesson(deps: Deps, semesterId: string, session: Session): StudyAward | null {
  if ((session.actualMinutes ?? 0) < 1) return null;
  const db = deps.store.db;
  const previous = db
    .prepare('SELECT * FROM study_awards WHERE semester_id = ? AND session_id = ?')
    .get(semesterId, session.id);
  if (previous) return awardView(previous);
  const preferences = progressPreferences(deps);
  const owned = new Set(
    db
      .prepare('SELECT word_id FROM quality_collection')
      .all()
      .map((r) => Number(r.word_id)),
  );
  const quality = preferences.qualitiesEnabled
    ? rollQuality(owned)
    : { id: null, outcome: 'disabled' as const };
  const pool = (preferences.rewardsEnabled
    ? db.prepare('SELECT id,title FROM reward_options WHERE enabled = 1 ORDER BY id').all()
    : []) as unknown as RewardOffer[];
  const offers: RewardOffer[] = [];
  while (offers.length < 2 && pool.length) offers.push(pool.splice(randomInt(pool.length), 1)[0]!);
  const xp = totalXp(deps);
  const id = deps.newId();
  db.prepare(
    `INSERT INTO study_awards (id,semester_id,session_id,discipline_name,xp,level_before,level_after,offers,created_at,quality_id,quality_outcome)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    semesterId,
    session.id,
    deps.store.getDiscipline(session.disciplineId, true)?.name ?? 'Занятие',
    LESSON_XP,
    levelFor(xp).level,
    levelFor(xp + LESSON_XP).level,
    JSON.stringify(offers),
    deps.now(),
    quality.id,
    quality.outcome,
  );
  if (quality.id !== null)
    db.prepare('INSERT INTO quality_collection(word_id,award_id,found_at) VALUES (?,?,?)').run(
      quality.id,
      id,
      deps.now(),
    );
  return awardView(db.prepare('SELECT * FROM study_awards WHERE id = ?').get(id)!);
}

export function progress(deps: Deps) {
  const db = deps.store.db;
  const xp = totalXp(deps);
  const level = levelFor(xp);
  const preferred = Number(deps.store.getMeta('progressTitleLevel'));
  const titleLevel =
    Number.isInteger(preferred) && preferred >= 1 && preferred <= level.level
      ? preferred
      : level.level;
  const pending = db
    .prepare(
      'SELECT * FROM study_awards WHERE acknowledged_at IS NULL ORDER BY created_at,id LIMIT 1',
    )
    .get();
  const choices = db.prepare('SELECT id,title,enabled FROM reward_options ORDER BY rowid').all();
  const earned = db.prepare('SELECT COUNT(*) AS n FROM study_awards').get()!;
  return {
    ...progressPreferences(deps),
    collection: db
      .prepare('SELECT word_id,found_at FROM quality_collection ORDER BY found_at DESC,word_id')
      .all()
      .map((r) => ({
        id: Number(r.word_id),
        word: QUALITIES[Number(r.word_id)]!,
        foundAt: Number(r.found_at),
      })),
    collectionSize: QUALITIES.length,
    xp,
    level: level.level,
    levelFloor: level.floor,
    nextLevelXp: level.next,
    title: TITLES[titleLevel - 1]!,
    titleLevel,
    titlePinned: preferred >= 1 && preferred <= level.level,
    lessons: Number(earned.n),
    unlocked: TITLES.slice(0, level.level).map((title, i) => ({ level: i + 1, title })),
    options: choices.map((c) => ({
      id: String(c.id),
      title: String(c.title),
      enabled: c.enabled === 1,
    })),
    pending: pending ? awardView(pending) : null,
    wallet: db
      .prepare(
        "SELECT * FROM study_awards WHERE used_at IS NULL AND offers != '[]' ORDER BY created_at DESC,id",
      )
      .all()
      .map(awardView),
    used: db
      .prepare(
        'SELECT * FROM study_awards WHERE used_at IS NOT NULL ORDER BY used_at DESC,id LIMIT 20',
      )
      .all()
      .map(awardView),
  };
}

export const rewardInput = z.object({ title: z.string().trim().min(1, 'Напиши награду').max(120) });
export const rewardPatch = rewardInput.partial().extend({ enabled: z.boolean().optional() });
function checkRewardTitle(deps: Deps, title: string, exceptId?: string) {
  const rows = deps.store.db.prepare('SELECT id,title FROM reward_options WHERE enabled = 1').all();
  if (
    rows.some(
      (r) =>
        r.id !== exceptId &&
        String(r.title).toLocaleLowerCase('ru') === title.toLocaleLowerCase('ru'),
    )
  )
    throw conflict('Такая награда уже включена в набор');
}
export function createReward(deps: Deps, input: z.infer<typeof rewardInput>) {
  checkRewardTitle(deps, input.title);
  const count = Number(
    deps.store.db.prepare('SELECT COUNT(*) AS n FROM reward_options WHERE enabled = 1').get()!.n,
  );
  if (count >= 30) throw conflict('В наборе уже 30 наград — сначала отключи ненужные');
  const id = deps.newId();
  deps.store.db.prepare('INSERT INTO reward_options (id,title) VALUES (?,?)').run(id, input.title);
  return { id, title: input.title, enabled: true };
}
export function updateReward(deps: Deps, id: string, input: z.infer<typeof rewardPatch>) {
  const db = deps.store.db;
  const old = db.prepare('SELECT * FROM reward_options WHERE id = ?').get(id);
  if (!old) throw notFound('Награда');
  if (input.enabled !== false && (input.enabled === true || old.enabled === 1))
    checkRewardTitle(deps, input.title ?? String(old.title), id);
  if (
    input.enabled &&
    old.enabled === 0 &&
    Number(db.prepare('SELECT COUNT(*) AS n FROM reward_options WHERE enabled = 1').get()!.n) >= 30
  )
    throw conflict('В наборе уже 30 наград');
  db.prepare('UPDATE reward_options SET title = ?, enabled = ? WHERE id = ?').run(
    input.title ?? String(old.title),
    input.enabled === undefined ? Number(old.enabled) : Number(input.enabled),
    id,
  );
  return { id, title: input.title ?? old.title, enabled: input.enabled ?? old.enabled === 1 };
}
export function deleteReward(deps: Deps, id: string) {
  const result = deps.store.db.prepare('DELETE FROM reward_options WHERE id = ?').run(id);
  if (!result.changes) throw notFound('Награда');
}
export function chooseReward(deps: Deps, id: string, index: number) {
  return deps.store.transaction(() => {
    const db = deps.store.db;
    const row = db.prepare('SELECT * FROM study_awards WHERE id = ?').get(id);
    if (!row) throw notFound('Заработанная награда');
    const award = awardView(row);
    if (!award.offers[index]) throw badRequest('Нет такого варианта награды');
    if (award.chosenIndex !== null && award.chosenIndex !== index)
      throw conflict('Награда уже выбрана — обнови страницу');
    db.prepare(
      'UPDATE study_awards SET chosen_index = ?, chosen_at = COALESCE(chosen_at,?) WHERE id = ?',
    ).run(index, deps.now(), id);
    return awardView(db.prepare('SELECT * FROM study_awards WHERE id = ?').get(id)!);
  });
}
export function useReward(deps: Deps, id: string) {
  const db = deps.store.db;
  const row = db.prepare('SELECT * FROM study_awards WHERE id = ?').get(id);
  if (!row) throw notFound('Заработанная награда');
  if (row.chosen_index === null) throw conflict('Сначала выбери награду');
  db.prepare('UPDATE study_awards SET used_at = COALESCE(used_at,?) WHERE id = ?').run(
    deps.now(),
    id,
  );
  return awardView(db.prepare('SELECT * FROM study_awards WHERE id = ?').get(id)!);
}
export function acknowledgeAward(deps: Deps, id: string) {
  const result = deps.store.db
    .prepare('UPDATE study_awards SET acknowledged_at = COALESCE(acknowledged_at,?) WHERE id = ?')
    .run(deps.now(), id);
  if (!result.changes) throw notFound('Заработанная награда');
}
export function setProgressTitle(deps: Deps, level: number) {
  if (level === 0) {
    deps.store.setMeta('progressTitleLevel', '');
    return;
  }
  if (level > levelFor(totalXp(deps)).level) throw conflict('Это звание ещё не открыто');
  deps.store.setMeta('progressTitleLevel', String(level));
}

import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noCalendar } from '../calendar';
import { openDatabase } from '../db/database';
import { Store } from '../db/store';
import { msk, testApp, userSemester, USER_SETTINGS, type TestApp } from '../testing';
import { awardLesson, levelFor, progress, TITLES } from './progress';
import { createDiscipline } from './disciplines';
import { confirmDraft, createDraft } from './semesters';
import { saveSummary } from './sessions';
import { appSettingsSchema } from '../settings';

async function fixture() {
  const t = testApp(msk('2026-10-24T21:10'));
  const { semester, tf, sql } = await userSemester(t);
  const sessions = t.deps.store.loadSessions(semester.id);
  return { t, semester, tf, sql, sessions };
}
async function finishLesson(
  t: TestApp,
  semesterId: string,
  sessionId: string,
  minutes = 30,
  extra: Record<string, string> = {},
) {
  const store = t.deps.store;
  store.saveSession(semesterId, {
    ...store.getSession(semesterId, sessionId)!,
    status: 'held',
    actualMinutes: minutes,
  });
  return t.call('POST', `/api/sessions/${sessionId}/summary`, {
    retelling: 'Прошёл задания',
    ...extra,
  });
}

describe('опыт, звания и личные награды', () => {
  it('содержит 50 уникальных званий и корректные границы уровней', () => {
    expect(TITLES).toHaveLength(50);
    expect(new Set(TITLES).size).toBe(50);
    expect(levelFor(0)).toEqual({ level: 1, floor: 0, next: 100 });
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100)).toEqual({ level: 2, floor: 100, next: 220 });
    expect(levelFor(219).level).toBe(2);
    expect(levelFor(220).level).toBe(3);
    expect(levelFor(28_420)).toEqual({ level: 50, floor: 28_420, next: null });
    expect(levelFor(1_000_000).level).toBe(50);
  });
  it('сохранение простого итога начисляет 100 XP ровно один раз; будущие звания скрыты', async () => {
    const { t, semester, sessions } = await fixture();
    const first = sessions[0]!;
    const saved = await finishLesson(t, semester.id, first.id);
    expect(saved.status).toBe(201);
    expect(saved.body.award).toMatchObject({ xp: 100, levelBefore: 1, levelAfter: 2 });
    const state = (await t.call('GET', '/api/progress')).body;
    expect(state).toMatchObject({ xp: 100, level: 2, lessons: 1, title: TITLES[1] });
    expect(state.unlocked).toHaveLength(2);
    expect(JSON.stringify(state)).not.toContain(TITLES[2]);
    expect(state.pending.id).toBe(saved.body.award.id);
    expect(state.wallet[0].offers).toHaveLength(2);
    expect(new Set(state.wallet[0].offers.map((x: { id: string }) => x.id)).size).toBe(2);
    const duplicate = await Promise.all([
      t.call('POST', `/api/sessions/${first.id}/summary`, { retelling: 'Повтор' }),
      t.call('POST', `/api/sessions/${first.id}/summary`, { retelling: 'Ещё повтор' }),
    ]);
    expect(duplicate.every((r) => r.status === 409)).toBe(true);
    expect((await t.call('GET', '/api/progress')).body.xp).toBe(100);
    t.deps.store.transaction(() =>
      awardLesson(t.deps, semester.id, t.deps.store.getSession(semester.id, first.id)!),
    );
    expect((await t.call('GET', '/api/progress')).body.lessons).toBe(1);
    expect((await t.call('PUT', '/api/progress/title', { level: 3 })).status).toBe(409);
    expect((await t.call('PUT', '/api/progress/title', { level: 1 })).status).toBe(204);
    expect((await t.call('GET', '/api/progress')).body.title).toBe(TITLES[0]);
    await t.call('PUT', '/api/progress/title', { level: 0 });
    expect((await t.call('GET', '/api/progress')).body.title).toBe(TITLES[1]);
  });
  it('пустое, незавершённое или нулевое занятие не приносит опыт', async () => {
    const { t, semester, sessions } = await fixture();
    expect(
      (await t.call('POST', `/api/sessions/${sessions[0]!.id}/summary`, { retelling: 'Пропуск' }))
        .status,
    ).toBe(409);
    const saved = await finishLesson(t, semester.id, sessions[0]!.id, 0);
    expect(saved.status).toBe(201);
    expect(saved.body.award).toBeNull();
    expect((await t.call('POST', `/api/sessions/${sessions[1]!.id}/summary`, {})).status).toBe(400);
    expect((await t.call('GET', '/api/progress')).body.xp).toBe(0);
  });
  it('выбор и использование награды повторяемы без дублей; редактирование набора не меняет заработанное', async () => {
    const { t, semester, sessions } = await fixture();
    const saved = await finishLesson(t, semester.id, sessions[0]!.id);
    const award = saved.body.award;
    let calendarChanges = 0;
    t.deps.afterChange = () => {
      calendarChanges++;
    };
    expect((await t.call('POST', `/api/progress/awards/${award.id}/use`)).status).toBe(409);
    expect(
      (await t.call('POST', `/api/progress/awards/${award.id}/choose`, { index: 2 })).status,
    ).toBe(400);
    await t.call('PATCH', `/api/progress/rewards/${award.offers[0].id}`, {
      title: 'Другое название',
      enabled: false,
    });
    expect((await t.call('GET', '/api/progress')).body.pending.offers).toEqual(award.offers);
    for (let i = 0; i < 2; i++)
      expect(
        (await t.call('POST', `/api/progress/awards/${award.id}/choose`, { index: 0 })).status,
      ).toBe(200);
    expect(
      (await t.call('POST', `/api/progress/awards/${award.id}/choose`, { index: 1 })).status,
    ).toBe(409);
    await t.call('POST', `/api/progress/awards/${award.id}/acknowledge`);
    expect((await t.call('GET', '/api/progress')).body.pending).toBeNull();
    const used = await t.call('POST', `/api/progress/awards/${award.id}/use`);
    t.advance(10);
    expect((await t.call('POST', `/api/progress/awards/${award.id}/use`)).body.usedAt).toBe(
      used.body.usedAt,
    );
    const state = (await t.call('GET', '/api/progress')).body;
    expect(state.wallet).toEqual([]);
    expect(state.used).toHaveLength(1);
    expect(state.xp).toBe(100);
    expect(calendarChanges).toBe(0);
    expect((await t.call('POST', '/api/progress/awards/missing/use')).status).toBe(404);
  });
  it('работает с нулём и одной наградой; проверяет названия и не дублирует варианты', async () => {
    const { t, semester, sessions } = await fixture();
    const options = (await t.call('GET', '/api/progress')).body.options;
    for (const o of options)
      await t.call('PATCH', `/api/progress/rewards/${o.id}`, { enabled: false });
    const first = await finishLesson(t, semester.id, sessions[0]!.id);
    expect(first.body.award.offers).toEqual([]);
    const created = await t.call('POST', '/api/progress/rewards', { title: 'Серия аниме' });
    expect(created.status).toBe(201);
    expect(
      (await t.call('POST', '/api/progress/rewards', { title: '  серия АНИМЕ  ' })).status,
    ).toBe(409);
    expect((await t.call('POST', '/api/progress/rewards', { title: ' ' })).status).toBe(400);
    const next = await finishLesson(t, semester.id, sessions[1]!.id);
    expect(next.body.award.offers).toEqual([{ id: created.body.id, title: 'Серия аниме' }]);
    expect(
      (await t.call('POST', `/api/progress/awards/${next.body.award.id}/choose`, { index: 1 }))
        .status,
    ).toBe(400);
    expect((await t.call('GET', '/api/progress')).body.xp).toBe(200);
  });
  it('итог и опыт сохраняются атомарно; сбой награды не оставляет половину результата', async () => {
    const { t, semester, sessions } = await fixture();
    const first = await finishLesson(t, semester.id, sessions[0]!.id);
    const s = sessions[1]!;
    const collectionBefore = progress(t.deps).collection;
    t.deps.store.saveSession(semester.id, { ...s, status: 'held', actualMinutes: 20 });
    t.deps.newId = () => first.body.award.id;
    expect(() =>
      saveSummary(t.deps, s.id, {
        keyConcepts: 'Тема',
        retelling: '',
        continueFrom: '',
        nextQuestion: 'Вопрос',
      }),
    ).toThrow();
    expect(t.deps.store.getSummary(semester.id, s.id)).toBeNull();
    expect(progress(t.deps).collection).toEqual(collectionBefore);
    expect((await t.call('GET', '/api/progress')).body.xp).toBe(100);
  });
  it('вопрос относится к своей дисциплине, необязателен и попадает в практику и экспорт', async () => {
    const { t, semester, sessions, tf, sql } = await fixture();
    const lessons = sessions.filter((s) => s.disciplineId === tf.id);
    await finishLesson(t, semester.id, lessons[0]!.id, 30, {
      nextQuestion: 'Почему это работает?',
    });
    const next = await t.call('GET', `/api/sessions/${lessons[1]!.id}`);
    expect(next.body.nextQuestion).toBe('Почему это работает?');
    expect(
      (await t.call('GET', `/api/sessions/${sessions.find((s) => s.disciplineId === sql.id)!.id}`))
        .body.nextQuestion,
    ).toBe('');
    const notes = (await t.call('GET', '/api/practice/summaries')).body;
    expect(notes[0].nextQuestion).toBe('Почему это работает?');
    expect(
      (await t.call('POST', '/api/practice/prompt', { summaryIds: [notes[0].id] })).body.prompt,
    ).toContain('Почему это работает?');
    expect((await t.call('GET', '/api/export/summaries')).text).toContain('Почему это работает?');
    await finishLesson(t, semester.id, lessons[1]!.id);
    expect((await t.call('GET', `/api/sessions/${lessons[2]!.id}`)).body.nextQuestion).toBe('');
    await t.call('DELETE', `/api/semesters/${semester.id}`);
    const state = (await t.call('GET', '/api/progress')).body;
    expect(state.xp).toBe(200);
    expect(state.wallet).toHaveLength(2);
  });
  it('обновляет прежнюю базу без наград за старые записи и сохраняет новое начисление при перезапуске', async () => {
    const path = join(tmpdir(), `ou-progress-${randomUUID()}.sqlite`);
    let db = openDatabase(path);
    const deps = {
      store: new Store(db),
      calendar: noCalendar,
      now: () => msk('2026-10-24T21:10'),
      newId: () => randomUUID(),
    };
    try {
      deps.store.saveSettings(appSettingsSchema.parse(USER_SETTINGS));
      const d = createDiscipline(deps, {
        name: 'SQL',
        priority: 'main',
        durationMinutes: 60,
        goal: 'Цель',
        metrics: 'Метрика',
      });
      const draft = await createDraft(deps, {
        startDate: '2026-10-26',
        disciplineIds: [d.id],
        fullWeeks: 2,
      });
      confirmDraft(deps);
      const sessions = deps.store.loadSessions(draft.id);
      deps.store.saveSummary({
        semesterId: draft.id,
        sessionId: sessions[0]!.id,
        disciplineId: d.id,
        keyConcepts: 'Старые записи',
        retelling: '',
        continueFrom: '',
        createdAt: 1,
      });
      db.exec(
        'ALTER TABLE summaries DROP COLUMN next_question; DROP TABLE quality_collection; DROP TABLE study_awards; DROP TABLE reward_options; PRAGMA user_version = 3',
      );
      db.close();
      db = openDatabase(path);
      deps.store = new Store(db);
      expect(progress(deps).xp).toBe(0);
      expect(deps.store.listSummaries()[0]?.keyConcepts).toBe('Старые записи');
      const s = sessions[1]!;
      deps.store.saveSession(draft.id, { ...s, status: 'held', actualMinutes: 30 });
      const saved = saveSummary(deps, s.id, {
        keyConcepts: '',
        retelling: 'Сделано',
        continueFrom: '',
        nextQuestion: 'Мой вопрос',
      });
      const offers = saved.award!.offers;
      // Моделируем обновление с предыдущей версии без коллекции слов.
      db.exec(
        'DROP TABLE quality_collection; ALTER TABLE study_awards DROP COLUMN quality_id; ALTER TABLE study_awards DROP COLUMN quality_outcome; PRAGMA user_version = 4',
      );
      deps.store.setMeta('pleasantRewardsEnabled', '0');
      deps.store.setMeta('qualityCollectionEnabled', '0');
      db.close();
      db = openDatabase(path);
      deps.store = new Store(db);
      expect(progress(deps).xp).toBe(100);
      expect(progress(deps).pending?.offers).toEqual(offers);
      expect(progress(deps).pending?.qualityOutcome).toBe('legacy');
      expect(progress(deps).collection).toEqual([]);
      expect(progress(deps).rewardsEnabled).toBe(false);
      expect(progress(deps).qualitiesEnabled).toBe(false);
      expect(deps.store.getSummary(draft.id, s.id)?.nextQuestion).toBe('Мой вопрос');
    } finally {
      db.close();
      for (const suffix of ['', '-wal', '-shm'])
        if (existsSync(path + suffix)) unlinkSync(path + suffix);
    }
  });
});

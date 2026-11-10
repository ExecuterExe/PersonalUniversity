import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db/database';
import { Store } from '../db/store';
import { createDiscipline, msk, testApp, userSemester, USER_SETTINGS } from '../testing';
import { semesterView } from './semesters';

describe('удаление дисциплины из библиотеки', () => {
  it('обновляет прежнюю базу, сохраняя карточки и источники', () => {
    const path = join(tmpdir(), `ou-deletion-migration-${randomUUID()}.sqlite`);
    let db = openDatabase(path);
    try {
      db.exec(`ALTER TABLE disciplines DROP COLUMN deleted_at;
        ALTER TABLE summaries DROP COLUMN next_question;
        DROP TABLE quality_collection;
        DROP TABLE study_awards;
        DROP TABLE reward_options;
        PRAGMA user_version = 2;
        INSERT INTO disciplines (id, name, priority, duration_minutes, goal, metrics, created_at)
        VALUES ('kept', 'Существующая книга', 'main', 60, 'Цель', 'Метрика', 1);
        INSERT INTO sources (id, discipline_id, kind, title, note, created_at)
        VALUES ('kept-source', 'kept', 'note', 'Материал', 'Содержимое', 1);`);
      db.close();
      db = openDatabase(path);
      const store = new Store(db);
      expect(store.listDisciplines()[0]?.name).toBe('Существующая книга');
      expect(store.listSources('kept')[0]?.note).toBe('Содержимое');
      expect(store.deleteDiscipline('kept', 2)).toBe(true);
      expect(store.listDisciplines(true)).toEqual([]);
      expect(store.getDiscipline('kept', true)?.name).toBe('Существующая книга');
    } finally {
      db.close();
      for (const suffix of ['', '-wal', '-shm'])
        if (existsSync(path + suffix)) unlinkSync(path + suffix);
    }
  });
  it('удаляет свободную карточку вместе с источниками, включая архив, без возможности вернуть через API', async () => {
    const t = testApp(msk('2026-10-24T21:10'));
    const d = await createDiscipline(t, 'Законченная книга');
    const other = await createDiscipline(t, 'SQL');
    const source = await t.call('POST', `/api/disciplines/${d.id}/sources`, {
      kind: 'note',
      note: 'Материалы',
    });
    expect(source.status).toBe(201);
    await t.call('POST', `/api/disciplines/${d.id}/archive`);
    expect((await t.call('GET', `/api/disciplines/${d.id}`)).body.deletion).toEqual({
      allowed: true,
      reason: null,
    });
    expect((await t.call('DELETE', `/api/disciplines/${d.id}`)).status).toBe(204);
    for (const query of ['', '?archived=true']) {
      expect(
        (await t.call('GET', `/api/disciplines${query}`)).body.map((x: { id: string }) => x.id),
      ).toEqual([other.id]);
    }
    expect(t.deps.store.listSources(d.id)).toEqual([]);
    expect((await t.call('GET', `/api/disciplines/${d.id}`)).status).toBe(404);
    expect((await t.call('PATCH', `/api/disciplines/${d.id}`, { name: 'Вернуть' })).status).toBe(
      404,
    );
    expect((await t.call('DELETE', `/api/disciplines/${d.id}`)).status).toBe(404);
    expect(
      (await t.call('POST', `/api/disciplines/${d.id}/sources`, { kind: 'note', note: 'Вернуть' }))
        .status,
    ).toBe(404);
  });

  it('блокирует удаление из текущего семестра, в том числе после исключения из расписания', async () => {
    const t = testApp(msk('2026-10-24T21:10'));
    const { tf, semester } = await userSemester(t);
    const before = t.deps.store.loadSessions(semester.id);
    expect((await t.call('GET', `/api/disciplines/${tf.id}`)).body.deletion.allowed).toBe(false);
    const blocked = await t.call('DELETE', `/api/disciplines/${tf.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain('текущим семестром');
    expect(t.deps.store.loadSessions(semester.id)).toEqual(before);
    expect(
      (
        await t.call('POST', '/api/semesters/active/changes/apply', {
          type: 'remove',
          disciplineId: tf.id,
        })
      ).status,
    ).toBe(200);
    expect((await t.call('DELETE', `/api/disciplines/${tf.id}`)).status).toBe(409);
    expect((await t.call('GET', '/api/stats')).status).toBe(200);
  });

  it('блокирует удаление из черновика и проверяет состояние повторно при удалении', async () => {
    const t = testApp(msk('2026-10-24T21:10'));
    await t.call('PUT', '/api/settings', USER_SETTINGS);
    const d = await createDiscipline(t, 'SQL');
    expect((await t.call('GET', `/api/disciplines/${d.id}`)).body.deletion.allowed).toBe(true);
    await t.call('POST', '/api/semesters/draft', {
      startDate: '2026-10-26',
      disciplineIds: [d.id],
    });
    const blocked = await t.call('DELETE', `/api/disciplines/${d.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain('черновик');
    expect((await t.call('POST', '/api/semesters/draft/confirm')).status).toBe(200);
  });

  it('после семестра сохраняет названия, итоги и историю для практики, экспорта и обзора', async () => {
    const t = testApp(msk('2026-10-24T21:10'));
    const { tf, sql, semester } = await userSemester(t);
    const store = t.deps.store;
    const s = store.loadSessions(semester.id).find((s) => s.disciplineId === tf.id)!;
    store.saveSummary({
      semesterId: semester.id,
      sessionId: s.id,
      disciplineId: tf.id,
      keyConcepts: 'Изученная тема',
      retelling: 'Мои заметки',
      continueFrom: 'Продолжение',
      createdAt: s.start,
    });
    store.saveSemester({
      ...store.getSemester(semester.id)!,
      status: 'finished',
      finishedAt: t.deps.now(),
    });
    expect((await t.call('DELETE', `/api/disciplines/${tf.id}`)).status).toBe(204);
    const rows = (await t.call('GET', '/api/practice/summaries')).body;
    expect(rows[0]).toMatchObject({ disciplineName: tf.name, retelling: 'Мои заметки' });
    const prompt = await t.call('POST', '/api/practice/prompt', { summaryIds: [rows[0].id] });
    expect(prompt.status).toBe(200);
    expect(prompt.body.prompt).toContain(tf.name);
    expect((await t.call('GET', '/api/export/summaries?format=json')).body[0]).toMatchObject({
      name: tf.name,
    });
    expect(
      semesterView(t.deps, store.getSemester(semester.id)!).disciplines.map((d) => d.name),
    ).toContain(tf.name);
    const draft = await t.call('POST', '/api/semesters/draft', {
      startDate: '2026-10-26',
      disciplineIds: [tf.id, sql.id],
    });
    expect(draft.status).toBe(404);
    const next = await t.call('POST', '/api/semesters/draft', {
      startDate: '2026-10-26',
      disciplineIds: [sql.id],
    });
    expect(next.status).toBe(201);
    expect((await t.call('GET', '/api/practice/summaries')).body).toHaveLength(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { practiceSummaries } from './practice';
import { msk, testApp, userSemester } from '../testing';

async function fixture() {
  const t = testApp(msk('2026-10-24T21:10'));
  const { semester, tf, sql } = await userSemester(t);
  const store = t.deps.store;
  const sessions = store.loadSessions(semester.id);
  const a = sessions.find((s) => s.disciplineId === tf.id)!;
  const b = sessions.find((s) => s.disciplineId === sql.id)!;
  for (const [session, text] of [
    [a, 'Описание с трудностью: путаюсь в понятиях.\nВторая строка.'],
    [b, ''],
  ] as const) {
    store.saveSummary({
      semesterId: semester.id,
      sessionId: session.id,
      disciplineId: session.disciplineId,
      keyConcepts: session === b ? 'JOIN, GROUP BY' : '',
      retelling: text,
      continueFrom: 'План следующего занятия',
      createdAt: session.start + 60_000,
    });
  }
  return { t, store, semester, tf, sql, a, b };
}

describe('практика по сохранённым итогам', () => {
  it('загружает большой журнал без роста числа запросов к базе', async () => {
    const { t, store, semester, a, tf } = await fixture();
    const prepare = vi.spyOn(store.db, 'prepare');
    try {
      practiceSummaries(t.deps);
      const smallQueries = prepare.mock.calls.length;
      store.transaction(() => {
        for (let i = 0; i < 1500; i++) {
          store.saveSession(semester.id, { ...a, id: `load-${i}`, start: a.start + i * 60_000 });
          store.saveSummary({
            semesterId: semester.id,
            sessionId: `load-${i}`,
            disciplineId: tf.id,
            keyConcepts: 'Учебная тема',
            retelling: 'Длинная запись. '.repeat(100),
            continueFrom: '',
            createdAt: a.start + i * 60_000,
          });
        }
      });
      prepare.mockClear();
      const rows = practiceSummaries(t.deps);
      expect(rows).toHaveLength(1502);
      expect(prepare.mock.calls.length).toBeLessThanOrEqual(smallQueries);
      expect(rows.find((s) => s.sessionId === 'load-1499')?.retelling).toBe(
        'Длинная запись. '.repeat(100),
      );
    } finally {
      prepare.mockRestore();
    }
  });
  it('работает без семестра и возвращает пустой список', async () => {
    const t = testApp(msk('2026-10-24T21:10'));
    expect((await t.call('GET', '/api/practice/summaries')).body).toEqual([]);
    expect((await t.call('POST', '/api/practice/prompt', { summaryIds: [] })).status).toBe(400);
  });

  it('включает архивные дисциплины и завершённые семестры, сортирует по дате занятия', async () => {
    const { t, store, semester, tf } = await fixture();
    store.saveSemester({ ...store.getSemester(semester.id)!, status: 'finished' });
    store.saveDiscipline({ ...store.getDiscipline(tf.id)!, archivedAt: t.deps.now() });
    const rows = (await t.call('GET', '/api/practice/summaries')).body;
    expect(rows).toHaveLength(2);
    expect(rows[0].sessionStart).toBeGreaterThanOrEqual(rows[1].sessionStart);
    expect(
      rows.find((s: { disciplineId: string }) => s.disciplineId === tf.id).retelling,
    ).toContain('Вторая строка.');
    expect(
      rows.find((s: { disciplineId: string }) => s.disciplineId === tf.id).disciplineName,
    ).toBe(tf.name);
  });

  it('передаёт только выбранный итог без пересказа, не дублирует и не изменяет записи', async () => {
    const { t, store, tf } = await fixture();
    const before = store.listSummaries();
    let changes = 0;
    t.deps.afterChange = () => {
      changes++;
    };
    const rows = (await t.call('GET', '/api/practice/summaries')).body;
    const row = rows.find((s: { disciplineId: string }) => s.disciplineId === tf.id);
    const res = await t.call('POST', '/api/practice/prompt', {
      summaryIds: [row.id, row.id],
      minutes: 15,
      difficulty: 'challenge',
      wish: 'Хочу разобраться с трудностью',
    });
    expect(res.status).toBe(200);
    expect(res.body.prompt).toContain('на 15 минут');
    expect(res.body.prompt).toContain('Хочу разобраться с трудностью');
    expect(res.body.prompt).toContain('наводящий вопрос →');
    expect(res.body.prompt).toContain('ТОЛЬКО по моей явной просьбе');
    const records = JSON.parse(res.body.prompt.slice(res.body.prompt.indexOf('\n[\n') + 1));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      discipline: tf.name,
      description: row.retelling,
      keyConcepts: '',
      continueFrom: row.continueFrom,
    });
    expect(res.body.prompt).not.toContain('JOIN, GROUP BY');
    expect(store.listSummaries()).toEqual(before);
    expect(changes).toBe(0);
  });

  it('собирает междисциплинарное задание и проверяет выбор двух дисциплин', async () => {
    const { t } = await fixture();
    const rows = (await t.call('GET', '/api/practice/summaries')).body;
    expect(
      (
        await t.call('POST', '/api/practice/prompt', {
          summaryIds: [rows[0].id],
          mode: 'interdisciplinary',
        })
      ).status,
    ).toBe(400);
    const res = await t.call('POST', '/api/practice/prompt', {
      summaryIds: rows.map((s: { id: string }) => s.id),
      mode: 'interdisciplinary',
      minutes: 60,
    });
    expect(res.status).toBe(200);
    expect(res.body.prompt).toContain('междисциплинарное задание');
    expect(res.body.prompt).toContain('JOIN, GROUP BY');
    expect(res.body.prompt).toContain('Описание с трудностью');
    expect(res.body.prompt).toContain('Не требуй собственного проекта');
  });

  it('не путает одинаковые идентификаторы занятий в разных семестрах и замечает удаление', async () => {
    const { t, store, semester, a, tf } = await fixture();
    store.saveSemester({
      ...store.getSemester(semester.id)!,
      id: 'other-semester',
      status: 'finished',
    });
    store.saveSession('other-semester', a);
    store.saveSummary({
      semesterId: 'other-semester',
      sessionId: a.id,
      disciplineId: tf.id,
      keyConcepts: 'Другая запись',
      retelling: '',
      continueFrom: '',
      createdAt: t.deps.now(),
    });
    const rows = (await t.call('GET', '/api/practice/summaries')).body;
    const sameSession = rows.filter((s: { sessionId: string }) => s.sessionId === a.id);
    expect(new Set(sameSession.map((s: { id: string }) => s.id)).size).toBe(2);
    const other = sameSession.find(
      (s: { semesterId: string }) => s.semesterId === 'other-semester',
    );
    const res = await t.call('POST', '/api/practice/prompt', { summaryIds: [other.id] });
    expect(res.body.prompt).toContain('Другая запись');
    expect(res.body.prompt).not.toContain('Описание с трудностью');
    store.deleteSemester('other-semester');
    expect((await t.call('POST', '/api/practice/prompt', { summaryIds: [other.id] })).status).toBe(
      404,
    );
  });

  it('проверяет параметры и не обрезает большой текст молча', async () => {
    const { t, store, semester, a, tf } = await fixture();
    const row = (await t.call('GET', '/api/practice/summaries')).body[0];
    for (const invalid of [
      { minutes: 5 },
      { mode: 'unknown' },
      { wish: 'x'.repeat(2001) },
      { difficulty: 'unknown' },
    ]) {
      expect(
        (await t.call('POST', '/api/practice/prompt', { summaryIds: [row.id], ...invalid })).status,
      ).toBe(400);
    }
    expect(
      (await t.call('POST', '/api/practice/prompt', { summaryIds: Array(101).fill(row.id) }))
        .status,
    ).toBe(400);
    const ids = [];
    for (let i = 0; i < 10; i++) {
      store.saveSession(semester.id, { ...a, id: `long-${i}` });
      store.saveSummary({
        semesterId: semester.id,
        sessionId: `long-${i}`,
        disciplineId: tf.id,
        keyConcepts: '',
        retelling: 'я'.repeat(20_000),
        continueFrom: '',
        createdAt: t.deps.now(),
      });
      ids.push(JSON.stringify([semester.id, `long-${i}`]));
    }
    const res = await t.call('POST', '/api/practice/prompt', { summaryIds: ids });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('слишком много текста');
  });
});

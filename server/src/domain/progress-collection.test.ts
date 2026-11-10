import { describe, expect, it } from 'vitest';
import { msk, testApp, userSemester } from '../testing';
import { awardLesson, rollQuality } from './progress';
import { QUALITIES } from './qualities';

async function fixture() {
  const t = testApp(msk('2026-10-24T21:10'));
  const { semester } = await userSemester(t);
  const sessions = t.deps.store.loadSessions(semester.id);
  async function finish(index: number) {
    const s = sessions[index]!;
    t.deps.store.saveSession(semester.id, { ...s, status: 'held', actualMinutes: 30 });
    return t.call('POST', `/api/sessions/${s.id}/summary`, { retelling: 'Позанимался' });
  }
  return { t, semester, sessions, finish };
}

describe('коллекция слов и отключаемые награды', () => {
  it('содержит ровно 500 разных русских слов, без пустых элементов', () => {
    expect(QUALITIES).toHaveLength(500);
    expect(new Set(QUALITIES.map((w) => w.toLocaleLowerCase('ru'))).size).toBe(500);
    expect(QUALITIES.every((w) => /^[а-яё-]+$/u.test(w))).toBe(true);
  });
  it('использует ровно половину исходов монеты для выпадения и равномерный выбор оставшегося слова', () => {
    const owned = new Set(Array.from({ length: 498 }, (_, i) => i));
    const outcomes = [];
    for (const coin of [0, 1])
      for (const word of [0, 1]) {
        let calls = 0;
        outcomes.push(
          rollQuality(owned, (max) => {
            calls++;
            expect(max).toBe(2);
            return calls === 1 ? coin : word;
          }),
        );
      }
    expect(outcomes.filter((o) => o.outcome === 'found')).toEqual([
      { id: 498, outcome: 'found' },
      { id: 499, outcome: 'found' },
    ]);
    expect(outcomes.filter((o) => o.outcome === 'miss')).toHaveLength(2);
    expect(
      rollQuality(new Set(Array.from({ length: 500 }, (_, i) => i)), () => {
        throw new Error('Не должно быть броска');
      }),
    ).toEqual({ id: null, outcome: 'complete' });
  });
  it('переброс не допускается: повтор начисления и чтения сохраняет найденное слово или промах', async () => {
    const { t, semester, sessions, finish } = await fixture();
    const saved = await finish(0);
    expect(saved.status).toBe(201);
    const snapshot = saved.body.award;
    expect(['found', 'miss']).toContain(snapshot.qualityOutcome);
    if (snapshot.quality) expect(snapshot.quality.word).toBe(QUALITIES[snapshot.quality.id]);
    const replay = t.deps.store.transaction(() =>
      awardLesson(t.deps, semester.id, t.deps.store.getSession(semester.id, sessions[0]!.id)!),
    );
    expect(replay).toEqual(snapshot);
    expect((await t.call('GET', '/api/progress')).body.pending).toEqual(snapshot);
    expect((await t.call('GET', '/api/progress')).body.collection).toHaveLength(
      snapshot.quality ? 1 : 0,
    );
    expect((await t.call('GET', '/api/progress')).body.collectionSize).toBe(500);
  });
  it('отключение приятных наград не влияет на опыт и слова; отключение слов сохраняет коллекцию', async () => {
    const { t, finish } = await fixture();
    expect(
      (await t.call('PUT', '/api/progress/preferences', { rewardsEnabled: false })).status,
    ).toBe(200);
    const first = await finish(0);
    expect(first.body.award.offers).toEqual([]);
    expect(['found', 'miss']).toContain(first.body.award.qualityOutcome);
    const collection = (await t.call('GET', '/api/progress')).body.collection;
    await t.call('PUT', '/api/progress/preferences', { qualitiesEnabled: false });
    const second = await finish(1);
    expect(second.body.award.qualityOutcome).toBe('disabled');
    expect(second.body.award.quality).toBeNull();
    const state = (await t.call('GET', '/api/progress')).body;
    expect(state.collection).toEqual(collection);
    expect(state).toMatchObject({ xp: 200, rewardsEnabled: false, qualitiesEnabled: false });
    await t.call('PUT', '/api/progress/preferences', {
      rewardsEnabled: true,
      qualitiesEnabled: true,
    });
    const third = await finish(2);
    expect(third.body.award.offers).toHaveLength(2);
    expect(['found', 'miss']).toContain(third.body.award.qualityOutcome);
  });
  it('удаляет пункт набора, но не заработанные снимки; удалённое не возвращается при включении', async () => {
    const { t, finish } = await fixture();
    const saved = await finish(0);
    const original = saved.body.award;
    const removedId = original.offers[0].id;
    expect((await t.call('DELETE', `/api/progress/rewards/${removedId}`)).status).toBe(204);
    expect(
      (await t.call('GET', '/api/progress')).body.options.some(
        (o: { id: string }) => o.id === removedId,
      ),
    ).toBe(false);
    expect((await t.call('GET', '/api/progress')).body.pending.offers).toEqual(original.offers);
    expect(
      (await t.call('POST', `/api/progress/awards/${original.id}/choose`, { index: 0 })).status,
    ).toBe(200);
    await t.call('PUT', '/api/progress/preferences', { rewardsEnabled: false });
    await t.call('PUT', '/api/progress/preferences', { rewardsEnabled: true });
    const next = await finish(1);
    expect(next.body.award.offers.some((o: { id: string }) => o.id === removedId)).toBe(false);
    expect(
      (await t.call('PATCH', `/api/progress/rewards/${removedId}`, { enabled: true })).status,
    ).toBe(404);
  });
  it('после сборки всех слов опыт и приятные награды продолжают работать', async () => {
    const { t, finish } = await fixture();
    const insert = t.deps.store.db.prepare(
      'INSERT INTO quality_collection(word_id,award_id,found_at) VALUES (?,?,?)',
    );
    t.deps.store.transaction(() => {
      for (let i = 0; i < 500; i++) insert.run(i, `old-${i}`, i);
    });
    const saved = await finish(0);
    expect(saved.body.award).toMatchObject({ xp: 100, quality: null, qualityOutcome: 'complete' });
    expect(saved.body.award.offers).toHaveLength(2);
    expect((await t.call('GET', '/api/progress')).body.collection).toHaveLength(500);
  });
});

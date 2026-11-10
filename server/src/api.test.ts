import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupIfDue } from './domain/maintenance';
import { pauseForSleep, pauseIfAway } from './domain/sessions';
import {
  createDiscipline,
  msk,
  sessionAt,
  sessionsBetween,
  testApp,
  USER_SETTINGS,
  userSemester,
} from './testing';

const SATURDAY_EVENING = msk('2026-10-24T21:10');

describe('полное удаление семестра', () => {
  it('очищает данные семестра и позволяет построить новый с прежними дисциплинами', async () => {
    const t = testApp(SATURDAY_EVENING);
    const { semester: sem, tf, sql } = await userSemester(t);
    const store = t.deps.store;
    const s = store.loadSessions(sem.id)[0]!;
    const source = await t.call('POST', `/api/disciplines/${tf.id}/sources`, {
      kind: 'note',
      title: 'Материалы',
      note: 'Сохранить',
    });
    expect(source.status).toBe(201);
    store.saveSummary({
      semesterId: sem.id,
      sessionId: s.id,
      disciplineId: tf.id,
      keyConcepts: 'Тема',
      retelling: 'Итог',
      continueFrom: 'Старый прогресс',
      createdAt: SATURDAY_EVENING,
    });
    store.saveDiscipline({ ...store.getDiscipline(tf.id)!, continueHint: 'Старый прогресс' });
    store.ensureDecision(
      'question',
      `missed:${sem.id}:${s.id}`,
      'missed',
      { sessionId: s.id },
      SATURDAY_EVENING,
    );
    store.ensureDecision(
      'other',
      'checkpoint:other:mid',
      'checkpoint',
      { kind: 'mid' },
      SATURDAY_EVENING,
    );
    t.setNow(s.start);
    expect((await t.call('POST', `/api/sessions/${s.id}/start`)).status).toBe(200);
    expect(store.getTimer()).not.toBeNull();
    expect((await t.call('DELETE', `/api/semesters/${sem.id}`)).status).toBe(204);
    expect(store.getSemester(sem.id)).toBeNull();
    expect(store.loadSessions(sem.id)).toEqual([]);
    expect(store.loadSkeleton(sem.id)).toEqual([]);
    expect(store.listSummaries()).toEqual([]);
    expect(store.getTimer()).toBeNull();
    expect(store.getDecision('question')).toBeNull();
    expect(store.getDecision('other')).not.toBeNull();
    expect(store.getDiscipline(tf.id)?.continueHint).toBe('');
    expect(store.listSources(tf.id)).toHaveLength(1);
    expect((await t.call('GET', '/api/settings')).body).toMatchObject(USER_SETTINGS);
    const rebuilt = await t.call('POST', '/api/semesters/draft', {
      startDate: '2026-10-26',
      disciplineIds: [tf.id, sql.id],
    });
    expect(rebuilt.status).toBe(201);
    expect(rebuilt.body.sessionsCount).toBeGreaterThan(0);
    expect((await t.call('DELETE', '/api/semesters/unknown')).status).toBe(204);
  });
});

describe('настройки', () => {
  it('по умолчанию — разумные значения; неправильные данные отклоняются с объяснением', async () => {
    const t = testApp(SATURDAY_EVENING);
    const defaults = await t.call('GET', '/api/settings');
    expect(defaults.body).toMatchObject({ bufferMinutes: 15, maxWeeklyMinutes: 600 });

    const bad = await t.call('PUT', '/api/settings', {
      ...USER_SETTINGS,
      studyWindows: [{ start: 13 * 60, end: 10 * 60 }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details[0].message).toBe('Конец окна должен быть позже начала');

    const overlapping = await t.call('PUT', '/api/settings', {
      ...USER_SETTINGS,
      studyWindows: [
        { start: 10 * 60, end: 13 * 60 },
        { start: 10 * 60 + 24, end: 13 * 60 },
      ],
    });
    expect(overlapping.status).toBe(400);
    expect(overlapping.body.details[0].message).toBe(
      'Окна для учёбы пересекаются — объедини их в одно',
    );

    const saved = await t.call('PUT', '/api/settings', USER_SETTINGS);
    expect(saved.status).toBe(200);
    expect((await t.call('GET', '/api/settings')).body.bufferMinutes).toBe(30);
  });
});

describe('дисциплины и источники', () => {
  it('без цели и метрик дисциплину не создать', async () => {
    const t = testApp(SATURDAY_EVENING);
    const res = await t.call('POST', '/api/disciplines', {
      name: 'SQL',
      priority: 'main',
      durationMinutes: 90,
      goal: ' ',
      metrics: '',
    });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d: { message: string }) => d.message)).toEqual([
      'Напиши цель — чего хочешь достичь этой дисциплиной',
      'Напиши метрики — как поймёшь, что цель достигнута',
    ]);
  });

  it('источники — ссылки и заметки, добавляются в любой момент', async () => {
    const t = testApp(SATURDAY_EVENING);
    const sql = await createDiscipline(t, 'SQL');
    const link = await t.call('POST', `/api/disciplines/${sql.id}/sources`, {
      kind: 'link',
      url: 'https://sqlbolt.com/lesson/select_queries_introduction',
    });
    expect(link.status).toBe(201);
    expect(link.body.title).toBe('sqlbolt.com');
    const note = await t.call('POST', `/api/disciplines/${sql.id}/sources`, {
      kind: 'note',
      note: 'Книга «SQL. Быстрое погружение»\nглавы 1–3',
    });
    expect(note.body.title).toBe('Книга «SQL. Быстрое погружение»');
    expect(
      (await t.call('POST', `/api/disciplines/${sql.id}/sources`, { kind: 'link', url: 'ftp://x' }))
        .status,
    ).toBe(400);

    await t.call('PATCH', `/api/sources/${link.body.id}`, { title: 'SQLBolt' });
    expect((await t.call('DELETE', `/api/sources/${note.body.id}`)).status).toBe(204);
    const card = await t.call('GET', `/api/disciplines/${sql.id}`);
    expect(card.body.sources.map((s: { title: string }) => s.title)).toEqual(['SQLBolt']);
  });
});

describe('семестр пользователя: от черновика до занятий', () => {
  it('черновик по настройкам пользователя: 12 недель + воскресенье, всё в 10:00', async () => {
    const t = testApp(SATURDAY_EVENING);
    const { draft, semester } = await userSemester(t);
    expect(draft).toMatchObject({
      status: 'draft',
      fullWeeks: 12,
      leadDays: 1,
      endDate: '2027-01-17',
    });
    expect(draft.skeleton).toHaveLength(6);
    expect(draft.skeleton.every((s: { startMinute: number }) => s.startMinute === 600)).toBe(true);
    expect(draft.budget.peakMinutes).toBe(540);
    expect(draft.warnings.map((w: { code: string }) => w.code)).toContain('tight');
    expect(semester.status).toBe('active');

    const week = await sessionsBetween(t, msk('2026-10-26T00:00'), msk('2026-11-02T00:00'));
    expect(week.map((s) => s.disciplineName)).toEqual([
      'Трендфоркастинг',
      'SQL',
      'Трендфоркастинг',
      'SQL',
      'Трендфоркастинг',
      'SQL',
    ]);
  });

  it('второй семестр, пока идёт первый, не составить', async () => {
    const t = testApp(SATURDAY_EVENING);
    const { tf } = await userSemester(t);
    const res = await t.call('POST', '/api/semesters/draft', {
      startDate: '2026-11-01',
      disciplineIds: [tf.id],
    });
    expect(res.status).toBe(409);
  });

  it('занятие: таймер, пауза, досрочное завершение, итог обязателен, «с чего продолжить»', async () => {
    const t = testApp(SATURDAY_EVENING);
    const { tf } = await userSemester(t);
    const monday = await sessionAt(t, '2026-10-26T10:00');
    const tuesday = await sessionAt(t, '2026-10-27T10:00');

    t.setNow(msk('2026-10-26T09:00'));
    expect((await t.call('POST', `/api/sessions/${monday.id}/start`)).status).toBe(409);

    t.setNow(msk('2026-10-26T09:45'));
    const started = await t.call('POST', `/api/sessions/${monday.id}/start`);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ phase: 'focus', cycle: 1, paused: false });
    expect((await t.call('POST', `/api/sessions/${tuesday.id}/start`)).body.error).toBe(
      'Уже идёт другое занятие — сначала заверши его',
    );

    t.advance(30);
    await t.call('POST', '/api/timer/pause');
    t.advance(10);
    expect((await t.call('GET', '/api/timer')).body).toMatchObject({ paused: true });
    await t.call('POST', '/api/timer/resume');
    t.advance(20);
    const finished = await t.call('POST', '/api/timer/finish');
    expect(finished.body).toMatchObject({ focusMinutes: 45, activeMinutes: 50, endedEarly: true });
    expect(finished.body.session.status).toBe('held');

    // Пока нет итога, новое занятие не начать.
    t.setNow(msk('2026-10-27T09:45'));
    const blocked = await t.call('POST', `/api/sessions/${tuesday.id}/start`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.sessionId).toBe(monday.id);

    const empty = await t.call('POST', `/api/sessions/${monday.id}/summary`, {});
    expect(empty.status).toBe(400);
    expect(empty.body.details[0].message).toBe(
      'Запиши хотя бы ключевые понятия или короткий пересказ',
    );
    const summary = await t.call('POST', `/api/sessions/${monday.id}/summary`, {
      keyConcepts: 'тренд, сигнал, драйвер изменений',
      continueFrom: 'Глава 2: сигналы',
    });
    expect(summary.status).toBe(201);
    expect((await t.call('GET', `/api/disciplines/${tf.id}`)).body.continueHint).toBe(
      'Глава 2: сигналы',
    );
    const details = await t.call('GET', `/api/sessions/${monday.id}`);
    expect(details.body).toMatchObject({
      continueHint: 'Глава 2: сигналы',
      summary: { keyConcepts: 'тренд, сигнал, драйвер изменений' },
    });

    expect((await t.call('POST', `/api/sessions/${tuesday.id}/start`)).status).toBe(200);
  });

  it('пропуск → вопрос с вариантами отработки в 7 дней и итогом нагрузки', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    const tuesday = await sessionAt(t, '2026-10-27T10:00');

    t.setNow(msk('2026-10-27T12:00'));
    const decisions = (await t.call('GET', '/api/decisions')).body;
    // К 12:00 вторника пропущено и занятие понедельника — берём вторник.
    const missed = decisions.find(
      (d: { kind: string; session?: { id: string } }) =>
        d.kind === 'missed' && d.session?.id === tuesday.id,
    );
    expect(missed.session.id).toBe(tuesday.id);
    expect(missed.session.status).toBe('missed');
    expect(missed.options.length).toBeGreaterThan(0);
    const option = missed.options[0];
    expect(option.start).toBeLessThan(msk('2026-11-04T00:00'));

    const preview = await t.call('POST', '/api/decisions/makeup-preview', {
      choices: [{ decisionId: missed.id, start: option.start }],
    });
    expect(preview.body.invalid).toEqual([]);
    expect(preview.body.weeks[0].afterMinutes - preview.body.weeks[0].beforeMinutes).toBe(90);

    const resolved = await t.call('POST', `/api/decisions/${missed.id}/resolve`, {
      action: 'makeup',
      start: option.start,
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.some((d: { id: string }) => d.id === missed.id)).toBe(false);
    const makeup = await sessionsBetween(t, option.start, option.start + 60_000);
    expect(makeup[0]).toMatchObject({ id: `${tuesday.id}.makeup`, origin: 'makeup' });

    // Устаревший вариант не применяется.
    const again = await t.call('POST', `/api/decisions/${missed.id}/resolve`, { action: 'leave' });
    expect(again.status).toBe(409);
  });

  it('новое событие → конфликт: перенос, «оставить как есть»', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    t.calendar.events.push(
      { start: msk('2026-10-28T10:00'), end: msk('2026-10-28T11:00'), title: 'Врач' },
      { start: msk('2026-10-29T10:00'), end: msk('2026-10-29T13:00'), title: 'Экзамен' },
    );

    const decisions = (await t.call('GET', '/api/decisions')).body;
    const conflicts = decisions.filter((d: { kind: string }) => d.kind === 'conflict');
    expect(conflicts).toHaveLength(2);
    const doctor = conflicts.find((d: { title: string }) => d.title.includes('«Врач»'));
    expect(doctor.options[0]).toMatchObject({ kind: 'same-day' });

    await t.call('POST', `/api/decisions/${doctor.id}/resolve`, {
      action: 'move',
      start: doctor.options[0].start,
    });
    const moved = await sessionAt(t, '2026-10-28T11:30');
    expect(moved).toMatchObject({ origin: 'moved', moveReason: 'событие «Врач»' });

    const exam = conflicts.find((d: { title: string }) => d.title.includes('«Экзамен»'));
    await t.call('POST', `/api/decisions/${exam.id}/resolve`, { action: 'keep' });
    const kept = await sessionAt(t, '2026-10-29T10:00');
    expect(kept.acceptedViolations).toEqual(['busy']);
    const after = (await t.call('GET', '/api/decisions')).body;
    expect(after.filter((d: { kind: string }) => d.kind === 'conflict')).toEqual([]);
  });

  it('событие убрали из календаря — вопрос закрывается сам', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    t.calendar.events.push({
      start: msk('2026-10-28T10:00'),
      end: msk('2026-10-28T11:00'),
      title: 'Врач',
    });
    expect((await t.call('GET', '/api/decisions')).body).toHaveLength(1);
    t.calendar.events = [];
    expect((await t.call('GET', '/api/decisions')).body).toEqual([]);
  });

  it('ручной перенос: нарушение правил — только с подтверждения', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    const friday = await sessionAt(t, '2026-10-30T10:00');
    const target = msk('2026-10-30T15:00');

    const refused = await t.call('POST', `/api/sessions/${friday.id}/move`, { start: target });
    expect(refused.status).toBe(409);
    expect(refused.body.details.violations.map((v: { code: string }) => v.code)).toContain(
      'outside-window',
    );

    const confirmed = await t.call('POST', `/api/sessions/${friday.id}/move`, {
      start: target,
      confirm: true,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.session).toMatchObject({
      origin: 'manual',
      acceptedViolations: ['outside-window'],
    });

    const clean = await t.call('POST', `/api/sessions/${friday.id}/move`, {
      start: msk('2026-10-30T11:00'),
    });
    expect(clean.body.violations).toEqual([]);
    expect(clean.body.session.acceptedViolations).toBeUndefined();
  });

  it('внеплановое занятие идёт в статистику; экспорт итогов', async () => {
    const t = testApp(SATURDAY_EVENING);
    const { tf } = await userSemester(t);
    t.setNow(msk('2026-10-31T15:00'));
    expect((await t.call('POST', '/api/sessions/unplanned', { disciplineId: tf.id })).status).toBe(
      200,
    );
    t.advance(30);
    const finished = (await t.call('POST', '/api/timer/finish')).body;
    expect(finished.focusMinutes).toBe(25);
    await t.call('POST', `/api/sessions/${finished.session.id}/summary`, {
      retelling: 'Слабые сигналы — ранние признаки тренда',
    });

    const stats = (await t.call('GET', '/api/stats')).body;
    const tfStats = stats.disciplines.find(
      (d: { disciplineId: string }) => d.disciplineId === tf.id,
    );
    expect(tfStats.actualMinutes).toBe(25);
    expect(tfStats.held).toBe(0); // внеплановое не входит в посещаемость

    const exported = await t.call('GET', '/api/export/summaries');
    expect(exported.text).toContain('## Трендфоркастинг');
    expect(exported.text).toContain('Слабые сигналы — ранние признаки тренда');
  });

  it('середина семестра: обзор с целями и прогнозом; «продлить на 2 недели»', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    t.setNow(msk('2026-12-07T08:00'));
    const decisions = (await t.call('GET', '/api/decisions')).body;
    const mid = decisions.find((d: { kind: string }) => d.kind === 'checkpoint');
    expect(mid.title).toBe('Середина семестра: как идёт план');
    expect(mid.checkpoint.disciplines[0]).toMatchObject({
      name: 'Трендфоркастинг',
      goal: 'Разобраться в «Трендфоркастинг»',
    });
    expect(mid.checkpoint.forecast.overall).toBe(0); // ничего не проведено

    await t.call('POST', `/api/decisions/${mid.id}/resolve`, { action: 'extend', weeks: 2 });
    const active = (await t.call('GET', '/api/semesters/active')).body;
    expect(active).toMatchObject({ fullWeeks: 14, endDate: '2027-01-31' });
    const again = (await t.call('GET', '/api/decisions')).body;
    expect(again.some((d: { kind: string }) => d.kind === 'checkpoint')).toBe(false);
  });
});

describe('калибровка длительности', () => {
  it('5 занятий по 45 минут из 90 → «Сделать 60?» → будущие занятия по 60', async () => {
    const t = testApp(SATURDAY_EVENING);
    const { tf } = await userSemester(t);
    const days = ['2026-10-26', '2026-10-28', '2026-10-30', '2026-11-02', '2026-11-04'];
    for (const day of days) {
      const s = await sessionAt(t, `${day}T10:00`);
      t.setNow(msk(`${day}T10:00`));
      await t.call('POST', `/api/sessions/${s.id}/start`);
      t.advance(45);
      await t.call('POST', '/api/timer/finish');
      await t.call('POST', `/api/sessions/${s.id}/summary`, { keyConcepts: 'понятия' });
    }
    const decisions = (await t.call('GET', '/api/decisions')).body;
    const calibration = decisions.find((d: { kind: string }) => d.kind === 'calibration');
    expect(calibration.title).toBe(
      '«Трендфоркастинг»: последние 5 занятий длились в среднем 45 из 90 мин. Сделать 60?',
    );

    await t.call('POST', `/api/decisions/${calibration.id}/resolve`, { action: 'accept' });
    const next = await sessionAt(t, '2026-11-06T10:00');
    expect((next.end - next.start) / 60_000).toBe(60);
    expect((await t.call('GET', `/api/disciplines/${tf.id}`)).body.durationMinutes).toBe(60);
  });
});

describe('изменения посреди семестра', () => {
  it('новая дисциплина: было → станет, занятия только в будущем', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    const english = await createDiscipline(t, 'Английский', 'additional', 45);
    t.setNow(msk('2026-11-09T08:00'));

    const preview = (
      await t.call('POST', '/api/semesters/active/changes/preview', {
        type: 'add',
        disciplineId: english.id,
      })
    ).body;
    expect(preview).toMatchObject({ ok: true, removedSessions: 0 });
    expect(preview.before.peakMinutes).toBe(540);
    expect(preview.after.peakMinutes).toBe(585);
    expect(preview.frequencyChanges).toEqual([
      { disciplineId: english.id, name: 'Английский', from: null, to: 1 },
    ]);

    await t.call('POST', '/api/semesters/active/changes/apply', {
      type: 'add',
      disciplineId: english.id,
    });
    const all = await sessionsBetween(t, msk('2026-10-01T00:00'), msk('2027-02-01T00:00'));
    const added = all.filter((s) => s.disciplineId === english.id);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((s) => s.start > msk('2026-11-09T08:00'))).toBe(true);
  });
});

describe('черновик не помещается', () => {
  it('компромиссы не предлагают неудобное время; выбранный компромисс применяется', async () => {
    const t = testApp(SATURDAY_EVENING);
    // Лимит поднят, чтобы упереться не в часы, а в окна: в 10:00–13:00 влезает одно занятие в день.
    await t.call('PUT', '/api/settings', { ...USER_SETTINGS, maxWeeklyMinutes: 900 });
    const ids = [];
    for (const name of ['Трендфоркастинг', 'SQL', 'Статистика', 'Python']) {
      ids.push((await createDiscipline(t, name)).id);
    }
    const draft = (
      await t.call('POST', '/api/semesters/draft', { startDate: '2026-10-26', disciplineIds: ids })
    ).body;
    expect(draft.failure.kind).toBe('placement');
    const titles = draft.compromises.map((c: { title: string }) => c.title);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.some((x: string) => x.includes('08:00') || x.includes('22:00'))).toBe(false);
    expect((await t.call('POST', '/api/semesters/draft/confirm')).body.error).toBe(
      'Расписание пока не помещается — выбери один из компромиссов',
    );

    const applied = await t.call('POST', '/api/semesters/draft/compromises/0');
    expect(applied.body.failure).toBeNull();
    expect((await t.call('POST', '/api/semesters/draft/confirm')).status).toBe(200);
  });
});

describe('резервные копии', () => {
  it('раз в день, повторно в тот же день — нет', () => {
    const t = testApp(SATURDAY_EVENING);
    const dir = mkdtempSync(join(tmpdir(), 'ou-backup-'));
    const path = backupIfDue(t.deps, dir);
    expect(path).not.toBeNull();
    expect(existsSync(path!)).toBe(true);
    expect(backupIfDue(t.deps, dir)).toBeNull();
    t.advance(24 * 60);
    expect(backupIfDue(t.deps, dir)).not.toBeNull();
  });
});

describe('особые случаи занятия', () => {
  it('начал позже — занятие заканчивается по расписанию, а не сдвигается', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    const monday = await sessionAt(t, '2026-10-26T10:00'); // 10:00–11:30
    t.setNow(msk('2026-10-26T10:10'));
    const late = (await t.call('POST', `/api/sessions/${monday.id}/start`)).body;
    expect(late).toMatchObject({ plannedMs: 80 * 60_000, remainingMs: 80 * 60_000 });

    t.setNow(msk('2026-10-26T11:30'));
    expect((await t.call('GET', '/api/timer')).body).toMatchObject({
      remainingMs: 0,
      overtime: false,
    });
  });

  it('начал раньше — полная длительность, закончится раньше расписания', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    const monday = await sessionAt(t, '2026-10-26T10:00');
    t.setNow(msk('2026-10-26T09:45'));
    const early = (await t.call('POST', `/api/sessions/${monday.id}/start`)).body;
    expect(early.plannedMs).toBe(90 * 60_000);
  });

  it('при открытой странице ставит на паузу на границе слота и ждёт явного продолжения', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    const s = await sessionAt(t, '2026-10-26T10:00');
    t.setNow(msk('2026-10-26T11:18'));
    await t.call('POST', `/api/sessions/${s.id}/start`);
    t.advance(3);
    await t.call('POST', '/api/timer/pause');
    t.advance(2);
    await t.call('POST', '/api/timer/resume');
    t.advance(7);
    expect((await t.call('GET', '/api/today')).body.timer).toMatchObject({
      paused: true,
      remainingMs: 0,
      activeMs: 10 * 60_000,
      autoPause: { reason: 'deadline', from: s.end },
    });
    t.advance(15);
    expect((await t.call('POST', '/api/timer/resume')).status).toBe(409);
    const input = { sessionId: s.id, continueBeyondPlan: true };
    expect((await t.call('POST', '/api/timer/resume', input)).body).toMatchObject({
      paused: false,
      overtime: true,
      activeMs: 10 * 60_000,
    });
    t.advance(4);
    expect((await t.call('POST', '/api/timer/resume', input)).body.activeMs).toBe(14 * 60_000);
    const done = await t.call('POST', '/api/timer/finish', { sessionId: s.id });
    expect(done.body).toMatchObject({
      focusMinutes: 14,
      activeMinutes: 14,
      endedEarly: false,
      session: { end: s.end },
    });
  });

  it('сон компьютера: пауза с момента сна, можно продолжить или засчитать', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    const monday = await sessionAt(t, '2026-10-26T10:00');
    t.setNow(msk('2026-10-26T10:00'));
    await t.call('POST', `/api/sessions/${monday.id}/start`);

    // Последняя отметка сервера — в 10:20, проснулись в 11:05.
    t.setNow(msk('2026-10-26T11:05'));
    pauseForSleep(t.deps, msk('2026-10-26T10:20'), msk('2026-10-26T11:05'));
    const slept = (await t.call('GET', '/api/timer')).body;
    expect(slept).toMatchObject({
      paused: true,
      activeMs: 20 * 60_000,
      autoPause: { reason: 'sleep', from: msk('2026-10-26T10:20'), to: msk('2026-10-26T11:05') },
    });

    // «Я занимался — засчитать»: время сна идёт в учёбу.
    const counted = (await t.call('POST', '/api/timer/resume', { countPaused: true })).body;
    expect(counted).toMatchObject({ paused: false, activeMs: 65 * 60_000 });
    expect(counted.autoPause).toBeUndefined();
  });

  it('закрытая страница: после конца занятия таймер встаёт, а не тикает до утра', async () => {
    const t = testApp(SATURDAY_EVENING);
    await userSemester(t);
    const monday = await sessionAt(t, '2026-10-26T10:00');
    t.setNow(msk('2026-10-26T10:00'));
    await t.call('POST', `/api/sessions/${monday.id}/start`);
    const lastSeen = msk('2026-10-26T10:05');

    // Время занятия ещё идёт — страница могла закрыться случайно, таймер не трогаем.
    t.setNow(msk('2026-10-26T11:00'));
    pauseIfAway(t.deps, lastSeen, 10 * 60_000);
    expect((await t.call('GET', '/api/timer')).body.paused).toBe(false);

    // Утром: таймер остановился на конце занятия, 11:30.
    t.setNow(msk('2026-10-27T08:00'));
    pauseIfAway(t.deps, lastSeen, 10 * 60_000);
    const away = (await t.call('GET', '/api/timer')).body;
    expect(away).toMatchObject({
      paused: true,
      activeMs: 90 * 60_000,
      autoPause: { reason: 'away', from: msk('2026-10-26T11:30') },
    });
    const finished = (await t.call('POST', '/api/timer/finish')).body;
    expect(finished).toMatchObject({ focusMinutes: 75, activeMinutes: 90 });
  });
});

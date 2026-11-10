import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  BusyEvent,
  Budget,
  CheckpointHistory,
  Compromise,
  Frequency,
  Instant,
  PlanFailure,
  PlanWarning,
  Priority,
  Session,
  SessionOrigin,
  SessionStatus,
  Settings,
  SkeletonSlot,
  TimeWindow,
  TimerState,
  ViolationCode,
  Weekday,
} from '@ou/engine';
import type { AppSettings } from '../settings';

export interface DisciplineRecord {
  id: string;
  name: string;
  priority: Priority;
  durationMinutes: number;
  goal: string;
  metrics: string;
  /** «С чего продолжить» — подсказка из итога последнего занятия. */
  continueHint: string;
  archivedAt: Instant | null;
  createdAt: Instant;
}

export interface SourceRecord {
  id: string;
  disciplineId: string;
  kind: 'link' | 'note';
  title: string;
  url: string | null;
  note: string;
  createdAt: Instant;
}

export type SemesterStatus = 'draft' | 'active' | 'finished';

/** Что в семестре отличается от общей карточки дисциплины — по согласию в компромиссах. */
export interface DisciplinePatch {
  durationMinutes?: number;
  extraWindows?: TimeWindow[];
}

/** Результат последнего построения черновика. */
export interface BuildInfo {
  ok: boolean;
  warnings: PlanWarning[];
  failure?: PlanFailure;
  compromises: Compromise[];
  budget?: Budget;
  moved: number;
}

export interface SemesterRecord {
  id: string;
  status: SemesterStatus;
  startDate: string;
  /** Календарные недели для движка: первая может быть неполной. */
  weeks: number;
  disciplineIds: string[];
  frequencies: Record<string, Frequency>;
  frequencyOverrides: Record<string, Frequency>;
  settingsPatch: Partial<Settings>;
  disciplinePatches: Record<string, DisciplinePatch>;
  checkpoints: CheckpointHistory;
  buildInfo: BuildInfo | null;
  createdAt: Instant;
  confirmedAt: Instant | null;
  finishedAt: Instant | null;
}

export interface SummaryRecord {
  semesterId: string;
  sessionId: string;
  disciplineId: string;
  keyConcepts: string;
  retelling: string;
  continueFrom: string;
  nextQuestion?: string;
  createdAt: Instant;
}

export type DecisionKind = 'conflict' | 'missed' | 'calibration' | 'checkpoint' | 'calendar-edit';

export interface DecisionRecord {
  id: string;
  key: string;
  kind: DecisionKind;
  status: 'open' | 'resolved';
  payload: Record<string, unknown>;
  resolution: Record<string, unknown> | null;
  createdAt: Instant;
  resolvedAt: Instant | null;
}

export interface TimerRecord {
  semesterId: string;
  state: TimerState;
}

export interface GoogleTokens {
  accessToken: string;
  /** Когда истекает доступ, миллисекунды Unix. */
  expiresAt: Instant;
  refreshToken: string;
  scope: string;
}

/** Подключение к Google: доступ, свой календарь, состояние синхронизации. */
export interface GoogleAccount {
  tokens: GoogleTokens | null;
  email: string | null;
  /** Доступ истёк (раз в 7 дней в режиме Testing) — нужно войти заново. */
  needsReauth: boolean;
  /** Календарь «Мой университет». */
  calendarId: string | null;
  /** Из каких календарей брать занятость; null — из всех, кроме своего. */
  busyCalendarIds: string[] | null;
  lastSyncAt: Instant | null;
  lastSyncError: string | null;
  /**
   * Часовой пояс основного календаря Google. Если он не совпадает с поясом сервиса,
   * Google показывает занятия со сдвигом — интерфейс об этом предупреждает.
   */
  calendarTimezone: string | null;
}

export const EMPTY_GOOGLE_ACCOUNT: GoogleAccount = {
  tokens: null,
  email: null,
  needsReauth: false,
  calendarId: null,
  busyCalendarIds: null,
  lastSyncAt: null,
  lastSyncError: null,
  calendarTimezone: null,
};

export interface CalendarLink {
  semesterId: string;
  sessionId: string;
  eventId: string;
  /** Что мы записали в событие последним — чтобы отличать свои изменения от правок пользователя. */
  start: Instant;
  end: Instant;
  summary: string;
}

export interface BusyCache {
  rangeStart: Instant;
  rangeEnd: Instant;
  fetchedAt: Instant;
  events: BusyEvent[];
}

type Row = Record<string, unknown>;

const json = <T>(value: unknown, fallback: T): T =>
  typeof value === 'string' ? (JSON.parse(value) as T) : fallback;
const num = (value: unknown): number | null => (value === null ? null : Number(value));
const opt = <T>(value: T | null | undefined) => (value === null ? undefined : value);

function toDiscipline(r: Row): DisciplineRecord {
  return {
    id: r.id as string,
    name: r.name as string,
    priority: r.priority as Priority,
    durationMinutes: Number(r.duration_minutes),
    goal: r.goal as string,
    metrics: r.metrics as string,
    continueHint: r.continue_hint as string,
    archivedAt: num(r.archived_at),
    createdAt: Number(r.created_at),
  };
}

function toSource(r: Row): SourceRecord {
  return {
    id: r.id as string,
    disciplineId: r.discipline_id as string,
    kind: r.kind as SourceRecord['kind'],
    title: r.title as string,
    url: (r.url as string | null) ?? null,
    note: r.note as string,
    createdAt: Number(r.created_at),
  };
}

function toSemester(r: Row): SemesterRecord {
  return {
    id: r.id as string,
    status: r.status as SemesterStatus,
    startDate: r.start_date as string,
    weeks: Number(r.weeks),
    disciplineIds: json(r.discipline_ids, []),
    frequencies: json(r.frequencies, {}),
    frequencyOverrides: json(r.frequency_overrides, {}),
    settingsPatch: json(r.settings_patch, {}),
    disciplinePatches: json(r.discipline_patches, {}),
    checkpoints: json(r.checkpoints, { midDone: false, endDone: false }),
    buildInfo: json<BuildInfo | null>(r.build_info, null),
    createdAt: Number(r.created_at),
    confirmedAt: num(r.confirmed_at),
    finishedAt: num(r.finished_at),
  };
}

function toSlot(r: Row): SkeletonSlot {
  const slot: SkeletonSlot = {
    id: r.id as string,
    disciplineId: r.discipline_id as string,
    weekday: Number(r.weekday) as Weekday,
    startMinute: Number(r.start_minute),
    durationMinutes: Number(r.duration_minutes),
    fromWeek: Number(r.from_week),
  };
  if (r.parity !== null) slot.parity = Number(r.parity) as 0 | 1;
  if (r.to_week !== null) slot.toWeek = Number(r.to_week);
  return slot;
}

function toSession(r: Row): Session {
  const s: Session = {
    id: r.id as string,
    disciplineId: r.discipline_id as string,
    start: Number(r.start),
    end: Number(r.end),
    status: r.status as SessionStatus,
    origin: r.origin as SessionOrigin,
  };
  const optional = {
    skeletonSlotId: opt(r.skeleton_slot_id as string | null),
    originalStart: opt(num(r.original_start)),
    moveReason: opt(r.move_reason as string | null),
    actualMinutes: opt(num(r.actual_minutes)),
    elapsedMinutes: opt(num(r.elapsed_minutes)),
    startedAt: opt(num(r.started_at)),
    finishedAt: opt(num(r.finished_at)),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) (s as unknown as Row)[key] = value;
  }
  if (Number(r.custom_duration) === 1) s.customDuration = true;
  const accepted = json<ViolationCode[]>(r.accepted_violations, []);
  if (accepted.length > 0) s.acceptedViolations = accepted;
  return s;
}

function sessionParams(semesterId: string, s: Session): Record<string, SQLInputValue> {
  return {
    semester_id: semesterId,
    id: s.id,
    discipline_id: s.disciplineId,
    start: s.start,
    end: s.end,
    status: s.status,
    origin: s.origin,
    skeleton_slot_id: s.skeletonSlotId ?? null,
    original_start: s.originalStart ?? null,
    move_reason: s.moveReason ?? null,
    actual_minutes: s.actualMinutes ?? null,
    elapsed_minutes: s.elapsedMinutes ?? null,
    started_at: s.startedAt ?? null,
    finished_at: s.finishedAt ?? null,
    custom_duration: s.customDuration ? 1 : 0,
    accepted_violations: JSON.stringify(s.acceptedViolations ?? []),
  };
}

const SESSION_COLUMNS =
  'semester_id, id, discipline_id, start, end, status, origin, skeleton_slot_id, original_start, move_reason, actual_minutes, elapsed_minutes, started_at, finished_at, custom_duration, accepted_violations';
const SESSION_VALUES = SESSION_COLUMNS.split(', ')
  .map((c) => `$${c}`)
  .join(', ');

function toDecision(r: Row): DecisionRecord {
  return {
    id: r.id as string,
    key: r.key as string,
    kind: r.kind as DecisionKind,
    status: r.status as DecisionRecord['status'],
    payload: json(r.payload, {}),
    resolution: json<Record<string, unknown> | null>(r.resolution, null),
    createdAt: Number(r.created_at),
    resolvedAt: num(r.resolved_at),
  };
}

function toSummary(r: Row): SummaryRecord {
  return {
    semesterId: r.semester_id as string,
    sessionId: r.session_id as string,
    disciplineId: r.discipline_id as string,
    keyConcepts: r.key_concepts as string,
    retelling: r.retelling as string,
    continueFrom: r.continue_from as string,
    nextQuestion: (r.next_question as string | undefined) ?? '',
    createdAt: Number(r.created_at),
  };
}

/** Всё чтение и запись базы. Бизнес-правил здесь нет. */
export class Store {
  private depth = 0;

  constructor(readonly db: DatabaseSync) {}

  /** Всё внутри — одной транзакцией; вложенные вызовы становятся точками сохранения. */
  transaction<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    this.db.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
      return result;
    } catch (error) {
      this.depth--;
      this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
      throw error;
    }
  }

  private get(sql: string, params: Record<string, SQLInputValue> = {}): Row | undefined {
    return this.db.prepare(sql).get(params) as Row | undefined;
  }

  private all(sql: string, params: Record<string, SQLInputValue> = {}): Row[] {
    return this.db.prepare(sql).all(params) as Row[];
  }

  private run(sql: string, params: Record<string, SQLInputValue> = {}): number {
    return Number(this.db.prepare(sql).run(params).changes);
  }

  // Настройки

  getSettings(): AppSettings | null {
    const row = this.get('SELECT data FROM app_settings WHERE id = 1');
    return row ? json<AppSettings>(row.data, null as never) : null;
  }

  saveSettings(settings: AppSettings): void {
    this.run(
      'INSERT INTO app_settings (id, data) VALUES (1, $data) ON CONFLICT (id) DO UPDATE SET data = excluded.data',
      { data: JSON.stringify(settings) },
    );
  }

  // Дисциплины

  listDisciplines(includeArchived = false): DisciplineRecord[] {
    return this.all(
      `SELECT * FROM disciplines WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY created_at, id`,
    ).map(toDiscipline);
  }

  getDiscipline(id: string, includeDeleted = false): DisciplineRecord | null {
    const row = this.get(
      `SELECT * FROM disciplines WHERE id = $id ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
      { id },
    );
    return row ? toDiscipline(row) : null;
  }

  deleteDiscipline(id: string, now: Instant): boolean {
    return this.transaction(() => {
      const changed = this.run(
        'UPDATE disciplines SET deleted_at = $now WHERE id = $id AND deleted_at IS NULL',
        { id, now },
      );
      if (changed) this.run('DELETE FROM sources WHERE discipline_id = $id', { id });
      return changed > 0;
    });
  }

  saveDiscipline(d: DisciplineRecord): void {
    this.run(
      `INSERT INTO disciplines (id, name, priority, duration_minutes, goal, metrics, continue_hint, archived_at, created_at)
       VALUES ($id, $name, $priority, $duration, $goal, $metrics, $hint, $archived, $created)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, priority = excluded.priority,
         duration_minutes = excluded.duration_minutes, goal = excluded.goal, metrics = excluded.metrics,
         continue_hint = excluded.continue_hint, archived_at = excluded.archived_at`,
      {
        id: d.id,
        name: d.name,
        priority: d.priority,
        duration: d.durationMinutes,
        goal: d.goal,
        metrics: d.metrics,
        hint: d.continueHint,
        archived: d.archivedAt,
        created: d.createdAt,
      },
    );
  }

  // Источники

  listSources(disciplineId: string): SourceRecord[] {
    return this.all('SELECT * FROM sources WHERE discipline_id = $id ORDER BY created_at, id', {
      id: disciplineId,
    }).map(toSource);
  }

  getSource(id: string): SourceRecord | null {
    const row = this.get('SELECT * FROM sources WHERE id = $id', { id });
    return row ? toSource(row) : null;
  }

  saveSource(s: SourceRecord): void {
    this.run(
      `INSERT INTO sources (id, discipline_id, kind, title, url, note, created_at)
       VALUES ($id, $discipline, $kind, $title, $url, $note, $created)
       ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, title = excluded.title,
         url = excluded.url, note = excluded.note`,
      {
        id: s.id,
        discipline: s.disciplineId,
        kind: s.kind,
        title: s.title,
        url: s.url,
        note: s.note,
        created: s.createdAt,
      },
    );
  }

  deleteSource(id: string): boolean {
    return this.run('DELETE FROM sources WHERE id = $id', { id }) > 0;
  }

  // Семестры

  getSemester(id: string): SemesterRecord | null {
    const row = this.get('SELECT * FROM semesters WHERE id = $id', { id });
    return row ? toSemester(row) : null;
  }

  findSemester(status: SemesterStatus): SemesterRecord | null {
    const row = this.get(
      'SELECT * FROM semesters WHERE status = $status ORDER BY created_at DESC LIMIT 1',
      { status },
    );
    return row ? toSemester(row) : null;
  }

  listSemesters(): SemesterRecord[] {
    return this.all('SELECT * FROM semesters ORDER BY created_at').map(toSemester);
  }

  saveSemester(s: SemesterRecord): void {
    this.run(
      `INSERT INTO semesters (id, status, start_date, weeks, discipline_ids, frequencies, frequency_overrides,
         settings_patch, discipline_patches, checkpoints, build_info, created_at, confirmed_at, finished_at)
       VALUES ($id, $status, $start, $weeks, $disciplines, $frequencies, $overrides, $settings, $patches,
         $checkpoints, $build, $created, $confirmed, $finished)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status, start_date = excluded.start_date,
         weeks = excluded.weeks, discipline_ids = excluded.discipline_ids, frequencies = excluded.frequencies,
         frequency_overrides = excluded.frequency_overrides, settings_patch = excluded.settings_patch,
         discipline_patches = excluded.discipline_patches, checkpoints = excluded.checkpoints,
         build_info = excluded.build_info, confirmed_at = excluded.confirmed_at, finished_at = excluded.finished_at`,
      {
        id: s.id,
        status: s.status,
        start: s.startDate,
        weeks: s.weeks,
        disciplines: JSON.stringify(s.disciplineIds),
        frequencies: JSON.stringify(s.frequencies),
        overrides: JSON.stringify(s.frequencyOverrides),
        settings: JSON.stringify(s.settingsPatch),
        patches: JSON.stringify(s.disciplinePatches),
        checkpoints: JSON.stringify(s.checkpoints),
        build: s.buildInfo ? JSON.stringify(s.buildInfo) : null,
        created: s.createdAt,
        confirmed: s.confirmedAt,
        finished: s.finishedAt,
      },
    );
  }

  deleteSemester(id: string): void {
    this.transaction(() => {
      const removed = this.listSummaries().filter((s) => s.semesterId === id);
      this.run('DELETE FROM timer WHERE semester_id = $id', { id });
      this.run('DELETE FROM calendar_links WHERE semester_id = $id', { id });
      // Все ключи решений имеют вид «тип:семестр:…».
      this.run(
        "DELETE FROM decisions WHERE substr(key, instr(key, ':') + 1, length($id) + 1) = $id || ':'",
        { id },
      );
      this.run('DELETE FROM semesters WHERE id = $id', { id });
      this.run('DELETE FROM meta WHERE key = $key', { key: `semesterDeletion:${id}` });
      const remaining = this.listSummaries();
      for (const disciplineId of new Set(removed.map((s) => s.disciplineId))) {
        const d = this.getDiscipline(disciplineId);
        const last = removed.filter((s) => s.disciplineId === disciplineId).at(-1);
        if (d && last && d.continueHint === last.continueFrom) {
          const previous = remaining.filter((s) => s.disciplineId === disciplineId).at(-1);
          this.saveDiscipline({ ...d, continueHint: previous?.continueFrom ?? '' });
        }
      }
    });
  }

  // План: каркас и занятия

  loadSkeleton(semesterId: string): SkeletonSlot[] {
    return this.all(
      'SELECT * FROM skeleton_slots WHERE semester_id = $id ORDER BY weekday, start_minute, id',
      { id: semesterId },
    ).map(toSlot);
  }

  loadSessions(semesterId: string): Session[] {
    return this.all('SELECT * FROM sessions WHERE semester_id = $id ORDER BY start, id', {
      id: semesterId,
    }).map(toSession);
  }

  sessionsBetween(semesterId: string, from: Instant, to: Instant): Session[] {
    return this.all(
      'SELECT * FROM sessions WHERE semester_id = $id AND start < $to AND end > $from ORDER BY start, id',
      { id: semesterId, from, to },
    ).map(toSession);
  }

  getSession(semesterId: string, id: string): Session | null {
    const row = this.get('SELECT * FROM sessions WHERE semester_id = $semester AND id = $id', {
      semester: semesterId,
      id,
    });
    return row ? toSession(row) : null;
  }

  saveSession(semesterId: string, s: Session): void {
    this.run(
      `INSERT OR REPLACE INTO sessions (${SESSION_COLUMNS}) VALUES (${SESSION_VALUES})`,
      sessionParams(semesterId, s),
    );
  }

  /** Заменяет каркас и занятия семестра целиком — движок всегда отдаёт план полностью. */
  replacePlan(semesterId: string, skeleton: readonly SkeletonSlot[], sessions: readonly Session[]) {
    this.transaction(() => {
      this.run('DELETE FROM skeleton_slots WHERE semester_id = $id', { id: semesterId });
      this.run('DELETE FROM sessions WHERE semester_id = $id', { id: semesterId });
      const slot = this.db.prepare(
        `INSERT INTO skeleton_slots (semester_id, id, discipline_id, weekday, start_minute, duration_minutes, parity, from_week, to_week)
         VALUES ($semester, $id, $discipline, $weekday, $start, $duration, $parity, $from, $to)`,
      );
      for (const s of skeleton) {
        slot.run({
          semester: semesterId,
          id: s.id,
          discipline: s.disciplineId,
          weekday: s.weekday,
          start: s.startMinute,
          duration: s.durationMinutes,
          parity: s.parity ?? null,
          from: s.fromWeek,
          to: s.toWeek ?? null,
        });
      }
      const session = this.db.prepare(
        `INSERT INTO sessions (${SESSION_COLUMNS}) VALUES (${SESSION_VALUES})`,
      );
      for (const s of sessions) session.run(sessionParams(semesterId, s));
    });
  }

  // Итоги занятий

  getSummary(semesterId: string, sessionId: string): SummaryRecord | null {
    const row = this.get(
      'SELECT * FROM summaries WHERE semester_id = $semester AND session_id = $session',
      { semester: semesterId, session: sessionId },
    );
    return row ? toSummary(row) : null;
  }

  saveSummary(s: SummaryRecord): void {
    this.run(
      `INSERT INTO summaries (semester_id, session_id, discipline_id, key_concepts, retelling, continue_from, next_question, created_at)
       VALUES ($semester, $session, $discipline, $concepts, $retelling, $continue, $question, $created)`,
      {
        semester: s.semesterId,
        session: s.sessionId,
        discipline: s.disciplineId,
        concepts: s.keyConcepts,
        retelling: s.retelling,
        continue: s.continueFrom,
        question: s.nextQuestion ?? '',
        created: s.createdAt,
      },
    );
  }

  listSummaries(): SummaryRecord[] {
    return this.all('SELECT * FROM summaries ORDER BY created_at').map(toSummary);
  }

  latestQuestion(disciplineId: string, before: Instant): string {
    const row = this.get(
      `SELECT su.next_question FROM summaries su
      JOIN sessions s ON s.semester_id = su.semester_id AND s.id = su.session_id
      WHERE su.discipline_id = $id AND s.start < $before
      ORDER BY s.start DESC, su.created_at DESC LIMIT 1`,
      { id: disciplineId, before },
    );
    return (row?.next_question as string | undefined) ?? '';
  }

  /** Журнал одним запросом, без обращений к базе для каждого отдельного занятия. */
  listSummaryDetails(): (SummaryRecord & { disciplineName: string; sessionStart: Instant })[] {
    return this.all(
      `SELECT su.*, d.name AS discipline_name,
      COALESCE(s.start, su.created_at) AS session_start FROM summaries su
      LEFT JOIN disciplines d ON d.id = su.discipline_id
      LEFT JOIN sessions s ON s.semester_id = su.semester_id AND s.id = su.session_id
      ORDER BY session_start DESC, su.created_at DESC, su.semester_id, su.session_id`,
    ).map((r) => ({
      ...toSummary(r),
      disciplineName: (r.discipline_name as string | null) ?? 'Дисциплина без названия',
      sessionStart: r.session_start as Instant,
    }));
  }

  // Таймер идущего занятия

  getTimer(): TimerRecord | null {
    const row = this.get('SELECT semester_id, data FROM timer WHERE id = 1');
    return row
      ? { semesterId: row.semester_id as string, state: json<TimerState>(row.data, null as never) }
      : null;
  }

  setTimer(t: TimerRecord): void {
    this.run(
      `INSERT INTO timer (id, semester_id, data) VALUES (1, $semester, $data)
       ON CONFLICT (id) DO UPDATE SET semester_id = excluded.semester_id, data = excluded.data`,
      { semester: t.semesterId, data: JSON.stringify(t.state) },
    );
  }

  clearTimer(): void {
    this.run('DELETE FROM timer WHERE id = 1');
  }

  // Решения — вопросы сервиса к пользователю

  /** Создаёт решение, если такого ключа ещё не было. Решённое повторно не открывается. */
  ensureDecision(
    id: string,
    key: string,
    kind: DecisionKind,
    payload: Record<string, unknown>,
    now: Instant,
  ): DecisionRecord {
    this.run(
      `INSERT INTO decisions (id, key, kind, status, payload, created_at)
       VALUES ($id, $key, $kind, 'open', $payload, $now) ON CONFLICT (key) DO NOTHING`,
      { id, key, kind, payload: JSON.stringify(payload), now },
    );
    return toDecision(this.get('SELECT * FROM decisions WHERE key = $key', { key })!);
  }

  listDecisions(status: DecisionRecord['status'] = 'open'): DecisionRecord[] {
    return this.all('SELECT * FROM decisions WHERE status = $status ORDER BY created_at, id', {
      status,
    }).map(toDecision);
  }

  getDecision(id: string): DecisionRecord | null {
    const row = this.get('SELECT * FROM decisions WHERE id = $id', { id });
    return row ? toDecision(row) : null;
  }

  resolveDecision(id: string, resolution: Record<string, unknown>, now: Instant): void {
    this.run(
      `UPDATE decisions SET status = 'resolved', resolution = $resolution, resolved_at = $now WHERE id = $id`,
      { id, resolution: JSON.stringify(resolution), now },
    );
  }

  // Google

  getGoogleAccount(): GoogleAccount {
    const row = this.get('SELECT data FROM google_account WHERE id = 1');
    return row
      ? { ...EMPTY_GOOGLE_ACCOUNT, ...json<Partial<GoogleAccount>>(row.data, {}) }
      : EMPTY_GOOGLE_ACCOUNT;
  }

  saveGoogleAccount(account: GoogleAccount): void {
    this.run(
      'INSERT INTO google_account (id, data) VALUES (1, $data) ON CONFLICT (id) DO UPDATE SET data = excluded.data',
      { data: JSON.stringify(account) },
    );
  }

  updateGoogleAccount(patch: Partial<GoogleAccount>): GoogleAccount {
    const next = { ...this.getGoogleAccount(), ...patch };
    this.saveGoogleAccount(next);
    return next;
  }

  listLinks(semesterId: string): CalendarLink[] {
    return this.all('SELECT * FROM calendar_links WHERE semester_id = $id', { id: semesterId }).map(
      (r) => ({
        semesterId: r.semester_id as string,
        sessionId: r.session_id as string,
        eventId: r.event_id as string,
        start: Number(r.start),
        end: Number(r.end),
        summary: r.summary as string,
      }),
    );
  }

  saveLink(link: CalendarLink): void {
    this.run(
      `INSERT OR REPLACE INTO calendar_links (semester_id, session_id, event_id, start, end, summary)
       VALUES ($semester, $session, $event, $start, $end, $summary)`,
      {
        semester: link.semesterId,
        session: link.sessionId,
        event: link.eventId,
        start: link.start,
        end: link.end,
        summary: link.summary,
      },
    );
  }

  deleteLink(semesterId: string, sessionId: string): void {
    this.run('DELETE FROM calendar_links WHERE semester_id = $semester AND session_id = $session', {
      semester: semesterId,
      session: sessionId,
    });
  }

  clearLinks(): void {
    this.run('DELETE FROM calendar_links');
  }

  getBusyCache(): BusyCache | null {
    const row = this.get('SELECT * FROM busy_cache WHERE id = 1');
    return row
      ? {
          rangeStart: Number(row.range_start),
          rangeEnd: Number(row.range_end),
          fetchedAt: Number(row.fetched_at),
          events: json<BusyEvent[]>(row.events, []),
        }
      : null;
  }

  saveBusyCache(cache: BusyCache): void {
    this.run(
      `INSERT INTO busy_cache (id, range_start, range_end, fetched_at, events) VALUES (1, $start, $end, $fetched, $events)
       ON CONFLICT (id) DO UPDATE SET range_start = excluded.range_start, range_end = excluded.range_end,
         fetched_at = excluded.fetched_at, events = excluded.events`,
      {
        start: cache.rangeStart,
        end: cache.rangeEnd,
        fetched: cache.fetchedAt,
        events: JSON.stringify(cache.events),
      },
    );
  }

  clearBusyCache(): void {
    this.run('DELETE FROM busy_cache');
  }

  // Служебное

  getMeta(key: string): string | null {
    const row = this.get('SELECT value FROM meta WHERE key = $key', { key });
    return row ? (row.value as string) : null;
  }

  setMeta(key: string, value: string): void {
    this.run(
      'INSERT INTO meta (key, value) VALUES ($key, $value) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      { key, value },
    );
  }
}

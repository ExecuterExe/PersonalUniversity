import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Миграции по порядку; номер последней применённой хранится в PRAGMA user_version. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  );

  CREATE TABLE disciplines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('main', 'additional')),
    duration_minutes INTEGER NOT NULL,
    goal TEXT NOT NULL,
    metrics TEXT NOT NULL,
    continue_hint TEXT NOT NULL DEFAULT '',
    archived_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    discipline_id TEXT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('link', 'note')),
    title TEXT NOT NULL,
    url TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sources_by_discipline ON sources(discipline_id, created_at);

  CREATE TABLE semesters (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'finished')),
    start_date TEXT NOT NULL,
    weeks INTEGER NOT NULL,
    discipline_ids TEXT NOT NULL,
    frequencies TEXT NOT NULL DEFAULT '{}',
    frequency_overrides TEXT NOT NULL DEFAULT '{}',
    settings_patch TEXT NOT NULL DEFAULT '{}',
    discipline_patches TEXT NOT NULL DEFAULT '{}',
    checkpoints TEXT NOT NULL DEFAULT '{"midDone":false,"endDone":false}',
    build_info TEXT,
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    finished_at INTEGER
  );
  -- Не больше одного черновика и одного идущего семестра.
  CREATE UNIQUE INDEX one_semester_per_status ON semesters(status) WHERE status IN ('draft', 'active');

  CREATE TABLE skeleton_slots (
    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    discipline_id TEXT NOT NULL,
    weekday INTEGER NOT NULL,
    start_minute INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL,
    parity INTEGER,
    from_week INTEGER NOT NULL,
    to_week INTEGER,
    PRIMARY KEY (semester_id, id)
  );

  CREATE TABLE sessions (
    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    discipline_id TEXT NOT NULL,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    status TEXT NOT NULL,
    origin TEXT NOT NULL,
    skeleton_slot_id TEXT,
    original_start INTEGER,
    move_reason TEXT,
    actual_minutes INTEGER,
    elapsed_minutes INTEGER,
    started_at INTEGER,
    finished_at INTEGER,
    custom_duration INTEGER NOT NULL DEFAULT 0,
    accepted_violations TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (semester_id, id)
  );
  CREATE INDEX sessions_by_start ON sessions(semester_id, start);

  CREATE TABLE summaries (
    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    discipline_id TEXT NOT NULL,
    key_concepts TEXT NOT NULL DEFAULT '',
    retelling TEXT NOT NULL DEFAULT '',
    continue_from TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (semester_id, session_id)
  );

  CREATE TABLE timer (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    semester_id TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE decisions (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
    payload TEXT NOT NULL,
    resolution TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

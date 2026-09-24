// Thin wrapper around the built-in node:sqlite module. Keeping all database
// access behind this file makes it easy to switch to better-sqlite3 later.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(SERVER_DIR, 'migrations');

/** The database file: $DATA_DIR/hashmark.db, by default ./data/hashmark.db. */
export function databaseFile(env = process.env) {
  return join(env.DATA_DIR || join(SERVER_DIR, '..', 'data'), 'hashmark.db');
}

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

// Migrations run with foreign keys OFF. The usual SQLite way to change a column
// (create new table, copy, drop old, rename) would otherwise fire ON DELETE
// CASCADE when the old table is dropped and silently wipe child rows such as
// revisions. The pragma cannot be changed inside a transaction, so it is set
// here, and foreign_key_check verifies the result before each commit.
function migrate(db) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  const current = row?.v ?? 0;
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const version = parseInt(f, 10);
    if (version <= current) continue;
    transaction(db, () => {
      db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
      if (db.prepare('PRAGMA foreign_key_check').all().length) {
        throw new Error(`Migration ${f} left rows that violate foreign keys.`);
      }
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    });
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

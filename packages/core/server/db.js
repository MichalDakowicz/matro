const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')), created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL, expires INTEGER NOT NULL
);
-- One-time sign-up codes from the head account. Only a hash of each code is kept.
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL, used_at INTEGER
);
CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, added INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE, path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, group_id TEXT NOT NULL, group_title TEXT NOT NULL, year INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'show')), season INTEGER, episode INTEGER,
  size INTEGER NOT NULL, mtime INTEGER NOT NULL, added INTEGER NOT NULL, duration REAL, probe TEXT
);
CREATE INDEX IF NOT EXISTS items_group ON items(group_id);
-- Everything the desktop renderer keeps per person: watch progress, queue, remembered tracks, subtitle style.
CREATE TABLE IF NOT EXISTS user_state (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subtitles (
  id INTEGER PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, name TEXT NOT NULL, language TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'forced', 'sdh')), vtt TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subtitles_item ON subtitles(item_id);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(schema);
  return db;
}
// node:sqlite rejects undefined and booleans as bind values.
const bind = value => value === undefined ? null : typeof value === 'boolean' ? Number(value) : value;
function tx(db, fn) {
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { open, bind, tx };

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')), created INTEGER NOT NULL, account_key TEXT,
  legacy_scope INTEGER NOT NULL DEFAULT 0
);
-- Preserve existing numeric IDs and advance the high-water mark even when the highest account is deleted.
CREATE TABLE IF NOT EXISTS user_sequence (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), last_id INTEGER NOT NULL);
INSERT INTO user_sequence (singleton, last_id) VALUES (1, COALESCE((SELECT MAX(id) FROM users), 0))
ON CONFLICT(singleton) DO UPDATE SET last_id = MAX(last_id, excluded.last_id);
CREATE TRIGGER IF NOT EXISTS users_advance_sequence AFTER INSERT ON users BEGIN
  UPDATE user_sequence SET last_id = MAX(last_id, NEW.id) WHERE singleton = 1;
END;
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
CREATE TABLE IF NOT EXISTS movie_requests (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL, title_key TEXT NOT NULL, year INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'handled')),
  created INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS movie_requests_pending ON movie_requests(user_id, title_key, year) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS movie_requests_user ON movie_requests(user_id, status, id DESC);
-- Keep request IDs distinct after removal so stale links cannot act on a new request.
CREATE TABLE IF NOT EXISTS movie_request_sequence (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1), last_id INTEGER NOT NULL
);
INSERT INTO movie_request_sequence (singleton, last_id) VALUES (1, COALESCE((SELECT MAX(id) FROM movie_requests), 0))
ON CONFLICT(singleton) DO UPDATE SET last_id = MAX(last_id, excluded.last_id);
CREATE TABLE IF NOT EXISTS movie_request_devices (
  id TEXT PRIMARY KEY, session_hash TEXT NOT NULL UNIQUE REFERENCES sessions(token_hash) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS movie_request_push (
  request_id INTEGER NOT NULL REFERENCES movie_requests(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES movie_request_devices(id) ON DELETE CASCADE,
  notify_after INTEGER NOT NULL, PRIMARY KEY (request_id, device_id)
);
CREATE INDEX IF NOT EXISTS movie_request_push_due ON movie_request_push(notify_after);
CREATE INDEX IF NOT EXISTS movie_request_push_device ON movie_request_push(device_id);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  tx(db, () => {
    db.exec(schema);
    const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
    if (!userColumns.has('account_key')) db.exec('ALTER TABLE users ADD COLUMN account_key TEXT');
    if (!userColumns.has('legacy_scope')) db.exec('ALTER TABLE users ADD COLUMN legacy_scope INTEGER NOT NULL DEFAULT 0');
    db.exec(`UPDATE users SET account_key = lower(hex(randomblob(16))), legacy_scope = 1 WHERE account_key IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS users_account_key ON users(account_key);`);
    const additions = {
      folders: { removed: 'INTEGER NOT NULL DEFAULT 0', canonical_path: 'TEXT' },
      items: { removed: 'INTEGER NOT NULL DEFAULT 0', fingerprint: 'TEXT', probe_failures: 'INTEGER NOT NULL DEFAULT 0',
        probe_error: 'TEXT', probed_at: 'INTEGER', retry_probe_after: 'INTEGER', edition_group: 'TEXT', edition_label: 'TEXT' }
    };
    for (const [table, columns] of Object.entries(additions)) {
      const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
      for (const [column, definition] of Object.entries(columns)) {
        if (!present.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
      if (table === 'items' && !present.has('probe_failures')) {
        db.exec("UPDATE items SET probe = NULL, duration = NULL WHERE json_extract(CASE WHEN json_valid(probe) THEN probe END, '$.broken') = 1");
      }
    }
    // Earlier builds included the device and change time in the fingerprint.
    const previousFingerprints = db.prepare("SELECT id, fingerprint FROM items WHERE fingerprint GLOB '*:*:*:*:*'").all();
    const setFingerprint = db.prepare('UPDATE items SET fingerprint = ? WHERE id = ?');
    for (const { id, fingerprint } of previousFingerprints) {
      const [, inode, size, mtime] = fingerprint.split(':');
      setFingerprint.run([size, mtime, inode === '0' ? '' : inode].join(':'), id);
    }
    // Removed catalog rows keep their IDs so uploaded subtitles stay linked.
    db.exec(`CREATE VIEW IF NOT EXISTS active_folders AS SELECT * FROM folders WHERE removed = 0;
      CREATE VIEW IF NOT EXISTS active_items AS SELECT * FROM items WHERE removed = 0;`);
  }, 'BEGIN IMMEDIATE');
  return db;
}

// Keep server startup and restores mutually exclusive for this data directory.
// SQLite releases the lock even if the process is killed.
function lockData(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const lock = new DatabaseSync(path.join(dir, '.matro.lock'));
  try {
    lock.exec('BEGIN IMMEDIATE');
  } catch (error) {
    lock.close();
    if ([5, 6].includes(error.errcode & 0xff)) {
      throw new Error('This data directory is in use by a Matro server or restore. Stop the server and wait for any restore to finish.');
    }
    throw error;
  }
  return () => lock.close();
}
// node:sqlite rejects undefined and booleans as bind values.
const bind = value => value === undefined ? null : typeof value === 'boolean' ? Number(value) : value;
function tx(db, fn, begin = 'BEGIN') {
  db.exec(begin);
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { open, bind, tx, lockData };

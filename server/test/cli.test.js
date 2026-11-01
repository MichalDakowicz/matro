const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matro-cli-'));
const data = path.join(root, 'data'), library = path.join(root, 'films', 'Heat (1995)');
fs.mkdirSync(library, { recursive: true });
fs.writeFileSync(path.join(library, 'Heat.1995.mkv'), 'not really a video');
const cli = (args, password) => spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), ...args], {
  encoding: 'utf8', env: { ...process.env, MATRO_DATA: data, MATRO_MEDIA: path.join(data, 'media'), MATRO_PASSWORD: password ?? '' } });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('setup creates the head account and registers folders', () => {
  const bad = cli(['setup', '--username', 'head'], 'short');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /8 characters/);
  const ok = cli(['setup', '--username', 'head', '--library', path.join(root, 'films')], 'correct horse battery');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Head account "head" created/);
  assert.match(ok.stdout, /1 video found/);
  const db = new DatabaseSync(path.join(data, 'matro.db'));
  assert.deepEqual({ ...db.prepare('SELECT username, role FROM users').get() }, { username: 'head', role: 'admin' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1);
  assert.equal(db.prepare('SELECT hash FROM users').get().hash.includes('correct'), false);
  db.close();
});

test('setup refuses once an account exists, passwd resets and signs out', () => {
  const again = cli(['setup', '--username', 'other'], 'correct horse battery');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already has accounts/);
  assert.equal(cli(['passwd', 'nobody'], 'new-password-99').status, 1);
  const db = new DatabaseSync(path.join(data, 'matro.db'));
  db.prepare("INSERT INTO sessions (token_hash, user_id, created, expires) VALUES ('x', 1, 0, 9999999999999)").run();
  const before = db.prepare('SELECT hash FROM users').get().hash;
  const reset = cli(['passwd', 'head'], 'new-password-99');
  assert.equal(reset.status, 0, reset.stderr);
  assert.notEqual(db.prepare('SELECT hash FROM users').get().hash, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  db.close();
});

const { HttpError } = require('./http');

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;
const publicUser = user => ({ id: user.id, accountKey: user.account_key, username: user.username, role: user.role });
function validateCredentials(username, password) {
  username = String(username || '').trim(); password = String(password || '');
  if (!USERNAME.test(username)) throw new HttpError(400, 'Usernames are 2–32 letters, numbers, dots, dashes or underscores.');
  if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Passwords need at least 8 characters.');
  return { username, password };
}
// Shared by the web server (viewer accounts) and the command line (head account, password resets).
function createUsers(db, auth) {
  const insert = db.prepare(`INSERT INTO users (id, username, hash, role, created, account_key)
    SELECT last_id + 1, ?, ?, ?, ?, lower(hex(randomblob(16))) FROM user_sequence WHERE singleton = 1`);
  const setHash = db.prepare('UPDATE users SET hash = ? WHERE id = ?');
  const byName = db.prepare('SELECT id, username, role FROM users WHERE username = ?');
  const count = db.prepare('SELECT COUNT(*) AS n FROM users');
  const insertHash = (username, hash, role) => {
    try { return Number(insert.run(username, hash, role, Date.now()).lastInsertRowid); }
    catch (error) { if (/UNIQUE/.test(error.message)) throw new HttpError(409, 'That username is taken.'); throw error; }
  };
  return {
    insertHash,
    count: () => count.get().n,
    byName: name => byName.get(String(name)),
    async create(username, password, role) { return insertHash(username, await auth.hashPassword(password), role); },
    async setPassword(userId, password) { setHash.run(await auth.hashPassword(password), userId); auth.destroyAll(userId); }
  };
}
module.exports = { USERNAME, publicUser, validateCredentials, createUsers };

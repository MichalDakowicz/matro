const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const config = require('./config');
const { HttpError } = require('./http');
const { publicUser } = require('./users');

const DAY = 86400000;
const scrypt = (password, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key)));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('hex')}$${(await scrypt(password, salt)).toString('hex')}`;
}
// Unknown usernames still pay for one hash so response time does not reveal which names exist.
const DUMMY = hashPassword('matro-dummy-password');
async function verifyPassword(password, stored) {
  const [version, salt, hash] = String(stored).split('$');
  if (version !== 's1' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex'), actual = await scrypt(password, Buffer.from(salt, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createAuth(db) {
  const attempts = new Map(), sharedFailures = new Map();
  function remember(entries, key, entry) {
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > 5000) entries.delete(entries.keys().next().value);
  }
  const rateLimited = seconds => new HttpError(429, `Too many attempts. Try again in ${seconds} seconds.`);
  const q = {
    byName: db.prepare('SELECT * FROM users WHERE username = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT s.token_hash, s.expires, u.id, u.account_key, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
    slide: db.prepare('UPDATE sessions SET expires = ? WHERE token_hash = ?'),
    drop: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    dropUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    expired: db.prepare('DELETE FROM sessions WHERE expires < ?')
  };
  return {
    hashPassword,
    async attempt(key, verify, sharedKey) {
      const now = Date.now(), previous = attempts.get(key);
      if (previous?.until > now) throw rateLimited(Math.ceil((previous.until - now) / 1000));
      // Reserve the attempt before awaiting the credential check so concurrent requests share the limit.
      const count = (previous?.expires > now ? previous.count : 0) + 1;
      const until = count < 5 ? 0 : now + 60000 * 2 ** Math.min(count - 5, 6);
      const entry = { count, until, expires: Math.max(now, until) + 15 * 60000 };
      remember(attempts, key, entry);
      const shared = sharedFailures.get(sharedKey);
      const hot = shared?.until > now && shared.count >= 20;
      // A shared limit adds a delay while still letting a fresh address use valid credentials.
      if (hot) await delay(1000);
      const value = await verify();
      if (value) {
        if (attempts.get(key) === entry) attempts.delete(key);
      } else if (sharedKey) {
        const time = Date.now(), recent = sharedFailures.get(sharedKey);
        remember(sharedFailures, sharedKey, recent?.until > time ? { ...recent, count: recent.count + 1 } : { count: 1, until: time + 60000 });
        if (hot) throw rateLimited(Math.max(1, Math.ceil((shared.until - time) / 1000)));
      }
      return value;
    },
    async check(username, password) {
      const user = q.byName.get(String(username));
      const ok = await verifyPassword(String(password), user ? user.hash : await DUMMY);
      return user && ok ? user : null;
    },
    create(userId) {
      const token = crypto.randomBytes(32).toString('base64url'), now = Date.now();
      q.insertSession.run(sha(token), userId, now, now + config.sessionDays * DAY);
      q.expired.run(now);
      return token;
    },
    session(token) {
      if (!token) return null;
      const row = q.session.get(sha(token)), now = Date.now();
      if (!row || row.expires < now) return null;
      const renewed = row.expires - now < (config.sessionDays - 1) * DAY;
      if (renewed) q.slide.run(now + config.sessionDays * DAY, row.token_hash);
      return { user: publicUser(row), renewed };
    },
    destroy(token) { if (token) q.drop.run(sha(token)); },
    destroyAll(userId) { q.dropUser.run(userId); }
  };
}
module.exports = { createAuth, hashPassword, verifyPassword, sessionHash: sha };

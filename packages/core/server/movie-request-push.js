const { randomUUID } = require('node:crypto');
const { sessionHash } = require('./auth');
const { tx } = require('./db');
const { createFcm } = require('./fcm');
const { HttpError } = require('./http');

function createMovieRequestPush(db, { env, fetch, send = createFcm(env, fetch) } = {}) {
  const bySession = db.prepare('SELECT id, token FROM movie_request_devices WHERE session_hash = ?');
  const byToken = db.prepare('SELECT session_hash FROM movie_request_devices WHERE token = ?');
  const remove = db.prepare('DELETE FROM movie_request_devices WHERE session_hash = ?');
  const dropToken = db.prepare('DELETE FROM movie_request_devices WHERE id = ? AND token = ?');
  const register = db.prepare(`INSERT INTO movie_request_devices (id, session_hash, token) VALUES (?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET session_hash = excluded.session_hash
    ON CONFLICT(session_hash) DO UPDATE SET token = excluded.token RETURNING id`);
  const enqueue = db.prepare(`INSERT INTO movie_request_push (request_id, device_id, notify_after)
    SELECT ?, d.id, ? FROM movie_request_devices d JOIN sessions s ON s.token_hash = d.session_hash
    JOIN users u ON u.id = s.user_id WHERE s.expires >= ? AND u.role = 'admin'`);
  // Requesters hear about the outcome of their own request on their own devices.
  const enqueueFor = db.prepare(`INSERT OR IGNORE INTO movie_request_push (request_id, device_id, notify_after)
    SELECT ?, d.id, ? FROM movie_request_devices d JOIN sessions s ON s.token_hash = d.session_hash
    WHERE s.user_id = ? AND s.expires >= ?`);
  const clear = db.prepare('DELETE FROM movie_request_push WHERE request_id = ?');
  const due = db.prepare(`SELECT q.request_id AS requestId, d.id, d.token, r.title, NULLIF(r.year, 0) AS year, requester.username AS requester,
    CASE WHEN r.status = 'pending' THEN NULL WHEN r.declined THEN 'declined' ELSE 'ready' END AS outcome
    FROM movie_request_push q JOIN movie_requests r ON r.id = q.request_id
    LEFT JOIN users requester ON requester.id = r.user_id
    JOIN movie_request_devices d ON d.id = q.device_id JOIN sessions s ON s.token_hash = d.session_hash
    JOIN users u ON u.id = s.user_id WHERE q.notify_after <= ? AND s.expires >= ?
      AND CASE WHEN r.status = 'pending' THEN u.role = 'admin' ELSE u.id = r.user_id END
    ORDER BY q.notify_after, q.request_id LIMIT 1`);
  const delivered = db.prepare('DELETE FROM movie_request_push WHERE request_id = ? AND device_id = ?');
  const retry = db.prepare('UPDATE movie_request_push SET notify_after = ? WHERE request_id = ? AND device_id = ?');
  let closed = false, active = false, timer, failed = false;

  async function notify() {
    if (!send || closed || active) return;
    active = true;
    try {
      let job;
      while (!closed && (job = due.get(Date.now(), Date.now()))) {
        let outcome;
        try { outcome = await send(job); }
        catch {
          if (!closed) {
            retry.run(Date.now() + 5 * 60 * 1000, job.requestId, job.id);
            if (!failed) console.error('Could not send a movie request alert. Matro will retry.');
            failed = true;
          }
          return;
        }
        if (closed) return;
        if (outcome === 'unregistered') dropToken.run(job.id, job.token);
        else delivered.run(job.requestId, job.id);
        failed = false;
      }
    } catch {
      console.error('Could not update the movie request notification queue.');
    } finally { active = false; }
  }

  const requireProvider = () => { if (!send) throw new HttpError(503, 'Phone alerts aren’t configured on this server.'); };
  return {
    enabled: !!send,
    register(session, token) {
      requireProvider();
      if (typeof token !== 'string' || !/^[A-Za-z0-9_:-]{20,512}$/.test(token)) throw new HttpError(400, 'Invalid Android push token.');
      const key = sessionHash(session);
      return tx(db, () => {
        const previous = byToken.get(token);
        if (previous && previous.session_hash !== key) remove.run(key);
        return { registration: register.get(randomUUID(), key, token).id };
      });
    },
    unregister(session) { remove.run(sessionHash(session)); },
    async test(session) {
      requireProvider();
      const device = bySession.get(sessionHash(session));
      if (!device) throw new HttpError(409, 'Enable movie request alerts on this phone first.');
      let outcome;
      try { outcome = await send(device, { test: true }); }
      catch { throw new HttpError(502, 'Could not send a phone alert. Try again in a moment.'); }
      if (outcome === 'unregistered') {
        dropToken.run(device.id, device.token);
        throw new HttpError(409, 'Reconnect movie request alerts on this phone and try again.');
      }
    },
    enqueue(id, now) { if (send) enqueue.run(id, now, now); },
    enqueueFor(id, userId, now) { if (send && userId != null) enqueueFor.run(id, now, userId, now); },
    clear(id) { clear.run(id); },
    notify,
    start() {
      if (!send) return;
      timer = setInterval(notify, 30_000).unref();
      void notify();
    },
    close() { closed = true; clearInterval(timer); },
  };
}

module.exports = { createMovieRequestPush };

const { HttpError } = require('./http');
const { tx } = require('./db');
const { createMovieRequestPush } = require('./movie-request-push');

function createMovieRequests(db, options) {
  const push = createMovieRequestPush(db, options);
  const select = `SELECT r.id, r.title, NULLIF(r.year, 0) AS year, r.status, r.created, u.username AS requester
    FROM movie_requests r LEFT JOIN users u ON u.id = r.user_id`;
  const forViewer = db.prepare(`${select} WHERE r.user_id = ? AND r.status = ? ORDER BY r.id DESC LIMIT ?`);
  const forOwner = db.prepare(`${select} WHERE r.status = ? ORDER BY r.id DESC LIMIT ?`);
  const byId = db.prepare(`${select} WHERE r.id = ?`);
  const duplicate = db.prepare(`SELECT id FROM movie_requests WHERE user_id = ? AND title_key = ? AND year = ? AND status = 'pending'`);
  const nextId = db.prepare('UPDATE movie_request_sequence SET last_id = last_id + 1 WHERE singleton = 1 RETURNING last_id');
  const insert = db.prepare('INSERT INTO movie_requests (id, user_id, title, title_key, year, created) VALUES (?, ?, ?, ?, ?, ?)');
  const resolve = db.prepare("UPDATE movie_requests SET status = 'handled' WHERE id = ?");
  const remove = db.prepare("DELETE FROM movie_requests WHERE id = ? AND (? = 'admin' OR user_id = ?)");

  return {
    push,
    list(user) {
      if (user.role === 'admin') return {
        pending: forOwner.all('pending', -1), handled: forOwner.all('handled', 30), alertsConfigured: push.enabled, canRemove: true,
      };
      return { pending: forViewer.all(user.id, 'pending', -1), handled: forViewer.all(user.id, 'handled', 30), canRemove: true };
    },
    submit(user, body) {
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
      if (!rawTitle || rawTitle.length > 200 || /[\x00-\x1f\x7f]/.test(rawTitle)) throw new HttpError(400, 'Enter a movie title up to 200 characters.');
      const title = rawTitle.replace(/\s+/g, ' ');
      const year = body.year == null || body.year === '' ? 0 : Number(body.year);
      if (body.year != null && body.year !== '' && (!['number', 'string'].includes(typeof body.year) ||
          !/^\d{4}$/.test(String(body.year)) || year < 1000)) throw new HttpError(400, 'Enter a four-digit release year.');
      const key = title.normalize('NFKC').toLowerCase(), now = Date.now();
      const result = tx(db, () => {
        const existing = duplicate.get(user.id, key, year);
        if (existing) return { request: byId.get(existing.id), duplicate: true };
        const { last_id: id } = nextId.get();
        insert.run(id, user.id, title, key, year, now);
        push.enqueue(id, now);
        return { request: byId.get(id), duplicate: false };
      });
      if (!result.duplicate) void push.notify();
      return result;
    },
    handle(id) {
      const request = Number.isSafeInteger(id) && byId.get(id);
      if (!request) throw new HttpError(404, 'Movie request not found.');
      if (request.status === 'pending') tx(db, () => { resolve.run(id); push.clear(id); });
      return { request: { ...request, status: 'handled' } };
    },
    remove(user, id) {
      if (!Number.isSafeInteger(id) || !remove.run(id, user.role, user.id).changes) throw new HttpError(404, 'Movie request not found.');
    },
    start: push.start,
    close: push.close,
  };
}

module.exports = { createMovieRequests };

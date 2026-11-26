const { HttpError, readJson } = require('../http');
const { episodeGaps } = require('../../episode-schedule.cjs');

function register(app) {
  const { db, tmdb, router } = app;
  const find = db.prepare("SELECT season, episode, path FROM active_items WHERE kind = 'show' AND group_id = ?");
  const followed = db.prepare('SELECT group_id FROM followed_shows WHERE user_id = ? ORDER BY created DESC');
  const check = db.prepare('SELECT 1 FROM followed_shows WHERE user_id = ? AND group_id = ?');
  const add = db.prepare('INSERT OR IGNORE INTO followed_shows (user_id, group_id, created) VALUES (?, ?, ?)');
  const remove = db.prepare('DELETE FROM followed_shows WHERE user_id = ? AND group_id = ?');
  app.followedShows = userId => followed.all(userId).map(row => row.group_id);

  router.add('POST', '/api/follows', async ctx => {
    const { groupId, follow } = await readJson(ctx.req, 4096);
    if (typeof follow !== 'boolean' || typeof groupId !== 'string') throw new HttpError(400, 'Invalid show follow change.');
    if (!tmdb.enabled || !find.all(groupId).length) throw new HttpError(404, 'That show is unavailable.');
    if (follow) add.run(ctx.user.id, groupId, Date.now());
    else remove.run(ctx.user.id, groupId);
    return { followed: app.followedShows(ctx.user.id) };
  });

  router.add('GET', '/api/follows/:groupId/episodes', async ctx => {
    const { groupId } = ctx.params, owned = find.all(groupId);
    if (!tmdb.enabled || !owned.length || !check.get(ctx.user.id, groupId)) throw new HttpError(404, 'That show is unavailable.');
    let episodes;
    try { episodes = await tmdb.showSchedule(groupId); }
    catch { throw new HttpError(502, 'Could not load the episode schedule from TMDB.'); }
    if (!episodes) throw new HttpError(404, 'This show needs a TMDB match.');
    return { episodes: episodeGaps(episodes, owned) };
  });
}
module.exports = { register };

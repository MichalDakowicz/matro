const { readJson, HttpError } = require('../http');
const { editTitleLists } = require('../../title-lists.cjs');

function createTitleLists(db) {
  const get = db.prepare('SELECT data FROM title_lists WHERE user_id = ?');
  const put = db.prepare('INSERT INTO title_lists (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data');
  const title = db.prepare("SELECT 1 FROM active_items WHERE (kind = 'movie' AND (id = ? OR edition_group = ?)) OR (kind = 'show' AND group_id = ?) LIMIT 1");
  const read = userId => JSON.parse(get.get(userId)?.data || '[]');
  return { read, update(userId, change) {
    let lists;
    try {
      lists = editTitleLists(read(userId), change, key => typeof key === 'string' && Boolean(title.get(key, key, key)));
    } catch (error) { throw new HttpError(400, error.message); }
    put.run(userId, JSON.stringify(lists));
    return lists;
  } };
}
function register(app) {
  app.titleLists = createTitleLists(app.db);
  app.router.add('POST', '/api/lists', async ctx => ({ lists: app.titleLists.update(ctx.user.id, await readJson(ctx.req, 4096)) }));
}
module.exports = { register, createTitleLists };

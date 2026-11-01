const { HttpError, readJson } = require('../http');

function register({ router, downloads, tmdb }) {
  const prefix = '/api/admin/downloads';
  const run = async fn => {
    try { return { result: await fn() }; }
    catch (error) { throw new HttpError(400, error.message); }
  };
  router.add('GET', `${prefix}/config`, { auth: 'admin' }, () => run(() => downloads.config()));
  router.add('GET', `${prefix}/list`, { auth: 'admin' }, () => run(async () => {
    const [items, jobs] = await Promise.all([downloads.list('server'), downloads.jobs('server')]);
    return tmdb.downloadArtwork(items.map(item => {
      const job = jobs.find(job => job.hash === item.hash);
      return { ...item, ...(job ? { title: job.title, year: job.year, kind: job.kind } : {}) };
    }));
  }));
  router.add('GET', `${prefix}/jobs`, { auth: 'admin' }, () => run(async () => tmdb.downloadArtwork(await downloads.jobs('server'))));
  const actions = { configure: 'configure', search: 'search', 'series-search': 'seriesSearch', 'series-releases': 'seriesReleases', add: 'add', remove: 'remove' };
  for (const [route, method] of Object.entries(actions)) router.add('POST', `${prefix}/${route}`, { auth: 'admin' }, async ctx => {
    const body = await readJson(ctx.req);
    if (['add', 'remove', 'configure'].includes(route) && body.target && body.target !== 'server') throw new HttpError(400, 'Downloads run on the Matro host.');
    if (['add', 'remove'].includes(route)) body.target = 'server';
    return run(() => downloads[method](body));
  });
  router.add('POST', `${prefix}/retry`, { auth: 'admin' }, async ctx => { const { id } = await readJson(ctx.req); return run(() => downloads.retry(id)); });
}
module.exports = { register };

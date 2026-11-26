const { HttpError, readJson } = require('../http');

function register({ router, movieRequests, tmdb }) {
  router.add('GET', '/api/movie-requests', { auth: 'viewer' }, ctx => ({ ...movieRequests.list(ctx.user), tmdb: tmdb.enabled }));
  // Viewers pick a title from TMDB instead of typing it. These routes come before `:id`, which would otherwise swallow them.
  router.add('GET', '/api/movie-requests/search', { auth: 'viewer' }, async ctx => {
    if (!tmdb.enabled) throw new HttpError(503, 'TMDB isn’t configured on this server.');
    try { return { results: await tmdb.search(ctx.query.get('kind') === 'movie' ? 'movie' : 'show', ctx.query.get('query')) }; }
    catch (error) { throw new HttpError(502, error.message); }
  });
  const viewerDevices = '/api/movie-requests/device';
  router.add('PUT', viewerDevices, { auth: 'viewer' }, async ctx =>
    movieRequests.push.register(ctx.token, (await readJson(ctx.req, 2048)).token));
  router.add('DELETE', viewerDevices, { auth: 'viewer' }, ctx => { movieRequests.push.unregister(ctx.token); });
  router.add('POST', viewerDevices + '/test', { auth: 'viewer' }, async ctx => { await movieRequests.push.test(ctx.token); });
  router.add('POST', '/api/movie-requests', { auth: 'viewer' }, async ctx =>
    movieRequests.submit(ctx.user, await readJson(ctx.req, 4096)));
  router.add('DELETE', '/api/movie-requests/:id', ctx =>
    movieRequests.remove(ctx.user, Number(ctx.params.id)));
  router.add('GET', '/api/admin/movie-requests', { auth: 'admin' }, ctx => ({ ...movieRequests.list(ctx.user), tmdb: tmdb.enabled }));
  router.add('PATCH', '/api/admin/movie-requests/:id', { auth: 'admin' }, async ctx =>
    movieRequests.handle(Number(ctx.params.id), (await readJson(ctx.req, 256)).declined === true));
  const devices = '/api/admin/movie-requests/device';
  router.add('PUT', devices, { auth: 'admin' }, async ctx =>
    movieRequests.push.register(ctx.token, (await readJson(ctx.req, 2048)).token));
  router.add('DELETE', devices, { auth: 'admin' }, ctx => { movieRequests.push.unregister(ctx.token); });
  router.add('POST', devices + '/test', { auth: 'admin' }, async ctx => { await movieRequests.push.test(ctx.token); });
}

module.exports = { register };

const { readJson } = require('../http');

function register({ router, movieRequests }) {
  router.add('GET', '/api/movie-requests', { auth: 'viewer' }, ctx => movieRequests.list(ctx.user));
  router.add('POST', '/api/movie-requests', { auth: 'viewer' }, async ctx =>
    movieRequests.submit(ctx.user, await readJson(ctx.req, 4096)));
  router.add('DELETE', '/api/movie-requests/:id', ctx =>
    movieRequests.remove(ctx.user, Number(ctx.params.id)));
  router.add('GET', '/api/admin/movie-requests', { auth: 'admin' }, ctx => movieRequests.list(ctx.user));
  router.add('PATCH', '/api/admin/movie-requests/:id', { auth: 'admin' }, ctx =>
    movieRequests.handle(Number(ctx.params.id)));
  const devices = '/api/admin/movie-requests/device';
  router.add('PUT', devices, { auth: 'admin' }, async ctx =>
    movieRequests.push.register(ctx.token, (await readJson(ctx.req, 2048)).token));
  router.add('DELETE', devices, { auth: 'admin' }, ctx => { movieRequests.push.unregister(ctx.token); });
  router.add('POST', devices + '/test', { auth: 'admin' }, async ctx => { await movieRequests.push.test(ctx.token); });
}

module.exports = { register };

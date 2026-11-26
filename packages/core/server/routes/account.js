const config = require('../config');
const { HttpError, readJson, sessionCookie } = require('../http');
const { USERNAME, validateCredentials, createUsers, publicUser } = require('../users');
const { tx } = require('../db');

function register(app) {
  const { router, db, auth } = app;
  const count = db.prepare('SELECT COUNT(*) AS n FROM users');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const users = createUsers(db, auth);
  const startSession = (ctx, user) => {
    const token = auth.create(user.id);
    sessionCookie(ctx, token, config.sessionDays * 86400);
    return ctx.req.headers['x-matro-client'] === 'native' ? token : undefined;
  };
  app.createUser = users.create;

  // `setup` is true until the head account exists; it can only be created from the command line on the server.
  router.add('GET', '/api/status', { auth: 'none' }, ctx => ({ setup: count.get().n === 0, user: ctx.user || null }));

  router.add('POST', '/api/login', { auth: 'none' }, async ctx => {
    const body = await readJson(ctx.req), username = String(body.username || '');
    const name = `login|${USERNAME.test(username) ? username.toLowerCase() : ''}`;
    const user = await auth.attempt(`${name}|${ctx.ip}`, () => auth.check(body.username, body.password), name);
    if (!user) throw new HttpError(401, 'Wrong username or password.');
    const token = startSession(ctx, user);
    return { user: publicUser(user), ...(token ? { token } : {}) };
  });

  // Joining takes a one-time code from the head account: the invitee chooses their own username and password.
  router.add('POST', '/api/signup', { auth: 'none' }, async ctx => {
    const body = await readJson(ctx.req);
    const invite = await auth.attempt(`signup|${ctx.ip}`, () => {
      const found = app.invites.find(body.code);
      return found && !found.used_at && found.expires > Date.now() ? found : null;
    }, 'signup');
    if (!invite) throw new HttpError(400, 'That invite code is not valid, or it has already been used.');
    const { username, password } = validateCredentials(body.username, body.password);
    const hash = await auth.hashPassword(password);
    // The account and the code's use succeed or fail together, so one code can only ever make one account.
    const id = tx(db, () => {
      const created = users.insertHash(username, hash, 'viewer');
      if (!app.invites.claim(invite.id, created)) throw new HttpError(400, 'That invite code is not valid, or it has already been used.');
      return created;
    });
    const token = startSession(ctx, { id });
    return { user: publicUser(byId.get(id)), ...(token ? { token } : {}) };
  });

  router.add('POST', '/api/logout', { auth: 'none' }, ctx => {
    auth.destroy(ctx.token);
    sessionCookie(ctx, '', 0);
  });

  router.add('GET', '/api/me', ctx => ({ user: ctx.user }));
  // Upgrade an existing phone cookie to a native media session without asking
  // the person to sign in again. The normal authenticated POST/CSRF checks apply.
  router.add('POST', '/api/session/native', ctx => {
    if (ctx.req.headers['x-matro-client'] !== 'native') throw new HttpError(403, 'Use the native client for this session.');
    return { user: ctx.user, token: startSession(ctx, ctx.user) };
  });
  router.add('POST', '/api/me/password', async ctx => {
    const body = await readJson(ctx.req);
    const user = await auth.attempt(`password|${ctx.user.id}`, () => auth.check(ctx.user.username, body.current));
    if (!user || user.id !== ctx.user.id) throw new HttpError(403, 'Current password is wrong.');
    const { password } = validateCredentials(user.username, body.password);
    await users.setPassword(user.id, password);
    // Other devices sign out; this one gets a fresh session.
    startSession(ctx, user);
  });
}
module.exports = { register, USERNAME };

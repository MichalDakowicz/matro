const { HttpError, readJson } = require('../http');
const { USERNAME, validateCredentials, createUsers } = require('../users');
const { tx } = require('../db');

const publicUser = user => ({ id: user.id, username: user.username, role: user.role });

function register(app) {
  const { router, db, auth } = app;
  const count = db.prepare('SELECT COUNT(*) AS n FROM users');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const users = createUsers(db, auth);
  const startSession = (ctx, user) => {
    const token = auth.create(user.id), maxAge = 30 * 86400;
    ctx.res.setHeader('Set-Cookie', `matro_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${ctx.secure ? '; Secure' : ''}`);
  };
  app.createUser = users.create;

  // `setup` is true until the head account exists; it can only be created from the command line on the server.
  router.add('GET', '/api/status', { auth: 'none' }, ctx => ({ setup: count.get().n === 0, user: ctx.user ? publicUser(ctx.user) : null }));

  router.add('POST', '/api/login', { auth: 'none' }, async ctx => {
    const body = await readJson(ctx.req), key = `${ctx.ip}|${String(body.username || '').toLowerCase()}`;
    const wait = auth.throttle(key);
    if (wait) throw new HttpError(429, `Too many attempts. Try again in ${wait} seconds.`);
    const user = await auth.check(body.username, body.password);
    if (!user) { auth.fail(key); throw new HttpError(401, 'Wrong username or password.'); }
    auth.succeed(key);
    startSession(ctx, user);
    return { user: publicUser(user) };
  });

  // Joining takes a one-time code from the head account: the invitee chooses their own username and password.
  router.add('POST', '/api/signup', { auth: 'none' }, async ctx => {
    const body = await readJson(ctx.req), key = `signup|${ctx.ip}`;
    const wait = auth.throttle(key);
    if (wait) throw new HttpError(429, `Too many attempts. Try again in ${wait} seconds.`);
    const invite = app.invites.find(body.code);
    if (!invite || invite.used_at || invite.expires < Date.now()) { auth.fail(key); throw new HttpError(400, 'That invite code is not valid, or it has already been used.'); }
    const { username, password } = validateCredentials(body.username, body.password);
    const hash = await auth.hashPassword(password);
    // The account and the code's use succeed or fail together, so one code can only ever make one account.
    const id = tx(db, () => {
      const created = users.insertHash(username, hash, 'viewer');
      if (!app.invites.claim(invite.id, created)) throw new HttpError(400, 'That invite code is not valid, or it has already been used.');
      return created;
    });
    auth.succeed(key);
    startSession(ctx, { id });
    return { user: { id, username, role: 'viewer' } };
  });

  router.add('POST', '/api/logout', { auth: 'none' }, ctx => {
    auth.destroy(ctx.token);
    ctx.res.setHeader('Set-Cookie', 'matro_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  });

  router.add('GET', '/api/me', ctx => ({ user: publicUser(ctx.user) }));
  router.add('POST', '/api/me/password', async ctx => {
    const body = await readJson(ctx.req);
    const user = byId.get(ctx.user.id);
    if (!(await auth.check(user.username, body.current))) throw new HttpError(403, 'Current password is wrong.');
    const { password } = validateCredentials(user.username, body.password);
    await users.setPassword(user.id, password);
    // Other devices sign out; this one gets a fresh session.
    startSession(ctx, user);
  });
}
module.exports = { register, USERNAME };

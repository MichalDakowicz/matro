const { randomBytes } = require('node:crypto');
const { sessionHash } = require('../auth');
const { HttpError, readJson } = require('../http');

const DEVICE_TTL = 12_000;
const COMMAND_TTL = 20_000;
const START_COMMAND_TTL = 60_000;
const actions = new Set(['start', 'play', 'pause', 'seek']);
const validPosition = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const randomId = () => randomBytes(18).toString('base64url');

function register({ router, library }) {
  const devices = new Map();

  function remove(device) {
    devices.delete(device.id);
    device.pending?.finish('The receiving device disconnected.');
    for (const other of devices.values()) {
      if (other.pending?.sender === device) other.pending.finish('The sending device disconnected.');
    }
  }

  function prune() {
    for (const device of devices.values()) if (device.expires <= Date.now()) remove(device);
  }

  function ownDevice(ctx, { id, key }) {
    prune();
    const device = devices.get(id);
    if (!device || device.userId !== ctx.user.id || device.session !== sessionHash(ctx.token) || device.key !== key) {
      throw new HttpError(404, 'This device is no longer connected.');
    }
    return device;
  }

  router.add('POST', '/api/remote/join', async ctx => {
    const { name } = await readJson(ctx.req, 1024);
    if (typeof name !== 'string' || !name.trim() || name.length > 48 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new HttpError(400, 'Enter a device name between 1 and 48 characters.');
    }
    prune();
    if (devices.size >= 500 || [...devices.values()].filter(device => device.userId === ctx.user.id).length >= 16) {
      throw new HttpError(429, 'Too many devices are connected. Try again in a moment.');
    }
    const id = randomId(), key = randomId();
    devices.set(id, { id, key, name: name.trim(), userId: ctx.user.id, session: sessionHash(ctx.token), expires: Date.now() + DEVICE_TTL, playback: null });
    return { id, key };
  });

  router.add('POST', '/api/remote/sync', async ctx => {
    const body = await readJson(ctx.req, 2048), device = ownDevice(ctx, body);
    const state = body.playback;
    device.playback = state && typeof state.itemId === 'string' && library.item(state.itemId) && validPosition(state.position) && typeof state.playing === 'boolean'
      ? { itemId: state.itemId, position: state.position, playing: state.playing }
      : null;
    device.expires = Date.now() + DEVICE_TTL;
    const peers = [...devices.values()].filter(peer => peer !== device && peer.userId === device.userId);
    const pending = device.pending;
    const command = pending && !pending.delivered ? pending.command : null;
    if (command) pending.delivered = true;
    return { devices: peers.map(({ id, name, playback }) => ({ id, name, playback })), command };
  });

  router.add('POST', '/api/remote/leave', async ctx => remove(ownDevice(ctx, await readJson(ctx.req, 1024))));

  router.add('POST', '/api/remote/command', async ctx => {
    const body = await readJson(ctx.req, 2048), sender = ownDevice(ctx, body);
    const { target, action, itemId, position } = body;
    const needsPosition = action === 'start' || action === 'seek';
    if (!actions.has(action) || typeof itemId !== 'string' || (needsPosition && !validPosition(position))) {
      throw new HttpError(400, 'Invalid playback command.');
    }
    const receiver = devices.get(target);
    if (!receiver || receiver === sender || receiver.userId !== sender.userId) throw new HttpError(404, 'That device is no longer connected.');
    if (!library.item(itemId)) throw new HttpError(404, 'That title is no longer in the library.');
    if (action !== 'start' && receiver.playback?.itemId !== itemId) throw new HttpError(409, 'The receiving device changed titles.');
    if (receiver.pending) throw new HttpError(409, 'The receiving device is still handling a command.');
    if (ctx.res.destroyed) return;

    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        ctx.res.off('close', disconnected);
        receiver.pending = null;
        if (error) reject(new HttpError(409, error));
        else resolve({ ok: true });
      };
      const disconnected = () => finish('The sending device disconnected.');
      const timer = setTimeout(() => finish('The receiving device did not confirm the command.'), action === 'start' ? START_COMMAND_TTL : COMMAND_TTL);
      timer.unref();
      ctx.res.once('close', disconnected);
      const command = { id: randomId(), action, itemId, ...(needsPosition ? { position } : {}) };
      receiver.pending = { command, sender, delivered: false, finish };
    });
  });

  router.add('POST', '/api/remote/result', async ctx => {
    const body = await readJson(ctx.req, 1024), device = ownDevice(ctx, body);
    const pending = device.pending;
    if (!pending?.delivered || body.commandId !== pending.command.id || typeof body.ok !== 'boolean') throw new HttpError(409, 'That command expired.');
    pending.finish(body.ok ? undefined : 'The receiving device could not complete the command.');
    if (body.ok && pending.command.action === 'start') {
      const { itemId, position } = pending.command;
      device.playback = { itemId, position, playing: true };
    }
  });
}

module.exports = { register };

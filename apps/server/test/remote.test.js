const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createApp } = require('../../../packages/core/server');

let app, base, server, db, directory, web, native, stranger;
const itemId = 'film';

test.before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'matro-remote-'));
  ({ app, server, db } = createApp({ dataDir: directory, tmdb: { env: {} }, movieRequests: { env: {} } }));
  const account = await app.createUser('account', 'test-password', 'admin');
  const other = await app.createUser('other', 'test-password', 'viewer');
  web = { cookie: `matro_session=${app.auth.create(account)}` };
  native = { authorization: `Bearer ${app.auth.create(account)}` };
  stranger = { cookie: `matro_session=${app.auth.create(other)}` };
  db.prepare('INSERT INTO folders (id, path, added) VALUES (1, ?, 0)').run(directory);
  db.prepare("INSERT INTO items (id, folder_id, path, title, group_id, group_title, kind, size, mtime, added) VALUES (?, 1, ?, 'Film', ?, 'Film', 'movie', 1, 0, 0)")
    .run(itemId, path.join(directory, 'Film.mp4'), itemId);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function post(who, route, body, headers = {}) {
  const response = await fetch(base + '/api/remote/' + route, {
    method: 'POST', headers: { 'x-matro': '1', 'content-type': 'application/json', ...who, ...headers }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function join(who, name) {
  const { status, body } = await post(who, 'join', { name });
  assert.equal(status, 200);
  return body;
}
async function nextCommand(device, playback) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { body } = await post(native, 'sync', { ...device, playback });
    if (body.command) return body.command;
    await delay(10);
  }
  assert.fail('The receiving device did not get the command.');
}

test('only opted-in sessions on the same account are visible or can control a receiver', async () => {
  assert.equal((await post(null, 'join', { name: 'Signed out' })).status, 401);
  assert.equal((await post(web, 'join', { name: 'Wrong origin' }, { origin: 'https://example.test' })).status, 403);
  assert.equal((await post(web, 'join', { name: '' })).status, 400);
  const sender = await join(web, 'Browser'), receiver = await join(native, 'Android TV'), unrelated = await join(stranger, 'Other account');
  const { body } = await post(web, 'sync', sender);
  assert.deepEqual(body, { devices: [{ id: receiver.id, name: 'Android TV', playback: null }], command: null });
  assert.deepEqual((await post(stranger, 'sync', unrelated)).body.devices, []);
  assert.equal((await post(web, 'sync', receiver)).status, 404, 'the receiver key also needs its signed-in session');
  assert.equal((await post(stranger, 'command', { ...unrelated, target: receiver.id, action: 'start', itemId, position: 0 })).status, 404);
  assert.equal((await post(web, 'command', { ...sender, target: receiver.id, action: 'pause', itemId })).status, 409, 'no title is open');
  assert.equal((await post(web, 'command', { ...sender, target: receiver.id, action: 'seek', itemId, position: -1 })).status, 400);
  assert.equal((await post(web, 'command', { ...sender, target: receiver.id, action: 'start', itemId: 'missing', position: 0 })).status, 404);
  await Promise.all([post(web, 'leave', sender), post(native, 'leave', receiver), post(stranger, 'leave', unrelated)]);
});

test('start, pause, seek and play reach only the target and require its acknowledgement', async () => {
  const sender = await join(web, 'Browser'), receiver = await join(native, 'Android TV');
  const playback = { itemId, position: 125, playing: true };
  for (const [action, position] of [['start', 125], ['pause', undefined], ['seek', 180], ['play', undefined]]) {
    let settled = false;
    const sent = post(web, 'command', { ...sender, target: receiver.id, action, itemId, position }).then(result => { settled = true; return result; });
    const command = await nextCommand(receiver, playback);
    assert.equal(settled, false, 'handoff is pending until the client confirms it');
    assert.deepEqual(command, { id: command.id, action, itemId, ...(position === undefined ? {} : { position }) });
    assert.equal((await post(native, 'sync', { ...receiver, playback })).body.command, null, 'a second poll must not reapply it');
    assert.equal((await post(web, 'result', { ...sender, commandId: command.id, ok: true })).status, 409);
    assert.equal((await post(native, 'result', { ...receiver, commandId: command.id, ok: true })).status, 200);
    assert.deepEqual(await sent, { status: 200, body: { ok: true } });
  }
  const sent = post(web, 'command', { ...sender, target: receiver.id, action: 'pause', itemId });
  const command = await nextCommand(receiver, playback);
  await post(native, 'result', { ...receiver, commandId: command.id, ok: false });
  assert.equal((await sent).status, 409);
  await Promise.all([post(web, 'leave', sender), post(native, 'leave', receiver)]);
});

test('disconnecting or expiring a receiver removes it and rejects a pending handoff', async t => {
  const sender = await join(web, 'Browser'), receiver = await join(native, 'Android TV');
  const sent = post(web, 'command', { ...sender, target: receiver.id, action: 'start', itemId, position: 54 });
  await nextCommand(receiver, null);
  await post(native, 'leave', receiver);
  assert.equal((await sent).status, 409);
  assert.deepEqual((await post(web, 'sync', sender)).body.devices, []);

  t.mock.timers.enable({ apis: ['Date'] });
  const stale = await join(native, 'Sleeping TV');
  t.mock.timers.tick(12_001);
  assert.equal((await post(native, 'sync', stale)).status, 404);
});

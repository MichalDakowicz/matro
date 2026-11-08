const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { origin, loadSource, saveSource, findServer, relaunchArgs } = require('../packages/core/desktop/desktop-source.cjs');

test('server choices validate origins, remember local mode and preserve the saved address', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-source-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  assert.deepEqual(loadSource(dir), { url: '', enabled: false });
  await saveSource(dir, { url: 'http://192.168.100.6:8484/', enabled: true });
  assert.deepEqual(loadSource(dir), { url: 'http://192.168.100.6:8484', enabled: true });
  await saveSource(dir, { url: loadSource(dir).url, enabled: false });
  assert.deepEqual(loadSource(dir), { url: 'http://192.168.100.6:8484', enabled: false });
  for (const value of ['file:///a', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?x=1', 'https://example.com/#x']) assert.throws(() => origin(value));
  await fs.writeFile(path.join(dir, 'server.json'), '{broken');
  assert.deepEqual(loadSource(dir), { url: '', enabled: false });
});

test('server detection accepts LAN addresses and verifies the Matro status response', async () => {
  const calls = [];
  const request = async (url, options) => { calls.push([url, options.redirect]); return { ok: true, json: async () => ({ setup: false }) }; };
  assert.equal(await findServer('192.168.100.6:8484', request), 'http://192.168.100.6:8484');
  assert.equal(await findServer('matro.example.com', request), 'https://matro.example.com');
  assert.deepEqual(calls[0], ['http://192.168.100.6:8484/api/status', 'error']);
  await assert.rejects(findServer('http://localhost', async () => ({ ok: true, json: async () => ({ unrelated: true }) })), /Could not reach/);
  await assert.rejects(findServer(''), /Enter your/);
  assert.deepEqual(relaunchArgs(['electron', 'repo', '--server', 'http://localhost', '--local', '--user-data-dir=profile']), ['repo', '--user-data-dir=profile']);
});

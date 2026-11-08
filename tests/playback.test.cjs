const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createPlaybackCache } = require('../packages/core/playback/cache.cjs');
const { argumentsFor, SOFTWARE } = require('../packages/core/playback/encoding.cjs');
const { fixtures } = require('./fixtures.cjs');
const { ffmpeg, probe } = require('../packages/core/desktop/media.cjs');
async function until(fn) { for (let i = 0; i < 500; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } throw Error('Timed out waiting for preparation'); }

test('compatible H.264 is remuxed; precise seeks and bitmap subtitles require encoding with bounded CPU threads', () => {
  const options = { input: 'movie.mkv', info: { video: { codec: 'h264', pixelFormat: 'yuv420p' } } };
  assert.ok(argumentsFor(options).includes('copy'));
  assert.ok(argumentsFor({ ...options, offset: 20 }).includes('libx264'));
  assert.ok(argumentsFor({ ...options, burn: 2 }).includes('-filter_complex'));
  assert.equal(argumentsFor({ ...options, offset: 20 }).filter(x => x === '-threads').length, 2);
  const accelerated = argumentsFor({ ...options, offset: 20 }, ['-c:v', 'h264_nvenc']);
  assert.ok(accelerated.indexOf('-hwaccel') < accelerated.indexOf('-i'));
  assert.equal(accelerated[accelerated.indexOf('-hwaccel') + 1], 'auto');
  assert.equal(argumentsFor({ ...options, burn: 2 }, ['-c:v', 'h264_nvenc']).includes('-hwaccel'), false);
});

test('preparation completes without a viewer, is shared, survives restart and serves valid byte ranges', async t => {
  const f = await fixtures(), info = await probe(f.mkv);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-cache-test-'));
  let cache = createPlaybackCache({ ffmpeg, dir });
  let server;
  t.after(async () => { cache.close(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } await fs.rm(dir, { recursive: true, force: true }); });
  const options = { file: f.mkv, input: f.mkv, info, offset: 0, audio: null, burn: null, delay: 0 };
  const [a, b] = await Promise.all([cache.get(options), cache.get(options)]);
  assert.equal(a, b);
  await until(() => a.done || a.error); assert.ifError(a.error);
  const output = await probe(a.file); assert.equal(output.video.codec, 'h264'); assert.ok(output.duration > 9);
  cache.close(); cache = createPlaybackCache({ ffmpeg: 'must-not-launch', dir });
  const kept = await cache.get(options); assert.equal(kept.done, true); assert.equal(kept.size, a.size);
  server = http.createServer((req, res) => void cache.serve(req, res, options));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(url, { headers: { range: 'bytes=0-31' } });
  assert.equal(res.status, 206); assert.equal((await res.arrayBuffer()).byteLength, 32);
  assert.equal(res.headers.get('content-range'), `bytes 0-31/${kept.size}`);
  const bad = await fetch(url, { headers: { range: 'bytes=999999999-' } }); assert.equal(bad.status, 416);
});

test('hung encoders are killed and capacity errors are retryable instead of unbounded processes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-cache-hang-'));
  let killed = 0;
  const cache = createPlaybackCache({ ffmpeg: 'fake', dir, maxJobs: 1, stallMs: 10, stat: async () => ({ size: 100, mtimeMs: 1 }), spawnProcess: () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { killed++; child.stdout.end(); child.emit('close', 1); }; return child;
  } });
  t.after(async () => { cache.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const options = { file: 'test', input: 'test', info: { video: { codec: 'h264' } }, offset: 0, burn: null };
  const entry = await cache.get(options);
  await assert.rejects(cache.get({ ...options, file: 'other' }), error => error.status === 503);
  await until(() => entry.error); assert.match(entry.error.message, /stopped responding/); assert.ok(killed);
});

test('a growing preparation holds its response until eight seconds are ready, then streams before completion', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-cache-buffer-'));
  let child;
  const cache = createPlaybackCache({ ffmpeg: 'fake', dir, stat: async () => ({ size: 100, mtimeMs: 1 }), spawnProcess: () => {
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.stdout.end(); child.emit('close', 1); }; return child;
  } });
  const options = { file: 'buffer', input: 'buffer', info: { video: null }, offset: 0, burn: null };
  const server = http.createServer((req, res) => void cache.serve(req, res, options));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); cache.close(); await new Promise(r => setTimeout(r, 50)); await fs.rm(dir, { recursive: true, force: true }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let received = false;
  const response = fetch(`http://127.0.0.1:${server.address().port}`).then(res => { received = true; return res; });
  await until(() => child);
  child.stdout.write(Buffer.from('first fragment'));
  child.stderr.write('out_time_us=1000000\n');
  await new Promise(r => setTimeout(r, 250));
  assert.equal(received, false, 'the first fragment must not drain immediately');
  child.stderr.write('out_time_us=800'); child.stderr.write('0000\n');
  const res = await response;
  assert.equal(res.status, 200);
  assert.equal((await cache.get(options)).done, false, 'startup does not wait for the whole movie');
  child.stdout.end(Buffer.from('last fragment')); child.emit('close', 0);
  assert.equal(await res.text(), 'first fragmentlast fragment');
});

test('seeking replaces the same viewer’s preparation without exhausting capacity or killing another viewer’s shared job', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-cache-seek-'));
  let killed = 0;
  const cache = createPlaybackCache({ ffmpeg: 'fake', dir, maxJobs: 1, stat: async () => ({ size: 100, mtimeMs: 1 }), spawnProcess: () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { killed++; child.stdout.end(); child.emit('close', 1); }; return child;
  } });
  t.after(async () => { cache.close(); await new Promise(r => setTimeout(r, 50)); await fs.rm(dir, { recursive: true, force: true }); });
  const options = { file: 'test', input: 'test', info: { video: null }, offset: 0, burn: null };
  const first = await cache.get(options, 'viewer-1');
  await until(() => first.child);
  assert.equal(await cache.get(options, 'viewer-2'), first);
  await assert.rejects(cache.get({ ...options, offset: 10 }, 'viewer-1'), error => error.status === 503);
  assert.equal(killed, 0, 'the second viewer still owns the shared preparation');
  cache.promote('viewer-2', 'viewer-1');
  assert.equal(killed, 0, 'promoting a preloaded stream keeps its encoder running');
  assert.equal(await cache.get(options, 'viewer-1'), first);
  cache.promote('viewer-1', 'viewer-2');
  const next = await cache.get({ ...options, offset: 20 }, 'viewer-2');
  assert.notEqual(first, next); assert.ok(first.error); assert.equal(killed, 1);
  for (let offset = 30; offset < 60; offset += 10) {
    const entry = await cache.get({ ...options, offset }, 'viewer-2');
    await until(() => entry.child);
    assert.equal(entry.error, null);
  }
});

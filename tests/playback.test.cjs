const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const { PassThrough } = require('node:stream');
const { createPlaybackCache } = require('../packages/core/playback/cache.cjs');
const { copiesVideo, describePlayback } = require('../packages/core/client/playback-info.js');
const { argumentsFor, SOFTWARE } = require('../packages/core/playback/encoding.cjs');
const { fixtures } = require('./fixtures.cjs');
const { ffmpeg, probe, run } = require('../packages/core/desktop/media.cjs');
const ffprobe = require('ffprobe-static').path;
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

test('diagnostics and the encoder agree on a quality tier at offset zero', () => {
  const info = { video: { codec: 'h264', pixelFormat: 'yuv420p' }, audio: [{ index: 1, channels: 6 }] };
  assert.equal(copiesVideo(info), true);
  assert.equal(copiesVideo(info, null, 0, '720p'), false);
  assert.equal(argumentsFor({ input: 'movie.mkv', info, quality: '720p' }).includes('copy'), false);
  const tier = describePlayback(info, { quality: '720p', offset: 0, channels: 6, audioDelay: -0.4 });
  assert.equal(tier.mode, 'Transcode');
  assert.match(tier.reason, /720p quality tier/);
  assert.match(tier.reason, /5\.1 AAC/);
  assert.match(tier.reason, /0\.4 s earlier/);
  const hdr = { ...info, video: { ...info.video, hdr: { transfer: 'smpte2084' } } };
  assert.equal(copiesVideo(hdr), false);
  assert.match(describePlayback(hdr, { direct: true }).reason, /plays in HDR.*5\.1 audio/);
  assert.match(describePlayback(hdr).reason, /tone-mapped to SDR.*downmixed to stereo AAC/);
  assert.match(describePlayback(hdr, { toneMap: false }).reason, /tone-mapping is unavailable/);
});

test('audio delay becomes an audio filter and does not touch the subtitle delay or direct copy', () => {
  const options = { input: 'movie.mkv', info: { video: { codec: 'h264', pixelFormat: 'yuv420p' } } };
  assert.equal(argumentsFor(options).includes('-af'), false);
  const later = argumentsFor({ ...options, audioDelay: .35 }), earlier = argumentsFor({ ...options, audioDelay: -1.5 });
  assert.equal(later[later.indexOf('-af') + 1], 'adelay=350:all=1');
  assert.equal(earlier[earlier.indexOf('-af') + 1], 'atrim=start=1.5,asetpts=PTS-STARTPTS');
  assert.ok(later.includes('copy'), 'video is still copied');
  assert.ok(later.indexOf('-af') > later.indexOf('-map'));
});

test('audio delay moves the sound against the picture and is part of the cache key', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-adelay-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'late-tone.mkv');
  // Silence for the first second, then a tone.
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-af', "volume=0:enable='lt(t,1)'", '-c:v', 'libx264', '-c:a', 'pcm_s16le', '-t', '3', input]);
  const info = await probe(input);
  const loud = async (file, from) => {
    const text = await new Promise(resolve => execFile(ffmpeg, ['-v', 'info', '-ss', String(from), '-t', '0.3', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], (_error, _out, stderr) => resolve(stderr)));
    return Number(/max_volume: (-?[\d.]+|-inf) dB/.exec(text)?.[1] ?? -91) > -40;
  };
  const cache = createPlaybackCache({ ffmpeg, dir: path.join(dir, 'cache') });
  t.after(() => cache.close());
  const render = async audioDelay => {
    const entry = await cache.get({ file: input, input, info, offset: 0, audio: null, burn: null, delay: 0, audioDelay });
    await until(() => entry.done || entry.error); assert.ifError(entry.error); return entry;
  };
  const [plain, later, earlier] = [await render(0), await render(.5), await render(-.5)];
  assert.notEqual(plain.file, later.file); assert.notEqual(later.file, earlier.file);
  assert.equal(await loud(plain.file, 1.1), true, 'unshifted tone is audible from 1.1 s');
  assert.equal(await loud(later.file, 1.1), false, 'a later sound is still silent at 1.1 s');
  assert.equal(await loud(later.file, 1.6), true);
  assert.equal(await loud(earlier.file, .6), true, 'an earlier sound is audible at 0.6 s');
  assert.equal(await loud(plain.file, .6), false);
});

test('fragmented playback preserves continuous AAC timestamps and the video timeline with B-frames', async t => {
  const encoder = process.env.MATRO_VIDEO_ENCODER;
  process.env.MATRO_VIDEO_ENCODER = 'software';
  t.after(() => { if (encoder === undefined) delete process.env.MATRO_VIDEO_ENCODER; else process.env.MATRO_VIDEO_ENCODER = encoder; });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-sync-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'reordered.mkv');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-c:v', 'libx264', '-preset', 'medium', '-bf', '3', '-c:a', 'pcm_s16le', '-t', '5', input]);
  const info = await probe(input);
  // Offset zero exercises stream copy; resuming exercises the software encoder.
  for (const offset of [0, 1.5]) {
    const cache = createPlaybackCache({ ffmpeg, dir: path.join(dir, String(offset)) });
    t.after(() => cache.close());
    const entry = await cache.get({ file: input, input, info, offset, audio: null, burn: null, delay: 0 });
    await until(() => entry.done || entry.error); assert.ifError(entry.error);
    const output = JSON.parse(await run(ffprobe, ['-v', 'error', '-show_packets', '-show_streams', '-of', 'json', entry.file]));
    const audio = output.streams.find(s => s.codec_type === 'audio'), video = output.streams.find(s => s.codec_type === 'video');
    const packets = output.packets.filter(p => p.stream_index === audio.index);
    assert.ok(packets.length > 100);
    const step = 1024 / Number(audio.sample_rate);
    for (let i = 1; i < packets.length; i++) {
      const gap = Number(packets[i].pts_time) - Number(packets[i - 1].pts_time);
      assert.ok(Math.abs(gap - step) < .002, `offset ${offset}: audio gap ${gap} at packet ${i} instead of ${step}`);
    }
    const start = Number(output.packets.find(p => p.stream_index === video.index).pts_time);
    assert.ok(Math.abs(start) < 1 / 24, `offset ${offset}: video starts ${start}s away from its requested timeline`);
  }
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
  const server = http.createServer((req, res) => void cache.serve(req, res, options, {}, 'player'));
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
  cache.release('player');
  child.stdout.end(Buffer.from('last fragment')); child.emit('close', 0);
  assert.equal(await res.text(), 'first fragmentlast fragment');
});

test('pruning honors offline pins and keeps recently accessed preparations ahead of cold files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-cache-prune-'));
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const cache = createPlaybackCache({
    ffmpeg: 'fake', dir, maxBytes: 12, stat: async () => ({ size: 100, mtimeMs: 1 }),
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => {};
      setImmediate(() => { child.stdout.end(Buffer.from('data')); child.emit('close', 0); });
      return child;
    }
  });
  t.after(async () => { cache.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const options = file => ({ file, input: file, info: { video: null }, offset: 0 });
  const prepare = async (file, pinMs) => {
    const entry = await cache.get(options(file), null, { pinMs });
    await entry.finished;
    assert.equal(entry.done, true);
    now += 180000;
    return entry;
  };
  const offline = await prepare('offline', 600000);
  const used = await prepare('used');
  const cold = await prepare('cold');
  assert.equal(await cache.get(options('used')), used);
  await prepare('new');
  await fs.access(offline.file);
  await fs.access(used.file);
  await assert.rejects(fs.access(cold.file), { code: 'ENOENT' });
  await prepare('after expiry');
  await assert.rejects(fs.access(offline.file), { code: 'ENOENT' });
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

test('a quality tier scales the picture down, caps the bitrate and is part of the cache key', async t => {
  const options = { input: 'movie.mkv', info: { video: { codec: 'h264', pixelFormat: 'yuv420p' } } };
  assert.ok(argumentsFor(options).includes('copy'));
  const tier = argumentsFor({ ...options, quality: '480p' });
  assert.equal(tier.includes('copy'), false);
  assert.equal(tier[tier.indexOf('-vf') + 1], "scale=w='min(iw,854)':h='min(ih,480)':force_original_aspect_ratio=decrease:force_divisible_by=2");
  assert.equal(tier[tier.indexOf('-maxrate') + 1], '1500k');
  for (const name of ['h264_nvenc', 'h264_qsv', 'h264_vaapi']) {
    const hw = argumentsFor({ ...options, quality: '480p' }, ['-c:v', name, '-global_quality', '21']);
    assert.equal(hw[hw.indexOf('-c:v') + 1], name);
    assert.equal(hw.includes('-global_quality'), false);
    assert.equal(hw[hw.indexOf('-b:v') + 1], '1125k');
    assert.equal(hw[hw.indexOf('-maxrate') + 1], '1500k');
    assert.equal(hw[hw.indexOf('-bufsize') + 1], '3000k');
  }
  assert.equal(argumentsFor({ ...options, quality: 'bogus' }).includes('copy'), true);
  const bitmap = argumentsFor({ ...options, quality: '720p', burn: 3 });
  assert.match(bitmap[bitmap.indexOf('-filter_complex') + 1], /scale=w='min\(iw,1280\)':h='min\(ih,720\)':force_original_aspect_ratio=decrease:force_divisible_by=2\[video\]$/);

  const encoder = process.env.MATRO_VIDEO_ENCODER; process.env.MATRO_VIDEO_ENCODER = 'software';
  t.after(() => { if (encoder === undefined) delete process.env.MATRO_VIDEO_ENCODER; else process.env.MATRO_VIDEO_ENCODER = encoder; });
  const f = await fixtures(), info = await probe(f.mkv), dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-quality-'));
  const cache = createPlaybackCache({ ffmpeg, dir });
  t.after(async () => { cache.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const base = { file: f.mkv, input: f.mkv, info, offset: 0, audio: null, burn: null, delay: 0 };
  const [original, small] = [await cache.get(base), await cache.get({ ...base, quality: '480p' })];
  assert.notEqual(original, small);
  assert.equal(await cache.get({ ...base, quality: 'original' }), original);
  await until(() => small.done || small.error); assert.ifError(small.error);
  await until(() => original.done || original.error); assert.ifError(original.error);
  assert.equal((await probe(small.file)).video.height, Math.min(info.video.height, 480));
  assert.equal((await probe(original.file)).video.height, info.video.height);
});

const { canDirectPlay } = require('../packages/core/playback/direct.cjs');
const { outputChannels, supportsToneMap } = require('../packages/core/playback/encoding.cjs');
const { hdrColor } = require('../packages/core/playback/color.cjs');

test('HDR files direct play only for a client that shows HDR, and only in a container browsers read', () => {
  const hdr = { transfer: 'smpte2084', primaries: 'bt2020', matrix: 'bt2020nc', codecTag: 'hvc1', level: 153 };
  const info = { video: { codec: 'hevc', width: 3840, height: 2160, pixelFormat: 'yuv420p10le', hdr }, audio: [{ index: 1, codec: 'aac', channels: 6 }] };
  assert.equal(canDirectPlay('film.mp4', info), false);
  assert.equal(canDirectPlay('film.mp4', info, { hdr: true }), true);
  assert.equal(canDirectPlay('film.mkv', info, { hdr: true }), false);
  assert.equal(canDirectPlay('film.mp4', { ...info, video: { ...info.video, hdr: { ...hdr, codecTag: 'hev1' } } }, { hdr: true }), false);
  assert.equal(canDirectPlay('film.mp4', { ...info, audio: [{ index: 1, codec: 'eac3', channels: 6 }] }, { hdr: true }), false);
  assert.equal(hdrColor({ color_transfer: 'bt709' }), null);
  assert.equal(hdrColor({ color_transfer: 'arib-std-b67', color_primaries: 'bt2020' }).transfer, 'arib-std-b67');
});

test('5.1 is kept only when the source has it and the client asked for it; HDR is tone-mapped to SDR', () => {
  const source = { video: { codec: 'hevc', pixelFormat: 'yuv420p10le', hdr: { transfer: 'smpte2084', primaries: 'bt2020', matrix: 'bt2020nc' } }, audio: [{ index: 1, channels: 6 }, { index: 2, channels: 2 }] };
  const flag = (args, name) => args[args.indexOf(name) + 1];
  assert.equal(outputChannels(source, null, 6), 6);
  assert.equal(outputChannels(source, null, 2), 2);
  assert.equal(outputChannels(source, 2, 6), 2);
  assert.equal(outputChannels({ audio: [{ index: 1, channels: 2 }] }, null, 6), 2);
  const surround = argumentsFor({ input: 'a.mkv', info: source, channels: 6 }), stereo = argumentsFor({ input: 'a.mkv', info: source });
  assert.equal(flag(surround, '-ac'), '6'); assert.equal(flag(surround, '-b:a'), '384k');
  assert.equal(flag(stereo, '-ac'), '2'); assert.equal(flag(stereo, '-b:a'), '192k');
  assert.match(flag(surround, '-vf'), /tonemap=tonemap=hable.*format=yuv420p/);
  assert.equal(flag(surround, '-colorspace'), 'bt709');
  assert.equal(surround.includes('copy'), false);
  assert.match(flag(surround, '-vf'), /^scale=.*min\(iw,1920\).*min\(ih,1080\).*zscale=t=linear/);
  const hardware = argumentsFor({ input: 'a.mkv', info: source, channels: 6, quality: '720p' }, ['-c:v', 'h264_nvenc']);
  assert.equal(flag(hardware, '-c:v'), 'h264_nvenc');
  assert.equal(flag(hardware, '-b:a'), '320k');
  assert.match(flag(hardware, '-vf'), /^scale=.*min\(iw,1280\).*min\(ih,720\).*tonemap=.*?,scale=.*min\(iw,1280\)/);
  const fallback = argumentsFor({ input: 'a.mkv', info: source, toneMap: false });
  assert.equal(fallback.includes('-colorspace'), false);
  assert.doesNotMatch(flag(fallback, '-vf'), /zscale|tonemap/);
  assert.equal(argumentsFor({ input: 'a.mkv', info: source, burn: 3 }, ['-c:v', 'h264_nvenc']).includes('-hwaccel'), false);
  assert.match(flag(argumentsFor({ input: 'a.mkv', info: source, burn: 3 }), '-filter_complex'), /\[0:v:0\]scale=.*zscale.*\[sdr\];\[sub\]\[sdr\]scale2ref=.*\[picture\]\[scaledSub\]overlay/);
});

test('an HDR 5.1 file plays as tone-mapped SDR with 5.1 AAC for a surround client and stereo for the rest', async t => {
  if (!await supportsToneMap(ffmpeg)) return t.skip('FFmpeg has no zscale or tonemap filter');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-hdr-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'hdr.mkv');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-af', 'pan=5.1|FL=c0|FR=c0|FC=c0|LFE=c0|BL=c0|BR=c0',
    '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-c:a', 'ac3', input]);
  const info = await probe(input);
  assert.equal(info.video.hdr.transfer, 'smpte2084'); assert.equal(info.audio[0].channels, 6);
  for (const [channels, expected] of [[6, 6], [2, 2]]) {
    const cache = createPlaybackCache({ ffmpeg, dir: path.join(dir, `c${channels}`) });
    t.after(() => cache.close());
    const entry = await cache.get({ file: input, input, info, offset: 0, audio: null, burn: null, delay: 0, channels });
    await until(() => entry.done || entry.error); assert.ifError(entry.error);
    const streams = JSON.parse(await run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', entry.file])).streams;
    const video = streams.find(s => s.codec_type === 'video'), audio = streams.find(s => s.codec_type === 'audio');
    assert.equal(video.codec_name, 'h264'); assert.equal(video.pix_fmt, 'yuv420p'); assert.equal(video.color_transfer, 'bt709');
    assert.equal(audio.channels, expected);
  }
});

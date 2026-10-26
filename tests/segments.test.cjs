const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashFrame, distance, detectSegments, createSegments } = require('../electron/segments.cjs');
const { fixtures } = require('./fixtures.cjs');
const path = require('node:path');
function noise(seed, count) {
  let state = BigInt(seed);
  return Array.from({ length: count }, () => {
    state = BigInt.asUintN(64, state ^ (state << 13n));
    state = BigInt.asUintN(64, state ^ (state >> 7n));
    state = BigInt.asUintN(64, state ^ (state << 17n));
    return state.toString(16);
  });
}
test('fuzzy season comparison finds shifted intro, outro and recap copied from story', () => {
  const target = { duration: 400, hashes: noise(123456, 200) };
  const ref = { duration: 400, hashes: noise(98765, 200) };
  const copy = (from, to, length) => { for (let i = 0; i < length; i++) target.hashes[to + i] = (BigInt('0x' + ref.hashes[from + i]) ^ 7n).toString(16); };
  copy(90, 1, 7); copy(20, 15, 20); copy(180, 175, 15);
  // One edited frame should not break an otherwise repeating intro.
  target.hashes[24] = noise(5555, 1)[0];
  const result = detectSegments(target, [ref]);
  assert.ok(result.some(s => s.type === 'recap' && s.start === 2 && s.end === 16));
  assert.ok(result.some(s => s.type === 'intro' && s.start === 30 && s.end === 70));
  assert.ok(result.some(s => s.type === 'outro' && s.start === 350 && s.end === 380));
  assert.deepEqual(detectSegments(target, []), []);
});
test('static frames and unrelated footage do not produce skip suggestions', () => {
  assert.equal(hashFrame(Buffer.alloc(72, 40)), null);
  assert.equal(distance(null, null), 64);
  const a = { duration: 400, hashes: Array(200).fill('abcdef') };
  assert.deepEqual(detectSegments(a, [a]), []);
  assert.deepEqual(detectSegments({ duration: 400, hashes: noise(999999, 200) }, [{ duration: 400, hashes: noise(888888, 200) }]), []);
});
test('real media fingerprint extraction caches samples and closes cleanly', async () => {
  const f = await fixtures();
  const detector = createSegments(path.join(f.dir, 'fingerprint-test'));
  try {
    assert.deepEqual(await detector.detect({ path: f.mkv }, []), []);
    assert.deepEqual(await detector.detect({ path: f.mkv }, []), []);
  } finally { detector.close(); }
});

test('real encoded episodes publish fuzzy intro/outro matches before season scan completes', async () => {
  const fs = require('node:fs/promises');
  const { run, ffmpeg } = require('../electron/media.cjs');
  const folder = path.resolve('.test-media', 'segment-encoded'); await fs.mkdir(folder, { recursive: true });
  const make = async (file, lead, middle, tail, brightness) => {
    await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=160x90:r=10:d=${lead}`, '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=10:d=18', '-f', 'lavfi', '-i', `color=c=blue:s=160x90:r=10:d=${middle}`, '-f', 'lavfi', '-i', 'testsrc=s=160x90:r=10:d=18', '-f', 'lavfi', '-i', `color=c=black:s=160x90:r=10:d=${tail}`, '-filter_complex', `[1:v]eq=brightness=${brightness}[intro];[0:v][intro][2:v][3:v][4:v]concat=n=5:v=1:a=0,format=yuv420p[out]`, '-map', '[out]', '-c:v', 'libx264', '-preset', 'ultrafast', file]);
  };
  const first = path.join(folder, 'one.mp4'), second = path.join(folder, 'two.mp4');
  await make(first, 6.4, 45.6, 2, 0); await make(second, 10, 43, 1, .025);
  const detector = createSegments(path.join(folder, 'cache')), updates = [];
  try {
    const markers = await detector.detect({ path: first, episode: 1 }, [{ path: second, episode: 2 }, { path: path.join(folder, 'missing.mp4'), episode: 3 }], u => updates.push(u));
    assert.ok(markers.some(s => s.type === 'intro' && s.start <= 12 && s.end >= 20), JSON.stringify(markers));
    assert.ok(markers.some(s => s.type === 'outro' && s.start <= 76 && s.end >= 84), JSON.stringify(markers));
    assert.ok(updates.some(u => u.stage === 'matches' && u.completed === 1 && u.markers.length >= 2));
    assert.ok(updates.some(u => u.stage === 'unavailable'));
  } finally { detector.close(); }
});

test('interrupted decoding reuses finished chunks instead of starting over', async () => {
  const fs = require('node:fs/promises');
  const { run, ffmpeg } = require('../electron/media.cjs');
  const dir = await fs.mkdtemp(path.resolve('.test-media', 'chunks-')), file = path.join(dir, 'episode.mp4');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=5:d=90', '-c:v', 'libx264', '-preset', 'ultrafast', file]);
  const cache = path.join(dir, 'cache'), engine = createSegments(cache), controller = new AbortController();
  try {
    await assert.rejects(engine.detect({ path: file }, [], update => { if (update.stage === 'decoding' && update.percent < 100) controller.abort(); }, { signal: controller.signal }), { name: 'AbortError' });
    const chunkDir = path.join(cache, (await fs.readdir(cache)).find(name => name.endsWith('.chunks')));
    const first = path.join(chunkDir, '0.json'), before = (await fs.stat(first)).mtimeMs;
    await engine.detect({ path: file }, []);
    assert.equal((await fs.stat(first)).mtimeMs, before);
    assert.equal((await fs.readdir(chunkDir)).length, 2);
  } finally { engine.close(); }
});

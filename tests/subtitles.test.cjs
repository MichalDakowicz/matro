const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createEmbeddedSubtitles } = require('../electron/embedded-subtitles.cjs');
const { run, probe, ffmpeg } = require('../electron/media.cjs');
const vtt = 'WEBVTT\n\n00:00.100 --> 00:02.000\nZażółć gęślą jaźń\n';
const info = { subtitles: [{ index: 2, text: true }, { index: 3, text: false, bitmap: true }] };
async function cacheFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-subs-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, stat: async () => ({ isFile: () => true, size: 1024, mtimeMs: 1 }), probe: async () => info, remote: { isRemote: () => false }, extractLocal: async () => vtt };
}
test('embedded subtitle requests coalesce and reuse a disk cache across restarts', async t => {
  const options = await cacheFixture(t); let extractions = 0;
  options.extractLocal = async () => { extractions++; await new Promise(resolve => setTimeout(resolve, 20)); return vtt; };
  const cache = createEmbeddedSubtitles(options);
  const values = await Promise.all([cache.load('movie.mkv', 2), cache.load('movie.mkv', 2)]);
  assert.deepEqual(values, [vtt, vtt]); assert.equal(extractions, 1);
  assert.equal(await createEmbeddedSubtitles(options).load('movie.mkv', 2), vtt); assert.equal(extractions, 1);
  options.stat = async () => ({ isFile: () => true, size: 1025, mtimeMs: 2 });
  await createEmbeddedSubtitles(options).load('movie.mkv', 2); assert.equal(extractions, 2);
});
test('SSH subtitles use server extraction, preserve unicode, and do not use local FFmpeg', async t => {
  const options = await cacheFixture(t); let called = false;
  options.remote = { isRemote: () => true, extractSubtitles: async (file, index) => { assert.equal(file, 'remote.mkv'); assert.equal(index, 2); called = true; return vtt; } };
  options.extractLocal = async () => { throw new Error('must not read the movie across HTTP'); };
  assert.equal(await createEmbeddedSubtitles(options).load('remote.mkv', 2), vtt); assert.equal(called, true);
});
test('failed extraction is retryable, bitmap/invalid tracks are rejected, and cache failure preserves playback', async t => {
  const options = await cacheFixture(t); let attempts = 0;
  options.extractLocal = async () => { if (++attempts === 1) throw new Error('Server offline'); return vtt; };
  const cache = createEmbeddedSubtitles(options);
  await assert.rejects(cache.load('movie.mkv', 2), /Server offline/);
  assert.equal(await cache.load('movie.mkv', 2), vtt);
  await assert.rejects(cache.load('movie.mkv', -1), /Invalid subtitle/);
  await assert.rejects(cache.load('movie.mkv', 2.5), /Invalid subtitle/);
  await assert.rejects(cache.load('movie.mkv', 3), /Bitmap/);
  const blocked = path.join(options.dir, 'not-a-folder'); await fs.writeFile(blocked, 'file');
  assert.equal(await createEmbeddedSubtitles({ ...options, dir: blocked }).load('movie.mkv', 2), vtt);
  await assert.rejects(createEmbeddedSubtitles({ ...options, extractLocal: async () => 'not vtt' }).load('another.mkv', 2), /valid WebVTT/);
});
test('real embedded SRT and ASS tracks convert independently to complete WebVTT', async t => {
  const options = await cacheFixture(t), subtitle = path.join(options.dir, 'text.srt'), ass = path.join(options.dir, 'text.ass'), movie = path.join(options.dir, 'movie.mkv');
  await fs.writeFile(subtitle, '1\n00:00:00,100 --> 00:00:02,000\nEmbedded SRT — zażółć\n\n2\n00:00:05,000 --> 00:00:11,000\nLate cue after seeking\n');
  await fs.writeFile(ass, '[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.20,0:00:03.00,Default,,0,0,0,,Embedded ASS line\n');
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=320x180:rate=12', '-i', subtitle, '-i', ass, '-map', '0:v', '-map', '1:s', '-map', '2:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:s:0', 'srt', '-c:s:1', 'ass', '-t', '12', '-y', movie]);
  const tracks = (await probe(movie)).subtitles;
  const cache = createEmbeddedSubtitles({ ...options, stat: fs.stat, probe, extractLocal: (file, index) => run(ffmpeg, ['-v', 'error', '-nostdin', '-i', file, '-map', '0:' + index, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1'], { timeout: 180000 }) });
  const srtVtt = await cache.load(movie, tracks[0].index), assVtt = await cache.load(movie, tracks[1].index);
  assert.match(srtVtt, /Embedded SRT — zażółć/); assert.match(srtVtt, /00:05.000 --> 00:11.000/);
  assert.match(assVtt, /Embedded ASS line/); assert.doesNotMatch(assVtt, /Embedded SRT/);
});

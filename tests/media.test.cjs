const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixtures, bitmapFixture } = require('./fixtures.cjs');
const { describe, scan, groupFolders, applyPreludes, sidecars, keepSidecar, SIDECAR, probe, ffmpeg, run } = require('../electron/media.cjs');
const { createStreamServer } = require('../electron/stream.cjs');
const { createPreviews } = require('../electron/previews.cjs');
const os = require('node:os');

test('loaded subtitle files are copied next to the video without overwriting and listed as sidecar tracks', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-sidecar-'));
  const video = path.join(temp, 'show', 'Northbound.S01E01.mkv'), other = path.join(temp, 'show', 'Northbound.S01E02.mkv');
  const download = path.join(temp, 'downloads', 'random subs.en.srt');
  await fs.mkdir(path.dirname(video), { recursive: true }); await fs.mkdir(path.dirname(download), { recursive: true });
  await fs.writeFile(video, ''); await fs.writeFile(other, ''); await fs.writeFile(download, '1\n00:00:00,000 --> 00:00:01,000\nHi\n');
  await fs.writeFile(path.join(temp, 'show', 'Northbound.S01E02.srt'), '');
  try {
    const first = await keepSidecar(video, download, 'en');
    assert.equal(path.basename(first), 'Northbound.S01E01.en.srt');
    assert.equal(path.basename(await keepSidecar(video, download, 'en')), 'Northbound.S01E01.en.2.srt');
    assert.equal(await keepSidecar(video, first, 'en'), first);
    assert.equal(await fs.readFile(download, 'utf8'), await fs.readFile(first, 'utf8'));
    const tracks = await sidecars(video);
    assert.deepEqual(tracks.map(t => [t.index, t.language, t.title, t.codec, t.text]), [[SIDECAR, 'en', 'Subtitle file', 'srt', true], [SIDECAR + 1, 'en', '2', 'srt', true]]);
    assert.deepEqual((await sidecars(other)).map(t => path.basename(t.path)), ['Northbound.S01E02.srt']);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('any picked file becomes a show prelude, inside or outside its folder, and survives regrouping', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-prelude-'));
  const show = path.join(temp, 'Shows', 'Northbound');
  const files = ['S01/S01E01 - Thaw.mkv', 'S01/S01E02 - Drift.mkv', 'S02/S02E01 - Ice.mkv', 'extras/random clip 7.mkv'];
  for (const file of files) { const target = path.join(show, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, ''); }
  const outside = path.join(temp, 'Downloads', 'whatever_final_v2.mp4'); await fs.mkdir(path.dirname(outside), { recursive: true }); await fs.writeFile(outside, '');
  try {
    const items = await scan(path.join(temp, 'Shows'));
    const groupId = items.find(i => i.path.endsWith('S01E01 - Thaw.mkv')).groupId;
    const inside = path.join(show, 'extras', 'random clip 7.mkv');
    // A file in the show's folder is renumbered to the first season's episode 0.
    let result = applyPreludes(groupFolders(items), { [groupId]: inside });
    const pre = result.find(i => i.path === inside);
    assert.deepEqual([pre.kind, pre.groupId, pre.season, pre.episode, pre.prelude], ['show', groupId, 1, 0, true]);
    // A file from anywhere else joins the show; the previous pick loses its flag.
    result = applyPreludes(groupFolders(result), { [groupId]: outside });
    const added = result.find(i => i.path === outside);
    assert.deepEqual([added.group, added.season, added.episode, added.prelude, added.root], ['Northbound', 1, 0, true, path.join(temp, 'Shows')]);
    assert.equal(result.find(i => i.path === inside).prelude, undefined);
    assert.equal(result.filter(i => i.path === outside).length, 1);
    // Clearing the pick leaves regular numbering after regrouping.
    result = applyPreludes(groupFolders(result), {});
    assert.equal(result.some(i => i.prelude), false);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('title folders classify single videos as movies and multiple videos as shows across seasons', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-folders-'));
  const media = path.join(temp, 'Media');
  const files = [
    'Movies/Akira/Akira (1988).mkv',
    'Shows/Cyberpunk Edgerunners/S01/S01E01 - Let You Down.mkv',
    'Shows/Cyberpunk Edgerunners/S01/S01E02 - Like A Boy.mkv',
    'Shows/Cyberpunk Edgerunners/S02/S02E01 - Last Chance.mkv',
    'Shows/Over The Garden Wall/.Pre Tome of the Unknown.mp4',
    'Shows/Over The Garden Wall/Chapter 1 - The Old Grist Mill.mp4',
    'Shows/Over The Garden Wall/Chapter 10 - The Unknown.mp4',
    'Shows/Over The Garden Wall/Chapter 2 - Hard Times.mp4',
    'Shows/Over The Garden Wall/poster.jpg',
    'Movies/Akira/theme.flac',
    'Movies/Akira/subtitles.srt'
  ];
  for (const file of files) { const target = path.join(media, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, ''); }
  try {
    const items = await scan(media);
    assert.deepEqual([...new Set(items.filter(i => i.kind === 'show').map(i => i.group))].sort(), ['Cyberpunk Edgerunners', 'Over The Garden Wall']);
    assert.deepEqual(items.filter(i => i.kind === 'movie').map(i => i.group), ['Akira']);
    const cyberpunk = items.filter(i => i.group === 'Cyberpunk Edgerunners');
    assert.equal(new Set(cyberpunk.map(i => i.groupId)).size, 1);
    assert.deepEqual(cyberpunk.map(i => [i.season, i.episode]), [[1, 1], [1, 2], [2, 1]]);
    const garden = items.filter(i => i.group === 'Over The Garden Wall');
    assert.equal(garden.length, 4);
    assert.equal(garden.find(i => i.path.endsWith('.Pre Tome of the Unknown.mp4')).episode, 0);
    assert.deepEqual(garden.filter(i => i.episode > 0).map(i => i.episode), [1, 2, 10]);
    for (const folder of ['Shows', 'Shows/Cyberpunk Edgerunners', 'Shows/Cyberpunk Edgerunners/S01', 'Shows/Over The Garden Wall', 'Movies', 'Movies/Akira']) {
      const partial = await scan(path.join(media, folder));
      for (const item of partial) {
        const original = items.find(i => i.id === item.id);
        assert.equal(item.group, original.group); assert.equal(item.groupId, original.groupId); assert.equal(item.kind, original.kind);
      }
    }
    // Folder cardinality overrides episode-looking filenames, including after a rescan.
    await fs.mkdir(path.join(media, 'Shows', 'Single Episode'), { recursive: true });
    await fs.writeFile(path.join(media, 'Shows', 'Single Episode', 'S01E01.mkv'), '');
    assert.equal((await scan(path.join(media, 'Shows', 'Single Episode')))[0].kind, 'movie');
    await fs.writeFile(path.join(media, 'Shows', 'Single Episode', 'second.mkv'), '');
    assert.ok((await scan(path.join(media, 'Shows', 'Single Episode'))).every(i => i.kind === 'show'));
    await fs.unlink(path.join(media, 'Shows', 'Single Episode', 'second.mkv'));
    assert.equal((await scan(path.join(media, 'Shows', 'Single Episode')))[0].kind, 'movie');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('filename parsing identifies seasons and cleans release tags', () => {
  const item = describe('D:\\Media\\Northbound.S02E04.Signal.Fire.1080p.HEVC.mkv');
  assert.equal(item.group, 'Northbound'); assert.equal(item.season, 2); assert.equal(item.episode, 4); assert.equal(item.format, 'MKV');
  assert.equal(describe('Fieldline.1x03.mkv').episode, 3);
  assert.equal(describe('Evening.flac').kind, 'audio');
});
test('real MKV scan, streams, text subtitles, seek offset and audio-only output', async () => {
  const f = await fixtures();
  const items = await scan(f.dir); assert.ok(items.some(i => i.path === f.mkv)); assert.ok(!items.some(i => i.path === f.sub));
  const info = await probe(f.mkv); assert.equal(info.audio.length, 2); assert.equal(info.subtitles[0].text, true); assert.ok(info.duration >= 12); assert.equal(info.video.height, 360);
  const subs = await run(ffmpeg, ['-v', 'error', '-i', f.mkv, '-map', `0:${info.subtitles[0].index}`, '-f', 'webvtt', 'pipe:1']); assert.match(subs, /WEBVTT/); assert.match(subs, /Subtitles after a seek/);
  const service = await createStreamServer();
  try {
    const url = service.create({ file: f.mkv, offset: 5, audio: info.audio[1].index, hasVideo: true });
    assert.equal((await fetch(url + '-invalid')).status, 404);
    const response = await fetch(url); assert.equal(response.status, 200);
    const target = path.join(f.dir, 'output.mp4'); await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
    const output = await probe(target); assert.equal(output.video.codec, 'h264'); assert.equal(output.audio[0].codec, 'aac'); assert.equal(output.audio[0].channels, 2); assert.ok(output.duration > 6 && output.duration < 9);
    const audioUrl = service.create({ file: f.audio, offset: 0, audio: 0, hasVideo: false });
    const audioTarget = path.join(f.dir, 'audio-output.mp4'); await fs.writeFile(audioTarget, Buffer.from(await (await fetch(audioUrl)).arrayBuffer()));
    const audioInfo = await probe(audioTarget); assert.equal(audioInfo.video, null); assert.equal(audioInfo.audio[0].codec, 'aac');
  } finally { service.close(); }
});

test('PGS and DVD bitmap subtitles render, clear, seek, and respect delay; hover frames are real JPEGs', async () => {
  const files = await bitmapFixture(); const service = await createStreamServer(); const previews = createPreviews();
  async function render(file, offset, subtitleDelay = 0) {
    const info = await probe(file); assert.equal(info.subtitles[0].bitmap, true);
    const url = service.create({ file, offset, audio: null, hasVideo: true, bitmapSubtitle: info.subtitles[0].index, subtitleDelay });
    const response = await fetch(url); assert.equal(response.status, 200);
    const target = path.join(path.dirname(file), `burned-${path.basename(file)}-${offset}-${subtitleDelay}.mp4`);
    await fs.writeFile(target, Buffer.from(await response.arrayBuffer())); return target;
  }
  async function whitePixels(file, time) {
    const frame = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
    return [...frame].filter(value => value > 200).length;
  }
  try {
    for (const file of [files.pgs, files.dvd]) {
      const output = await render(file, 0);
      assert.ok(await whitePixels(output, 2) > 1000, 'Bitmap must be visibly composited');
      assert.ok(await whitePixels(output, 4.5) < 100, 'Cleared subtitle must disappear');
      const seeked = await render(file, 5);
      assert.ok(await whitePixels(seeked, 1) > 1000, 'Subtitle must survive a seek');
      const activeSeek = await render(file, 2);
      assert.ok(await whitePixels(activeSeek, .5) > 1000, 'Seeking into an active subtitle must retain it');
    }
    const delayed = await render(files.pgs, 0, 1);
    assert.ok(await whitePixels(delayed, 1.5) < 100); assert.ok(await whitePixels(delayed, 2.5) > 1000);
    const earlier = await render(files.pgs, 0, -1); assert.ok(await whitePixels(earlier, .5) > 1000);
    const preview = await previews.frame(files.pgs, 2);
    assert.match(preview, /^data:image\/jpeg;base64,/);
    const jpeg = Buffer.from(preview.split(',')[1], 'base64'); assert.equal(jpeg.readUInt16BE(0), 0xffd8);
    assert.equal(await previews.frame(files.pgs, 2.9), preview, 'Preview cache reuses frames within a second');
  } finally { service.close(); previews.close(); }
});

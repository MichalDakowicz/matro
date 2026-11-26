const { test } = require('node:test');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixtures, bitmapFixture } = require('./fixtures.cjs');
const { describe, scan, groupFolders, applyPreludes, sidecars, keepSidecar, SIDECAR, probe, ffmpeg, run } = require('../packages/core/desktop/media.cjs');
const { scan: scanServer } = require('../packages/core/server/scan.js');
const { createStreamServer } = require('../packages/core/desktop/stream.cjs');
const { createPreviews } = require('../packages/core/desktop/previews.cjs');
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
    await fs.writeFile(path.join(temp, 'show', 'Northbound.S01E01.pl.forced.srt'), ''); await fs.writeFile(path.join(temp, 'show', 'Northbound.S01E01.sdh.srt'), '');
    const flagged = Object.fromEntries((await sidecars(video)).map(t => [path.basename(t.path), [t.language, t.forced, t.sdh]]));
    assert.deepEqual(flagged['Northbound.S01E01.pl.forced.srt'], ['pl', true, false]);
    assert.deepEqual(flagged['Northbound.S01E01.sdh.srt'], ['und', false, true]);
    // "hi" is Hindi on its own and hearing impaired only beside a language tag.
    await fs.writeFile(path.join(temp, 'show', 'Northbound.S01E01.hi.srt'), ''); await fs.writeFile(path.join(temp, 'show', 'Northbound.S01E01.en.hi.srt'), '');
    const hindi = Object.fromEntries((await sidecars(video)).map(t => [path.basename(t.path), [t.language, t.forced, t.sdh]]));
    assert.deepEqual(hindi['Northbound.S01E01.hi.srt'], ['hi', false, false]);
    assert.deepEqual(hindi['Northbound.S01E01.en.hi.srt'], ['en', false, true]);
    // A folder named like a subtitle file is not one (the same lstat check skips symlinks).
    await fs.mkdir(path.join(temp, 'show', 'Northbound.S01E01.de.srt'));
    assert.equal((await sidecars(video)).some(t => path.basename(t.path) === 'Northbound.S01E01.de.srt'), false);
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

test('title folders group features and episodic files consistently across seasons', async () => {
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
    assert.equal(garden.find(i => i.path.endsWith('.Pre Tome of the Unknown.mp4')).episode, 11);
    assert.deepEqual(garden.map(i => i.episode), [11, 1, 2, 10]);
    for (const folder of ['Shows', 'Shows/Cyberpunk Edgerunners', 'Shows/Cyberpunk Edgerunners/S01', 'Shows/Over The Garden Wall', 'Movies', 'Movies/Akira']) {
      const partial = await scan(path.join(media, folder));
      for (const item of partial) {
        const original = items.find(i => i.id === item.id);
        assert.equal(item.group, original.group); assert.equal(item.groupId, original.groupId); assert.equal(item.kind, original.kind);
      }
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('desktop and server keep an explicitly numbered lone episode grouped without truncating its number', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-single-episode-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const show = path.join(root, 'Shows', 'Single Episode'), season = path.join(show, 'S02');
  const movies = path.join(root, 'Movies', 'Plain Feature');
  await fs.mkdir(season, { recursive: true });
  await fs.mkdir(movies, { recursive: true });
  const episodePath = path.join(season, 'S02E1120 Single Episode (2024) [1080p].mkv');
  const featurePath = path.join(movies, 'Plain Feature (2024) [1920x1080].mkv');
  await fs.writeFile(episodePath, '');
  await fs.writeFile(featurePath, '');
  for (const scanLibrary of [scan, scanServer]) {
    const group = item => item.groupTitle ?? item.group;
    const rows = await scanLibrary(root);
    const episode = rows.find(item => item.path === episodePath), feature = rows.find(item => item.path === featurePath);
    assert.deepEqual([episode.kind, group(episode), episode.season, episode.episode], ['show', 'Single Episode', 2, 1120]);
    assert.deepEqual([feature.kind, group(feature), feature.season, feature.episode], ['movie', 'Plain Feature', null, null]);
    assert.equal((await scanLibrary(show))[0].groupId, episode.groupId);
    assert.equal((await scanLibrary(season))[0].groupId, episode.groupId);
    const second = path.join(season, 'S02E1121.mkv');
    await fs.writeFile(second, '');
    assert.deepEqual((await scanLibrary(show)).map(item => item.episode), [1120, 1121]);
    await fs.unlink(second);
    assert.equal((await scanLibrary(show))[0].kind, 'show');
  }
});

test('server and desktop agree on loose episodes, release years, unnumbered cuts and extras', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-shared-scan-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'Media');
  const files = [
    'Example - S01E01.mkv', 'Example S01E02.mkv', 'Blade Runner 2049 (2017).mkv',
    'Movies/Cuts/First Cut.mkv', 'Movies/Cuts/Second Cut.mkv',
    'Movies/Cuts/Movie-sample.1080p.mkv', 'Movies/Cuts/Movie Trailer.mkv',
    'Movies/Cuts/Behind the Scenes.mkv', 'Movies/Cuts/Extras/Bonus.mkv',
    'Shows/Serial/S01/E02.mkv', 'Shows/Serial/S01/Episode 8.mkv', 'Shows/Serial/S01/Special.mkv'
  ];
  for (const file of files) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '');
  }
  const server = await scanServer(root), desktop = await scan(root);
  const shared = rows => rows.map(item => [item.id, item.title, item.groupTitle ?? item.group, item.year, item.kind, item.season, item.episode]);
  assert.deepEqual(shared(desktop), shared(server));
  assert.equal(server.length, 8);
  assert.equal(server.find(item => item.title.startsWith('Blade Runner')).title, 'Blade Runner 2049');
  assert.equal(server.find(item => item.title === 'Blade Runner 2049').year, 2017);
  assert.equal(describe('2001 A Space Odyssey.mkv').title, '2001 A Space Odyssey');
  for (const rows of [desktop, server]) {
    const loose = rows.filter(item => item.title.startsWith('Example'));
    assert.deepEqual(loose.map(item => item.episode), [1, 2]);
    assert.equal(loose[0].groupId, loose[1].groupId);
    assert.equal(rows.find(item => item.title === 'Special').episode, 9);
    assert.deepEqual(rows.filter(item => item.title.endsWith('Cut')).map(item => item.kind), ['movie', 'movie']);
  }
});

test('season directories signal shows and keep pre-upgrade folder group IDs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-season-folders-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [title, folder, season] of [['Show', 'Season 1', 1], ['Second Show', 'S02', 2], ['Third Show', 'Specials', 0]]) {
    const show = path.join(root, title), episodes = path.join(show, folder);
    await fs.mkdir(episodes, { recursive: true });
    await Promise.all([fs.writeFile(path.join(episodes, 'Pilot.mkv'), ''), fs.writeFile(path.join(show, 'Other.mkv'), '')]);
    for (const [scanLibrary, prefix] of [[scanServer, 'dir:'], [scan, '']]) {
      const previousId = createHash('sha256').update(prefix + show).digest('hex').slice(0, 24);
      const rows = await scanLibrary(show);
      assert.equal(rows.length, 2);
      assert.equal(rows.every(row => row.kind === 'show' && row.groupId === previousId), true);
      assert.equal(rows.find(row => row.title === 'Pilot').season, season);
      assert.equal((await scanLibrary(episodes))[0].groupId, previousId);
    }
  }

  const title = path.join(root, 'Older Show');
  await fs.mkdir(title);
  await Promise.all(['Pilot', 'Finale'].map(name => fs.writeFile(path.join(title, name + '.mkv'), '')));
  for (const [scanLibrary, prefix] of [[scanServer, 'dir:'], [scan, '']]) {
    const previousId = createHash('sha256').update(prefix + title).digest('hex').slice(0, 24);
    const rows = await scanLibrary(title, undefined, new Set([previousId]));
    assert.equal(rows.length, 2);
    assert.equal(rows.every(row => row.kind === 'show' && row.groupId === previousId), true);
  }
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
    assert.match(await previews.frame(files.pgs, 2, { hover: true }), /^data:image\/jpeg;base64,/);
    const [running, replaced, latest] = await Promise.all([5, 6, 7].map(time => previews.frame(files.pgs, time, { hover: true })));
    assert.match(running, /^data:image\/jpeg;base64,/, 'A newer hover never cancels the decode already running');
    assert.equal(replaced, undefined, 'A newer hover replaces the one still waiting');
    assert.match(latest, /^data:image\/jpeg;base64,/);
  } finally { service.close(); previews.close(); }
});

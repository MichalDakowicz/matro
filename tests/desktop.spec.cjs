const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixtures, bitmapFixture } = require('./fixtures.cjs');
const { describe } = require('../electron/media.cjs');

function launchOptions(profile) {
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE;
  return process.env.MATRO_EXECUTABLE ? { executablePath: process.env.MATRO_EXECUTABLE, args: [`--user-data-dir=${profile}`], env } : { args: [path.resolve(__dirname, '..')], env };
}

test('existing folder library migrates to two shows and one movie without losing progress', async () => {
  const root = path.resolve(__dirname, '../.test-media', `grouping-${Date.now()}`);
  const media = path.join(root, 'Media'), shows = path.join(media, 'Shows'), movies = path.join(media, 'Movies');
  const files = ['Movies/Akira/Akira (1988).mkv'];
  for (let season = 1; season <= 2; season++) for (let episode = 1; episode <= 10; episode++) files.push(`Shows/Cyberpunk Edgerunners/S0${season}/S0${season}E${String(episode).padStart(2, '0')} - Episode.mkv`);
  files.push('Shows/Over The Garden Wall/.Pre Tome of the Unknown.mp4');
  for (let episode = 1; episode <= 10; episode++) files.push(`Shows/Over The Garden Wall/Chapter ${episode} - Episode.mp4`);
  for (const file of files) { const target = path.join(media, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, ''); }
  const items = files.map(file => describe(path.join(media, file), file.startsWith('Shows/') ? shows : movies));
  const watched = items[1].id;
  const profile = path.join(root, 'profile'); await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ folders: [shows, movies], items, progress: { [watched]: { position: 120, duration: 1000 } }, queue: [watched], preferences: { volume: .5, autoplay: true } }));
  const app = await electron.launch(launchOptions(profile)); const page = await app.firstWindow();
  try {
    await expect(page.getByRole('button', { name: 'Shows 2', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Movies 1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Cyberpunk Edgerunners', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open Over The Garden Wall', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open Akira', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open S01', exact: true })).toHaveCount(0);
    await expect(page.getByText('2 seasons · 20 episodes', { exact: true })).toBeVisible();
    await expect(page.getByText('1 season · 11 episodes', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/folder-library.png' });
    await page.getByRole('button', { name: 'Open Over The Garden Wall', exact: true }).click();
    await expect(page.locator('.episode-row')).toHaveCount(11);
    await expect(page.locator('.episode-code').first()).toHaveText('S1 E0');
    await expect(page.locator('.episode-code').last()).toHaveText('S1 E10');
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    const state = await page.evaluate(() => window.matro.load());
    expect(state.progress[watched].position).toBe(120); expect(state.queue).toEqual([watched]); expect(state.libraryVersion).toBe(2);
    // Adding the encompassing Media root must not duplicate already scanned files.
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, media);
    await page.getByRole('button', { name: 'Folders', exact: true }).click();
    await page.getByRole('button', { name: 'Add folder', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Shows 2', exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.matro.load())).items).toHaveLength(32);
    await page.getByRole('button', { name: 'Rescan folders', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Movies 1', exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.matro.load())).items).toHaveLength(32);
  } finally { await app.close(); }
});

test('desktop library, MKV playback, tracks, seeking, queue and persistence', async () => {
  const f = await fixtures();
  const profile = path.join(f.dir, `profile-${Date.now()}`); await fs.mkdir(profile, { recursive: true });
  const launch = launchOptions(profile);
  let app = await electron.launch(launch);
  let page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await expect(page.getByRole('heading', { name: 'Your collection. Your kind of player.' })).toBeVisible();
    await page.screenshot({ path: 'test-results/library-empty.png' });
    // Stub only the native file picker; the renderer and import/playback paths stay real.
    await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, [f.mkv, f.audio]);
    await page.getByRole('button', { name: 'Open files', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    await expect(page.getByRole('button', { name: 'Open Northbound', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/library-filled.png' });
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: /^(Play now|Resume)$/ }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const seekBounds = await page.locator('#seek').boundingBox();
    await page.locator('#seek').hover({ position: { x: seekBounds.width / 2, y: seekBounds.height / 2 } });
    await expect(page.getByRole('tooltip', { name: 'Seek preview' })).toBeVisible();
    await expect(page.locator('#seek-preview-time')).toHaveText(/^0:0[56]\.\d$/);
    await expect(page.locator('#seek-preview-image')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/seek-preview.png' });
    await page.getByRole('button', { name: 'Fullscreen (F)', exact: true }).click();
    await expect(page.locator('body')).toHaveClass(/fullscreen/);
    await expect(page.locator('.titlebar')).toBeHidden(); await expect(page.locator('#queue')).toBeHidden();
    const geometry = await page.locator('.stage').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, viewportWidth: innerWidth, viewportHeight: innerHeight }));
    expect(geometry.width).toBe(geometry.viewportWidth); expect(geometry.height).toBe(geometry.viewportHeight);
    await page.screenshot({ path: 'test-results/fullscreen.png' });
    await page.keyboard.press('Escape'); await expect(page.locator('body')).not.toHaveClass(/fullscreen/);
    await expect(page.locator('.titlebar')).toBeVisible(); await expect(page.locator('#queue')).toBeHidden();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Audio', exact: true })).toBeVisible();
    await expect(page.locator('[data-audio="1"] strong')).toHaveText('English');
    await expect(page.locator('[data-audio="1"] .track-title')).toHaveText('Original mix');
    await expect(page.locator('[data-audio="2"] strong')).toHaveText('Polish');
    await page.locator('[data-subtitle="3"]').click();
    await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0]?.cues?.length || 0)).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/player-tracks.png' });
    await page.locator('[data-action="delay-up"]').click();
    await expect(page.locator('.delay-controls output')).toHaveText('+0.1 s');
    await page.locator('[data-audio="2"]').click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Close audio and subtitles' }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.paused)).toBe(true);
    await page.locator('#seek').evaluate(el => { el.value = '6'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(page.locator('#position')).toHaveText('0:06');
    // Elapsed and total sit together on the left; time left is on the right.
    await expect(page.locator('.time-pair')).toHaveText('0:06/0:12');
    await expect(page.locator('#remaining')).toHaveText('-0:06');
    // Volume boosts past 100% through a Web Audio gain stage; the CORS-mode stream must keep playing.
    await page.locator('#volume').evaluate(el => { el.value = '1.4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.locator('#volume-value')).toHaveText('140%');
    await expect(page.locator('#volume-value')).toHaveClass(/boosted/);
    expect(await page.locator('video').evaluate(v => ({ volume: v.volume, error: v.error }))).toEqual({ volume: 1, error: null });
    await expect.poll(async () => (await page.evaluate(() => window.matro.load())).preferences.volume).toBe(1.4);
    await page.keyboard.press('ArrowUp'); await expect(page.locator('#volume-value')).toHaveText('145%');
    await page.locator('#volume').evaluate(el => { el.value = '.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.locator('#volume-value')).toHaveText('50%');
    expect(await page.locator('video').evaluate(v => v.volume)).toBe(.5);
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    await expect(page.locator('#queue')).toBeVisible();
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    await expect(page.locator('#queue')).toBeHidden();
    // A queue left open does not reopen the next time playback starts from the library.
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    await expect(page.locator('#queue')).toBeVisible();
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    await expect(page.getByRole('heading', { name: 'Continue watching' })).toBeVisible();
    await page.locator('.continue-card .cw').first().click();
    await expect(page.locator('.stage')).toBeVisible(); await expect(page.locator('#queue')).toBeHidden();
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    await expect(page.getByRole('heading', { name: 'Continue watching' })).toBeVisible();
    await app.close();
    app = await electron.launch(launch); page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Resume watching', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search library' }).fill('Evening');
    await expect(page.getByRole('button', { name: 'Open Evening', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Northbound', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('bitmap subtitle selection, delay, and Off reload video while keeping pause state', async () => {
  const files = await bitmapFixture(); const profile = path.resolve(__dirname, '../.test-media', `bitmap-profile-${Date.now()}`); await fs.mkdir(profile, { recursive: true });
  const app = await electron.launch(launchOptions(profile)); const page = await app.firstWindow();
  try {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, files.pgs);
    await page.getByRole('button', { name: 'Open files', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    await expect(page.locator('[data-subtitle="1"]')).toBeEnabled();
    let source = await page.locator('video').getAttribute('src');
    await page.locator('[data-subtitle="1"]').click();
    await expect(page.locator('video')).not.toHaveAttribute('src', source);
    await expect.poll(() => page.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-subtitle="1"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#sub-size')).toBeDisabled();
    expect(await page.locator('video').evaluate(v => v.paused)).toBe(true);
    source = await page.locator('video').getAttribute('src');
    await page.locator('[data-action="delay-up"]').click(); await expect(page.locator('video')).not.toHaveAttribute('src', source);
    await expect(page.locator('.delay-controls output')).toHaveText('+0.1 s');
    source = await page.locator('video').getAttribute('src');
    await page.locator('[data-subtitle="off"]').click(); await expect(page.locator('video')).not.toHaveAttribute('src', source);
    await expect(page.locator('#sub-size')).toBeEnabled();
    expect(await page.locator('video').evaluate(v => v.paused)).toBe(true);
  } finally { await app.close(); }
});

test('show tracking, early progress, completion, season groups, skip markers and track choices persist', async () => {
  const f = await fixtures();
  const { run, ffmpeg } = require('../electron/media.cjs');
  const second = path.join(f.dir, 'Northbound.S01E04.Second.mkv');
  const third = path.join(f.dir, 'Northbound.S02E01.Third.mkv');
  await run(ffmpeg, ['-y', '-v', 'error', '-i', f.mkv, '-map', '0:v', '-map', '0:s', '-map', '0:a:0', '-map', '0:a:1', '-c', 'copy', second]);
  await fs.copyFile(second, third);
  const profile = path.join(f.dir, `tracking-profile-${Date.now()}`); await fs.mkdir(profile, { recursive: true });
  const launch = launchOptions(profile);
  let app = await electron.launch(launch), page = await app.firstWindow();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const seekTo = async value => {
    await page.locator('#seek').evaluate((el, time) => { el.value = time; el.dispatchEvent(new Event('change', { bubbles: true })); }, String(value));
    await expect(page.locator('#position')).toHaveText(`0:0${value}`);
    await expect.poll(() => page.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  };
  try {
    await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, [f.mkv, second, third]);
    await page.getByRole('button', { name: 'Open files', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await seekTo(3);
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    await expect(page.locator('.continue-card')).toHaveCount(1);
    let state = await page.evaluate(() => window.matro.load());
    const [one, two, three] = state.items;
    expect(state.progress[one.id].position).toBeGreaterThanOrEqual(3);
    await page.locator('.continue-card [data-play]').click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    await page.locator('[data-audio="2"]').click();
    await expect.poll(() => page.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
    await page.locator('[data-subtitle="3"]').click();
    // Skip segments has its own panel; opening it replaces Audio and subtitles.
    await page.getByRole('button', { name: 'Skip segment settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Audio', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Mark intro start', exact: true }).click();
    await seekTo(7);
    await page.getByRole('button', { name: 'Save end here', exact: true }).click();
    await page.getByRole('button', { name: 'Close skip segments' }).click();
    await seekTo(4);
    await expect(page.getByRole('button', { name: 'Skip intro', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip intro', exact: true }).click();
    await expect(page.locator('#position')).toHaveText('0:07');
    await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Completed ✓', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next in queue' }).click();
    await expect(page.locator('.player-heading h1')).toHaveText(two.title);
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    // Both selected tracks moved to different stream indexes in the next episode.
    await expect(page.locator('[data-audio="3"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-audio="3"] strong')).toHaveText('Polish');
    await expect(page.locator('[data-subtitle="1"]')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Close audio and subtitles' }).click();
    await expect(page.locator('#queue .season-heading')).toHaveCount(2);
    await page.screenshot({ path: 'test-results/show-tracking.png' });
    await seekTo(3);
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    await expect(page.locator('.continue-card')).toHaveCount(1);
    await expect(page.locator('.continue-card [data-play]')).toHaveAttribute('data-play', two.id);
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await expect(page.locator('.detail .season-heading')).toHaveCount(2);
    await page.locator(`.episode-row[data-play="${one.id}"]`).click();
    await expect(page.locator('.player-heading h1')).toHaveText(one.title);
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await seekTo(2);
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    expect((await page.evaluate(() => window.matro.load())).progress[one.id].completed).toBe(true);
    await page.getByRole('button', { name: 'Remove Northbound from Continue watching' }).click();
    await expect(page.locator('.continue-card')).toHaveCount(0);
    await app.close();
    app = await electron.launch(launch); page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Open Northbound', exact: true })).toBeVisible();
    await expect(page.locator('.continue-card')).toHaveCount(0);
    state = await page.evaluate(() => window.matro.load());
    expect(state.progress[one.id].completed).toBe(true);
    expect(state.markers[one.id].some(s => s.type === 'intro' && s.source === 'manual')).toBe(true);
    expect(state.preferences.tracks[one.group].subtitle.language).toBe('eng');
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('series repairs mixed saved queue, preserves removals and stops before other titles', async () => {
  const f = await fixtures();
  const second = path.join(f.dir, 'Northbound.S01E04.Queue.mkv'), last = path.join(f.dir, 'Northbound.S02E01.Queue.mkv');
  const other = path.join(f.dir, 'Elsewhere.S01E01.Queue.mkv'), movie = path.join(f.dir, 'QueueMovie.mkv');
  for (const file of [second, last, other, movie]) await fs.copyFile(f.mkv, file);
  const items = [f.mkv, second, last, other, movie].map(file => describe(file));
  const profile = path.join(f.dir, `queue-profile-${Date.now()}`); await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, folders: [], items, queue: [items[4].id, items[2].id, items[3].id, items[0].id, items[1].id], progress: {}, preferences: { autoplay: true, volume: .3 } }));
  const app = await electron.launch(launchOptions(profile)), page = await app.firstWindow();
  try {
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    expect((await page.evaluate(() => window.matro.load())).queue).toEqual(items.slice(0, 3).map(i => i.id));
    await expect(page.locator('#queue .queue-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    await page.locator(`[data-remove-queue="${items[1].id}"]`).click();
    await page.getByRole('button', { name: 'Next in queue', exact: true }).click();
    await expect(page.locator('.player-heading h1')).toHaveText(items[2].title);
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('#queue .queue-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Next in queue', exact: true }).click();
    await page.locator('video').evaluate(v => v.dispatchEvent(new Event('ended')));
    await expect(page.locator('.player-heading h1')).toHaveText(items[2].title);
    expect((await page.evaluate(() => window.matro.load())).queue).toEqual([items[0].id, items[2].id]);
  } finally { await app.close(); }
});

test('automatic markers retry empty results, appear in UI and skip real intro/outro', async () => {
  const { run, ffmpeg } = require('../electron/media.cjs');
  const folder = path.resolve('.test-media', `auto-ui-${Date.now()}`); await fs.mkdir(folder, { recursive: true });
  const first = path.join(folder, 'Detected.S01E01.mp4'), second = path.join(folder, 'Detected.S01E02.mp4');
  for (const [file, brightness] of [[first, 0], [second, .025]]) {
    await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=10:d=25', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=40', '-f', 'lavfi', '-i', 'testsrc=s=160x90:r=10:d=25', '-filter_complex', `[0:v]eq=brightness=${brightness}[intro];[intro][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[out]`, '-map', '[out]', '-c:v', 'libx264', '-preset', 'ultrafast', file]);
  }
  const items = [first, second].map(file => describe(file)), profile = path.join(folder, 'profile'); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, folders: [], items, queue: [], progress: {}, markers: { [items[0].id]: [] }, preferences: { autoplay: false, volume: .3 } }));
  const app = await electron.launch(launchOptions(profile)), page = await app.firstWindow();
  try {
    await page.getByRole('button', { name: 'Open Detected', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.matro.load())).markers[items[0].id]?.filter(s => s.source === 'automatic').length || 0).toBeGreaterThanOrEqual(2);
    for (const type of ['intro', 'outro']) {
      const state = await page.evaluate(() => window.matro.load());
      const marker = state.markers[items[0].id].find(s => s.type === type);
      expect(marker).toBeTruthy();
      await page.locator('#seek').evaluate((el, time) => { el.value = time; el.dispatchEvent(new Event('change', { bubbles: true })); }, marker.start + 2);
      const skip = page.getByRole('button', { name: `Skip ${type}`, exact: true });
      await expect(skip).toBeVisible(); await skip.click();
      await expect.poll(() => page.locator('#seek').inputValue().then(Number)).toBeGreaterThanOrEqual(Math.min(89.8, marker.end - .2));
    }
    await page.getByRole('button', { name: 'Skip segment settings', exact: true }).click();
    await expect(page.locator('.marker-row')).toHaveCount(2);
  } finally { await app.close(); }
});

test('idle scanning prioritizes Continue watching, saves markers and resumes after restart', async () => {
  const { run, ffmpeg } = require('../electron/media.cjs');
  const folder = path.resolve('.test-media', `idle-scan-${Date.now()}`); await fs.mkdir(folder, { recursive: true });
  const first = path.join(folder, 'Watching.S01E01.mp4'), second = path.join(folder, 'Watching.S01E02.mp4');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=5:d=90', '-c:v', 'libx264', '-preset', 'ultrafast', first]);
  await run(ffmpeg, ['-y', '-v', 'error', '-i', first, '-vf', 'eq=brightness=0.025', '-c:v', 'libx264', '-preset', 'ultrafast', second]);
  const others = [1, 2].map(n => path.join(folder, `Aardvark.S01E0${n}.mp4`));
  for (const file of others) await fs.copyFile(first, file);
  const items = [...others, first, second].map(file => describe(file)), resume = items[3];
  const profile = path.join(folder, 'profile'); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, folders: [], items, queue: [], progress: { [resume.id]: { position: 3, duration: 90, updated: Date.now() } }, preferences: { autoplay: false, volume: .3 } }));
  const launch = launchOptions(profile); let app = await electron.launch(launch), page = await app.firstWindow();
  try {
    await page.evaluate(() => { window.scanStarts = []; window.matro.onSegments(update => { if (update.stage === 'started' && update.mode === 'quick') window.scanStarts.push(update.id); }); });
    await expect(page.locator('video')).toHaveCount(0);
    // Continue watching shows the frame one second before where playback stopped.
    await expect(page.locator(`.cw-art[data-frame="${resume.id}"]`)).toHaveAttribute('data-time', '2');
    await expect(page.locator(`.cw-art[data-frame="${resume.id}"] img`)).toHaveCount(1, { timeout: 15000 });
    await expect.poll(async () => { const s = await page.evaluate(() => window.matro.load()); return items.every(i => s.segmentScans?.[i.id]?.quick); }, { timeout: 15000 }).toBe(true);
    expect((await page.evaluate(() => window.scanStarts))[0]).toBe(resume.id);
    await expect(page.locator('#scanner-status')).toContainText('episodes ready');
    const state = await page.evaluate(() => window.matro.load());
    expect(state.markers[resume.id].some(s => s.type === 'intro')).toBe(true);
    // An old renderer save cannot erase matches prepared in the background.
    await page.evaluate(id => window.matro.save({ markers: { [id]: [] } }), resume.id);
    expect((await page.evaluate(() => window.matro.load())).markers[resume.id].length).toBeGreaterThan(0);
    await expect.poll(async () => { const s = await page.evaluate(() => window.matro.load()); return items.every(i => s.segmentScans?.[i.id]?.full); }, { timeout: 15000 }).toBe(true);
    const marker = (await page.evaluate(() => window.matro.load())).markers[resume.id][0];
    await page.evaluate(({ id, marker }) => window.matro.removeMarker({ id, marker }), { id: resume.id, marker });
    await page.screenshot({ path: 'test-results/background-scanner.png' });
    await app.close(); app = await electron.launch(launch); page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Open Watching', exact: true })).toBeVisible();
    const restored = await page.evaluate(() => window.matro.load());
    expect(restored.segmentScans[resume.id].full).toBe(true);
    expect(restored.markers[resume.id].some(s => s.type === marker.type && s.start === marker.start && s.end === marker.end)).toBe(false);
    await expect(page.locator('video')).toHaveCount(0);
  } finally { await app.close(); }
});

test('scanner remains active in gentle mode while video keeps playing', async () => {
  const f = await fixtures(), second = path.join(f.dir, 'Northbound.S01E04.Gentle.mkv'); await fs.copyFile(f.mkv, second);
  const items = [f.mkv, second].map(file => describe(file)), profile = path.join(f.dir, `gentle-profile-${Date.now()}`); await fs.mkdir(profile);
  // Page animations are off: the short fixtures scan so fast that a half-second title-page animation lets the scan finish before playback starts.
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, items, folders: [], queue: [], progress: {}, preferences: { autoplay: false, volume: .3, motion: 'off' } }));
  const app = await electron.launch(launchOptions(profile)), page = await app.firstWindow();
  try {
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await expect.poll(() => page.evaluate(() => window.matro.scannerStatus()).then(s => s.playback)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.matro.scannerStatus()).then(s => s.running)).toBe(true);
    const before = await page.locator('video').evaluate(v => v.currentTime);
    await page.waitForTimeout(4000);
    const after = await page.locator('video').evaluate(v => ({ time: v.currentTime, paused: v.paused }));
    expect(after.paused).toBe(false); expect(after.time - before).toBeGreaterThan(3);
    await page.locator('.stage').hover();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.paused)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.matro.scannerStatus()).then(s => s.playback)).toBe(false);
  } finally { await app.close(); }
});

test('leaving during an outro marks the episode watched and moves Continue watching on', async () => {
  const f = await fixtures(), next = path.join(f.dir, 'Northbound.S01E04.Outro.mkv'); await fs.copyFile(f.mkv, next);
  const items = [f.mkv, next].map(file => describe(file)), profile = path.join(f.dir, `outro-profile-${Date.now()}`); await fs.mkdir(profile);
  // Outro from 7 s of a 12 s episode: well before the usual end-of-file threshold, so only the outro rule can complete it.
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, items, folders: [], queue: [], progress: {}, markers: { [items[0].id]: [{ type: 'outro', start: 7, end: 11, source: 'manual' }] }, preferences: { autoplay: false, volume: .3, motion: 'off' } }));
  const app = await electron.launch(launchOptions(profile)), page = await app.firstWindow();
  try {
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    // Skip ranges are labelled on the seek bar, and hovering inside one names it in the preview.
    await expect(page.locator('.seek-mark i')).toHaveText('Outro');
    await page.screenshot({ path: 'test-results/seek-sections.png' });
    const bounds = await page.locator('#seek').boundingBox();
    await page.locator('#seek').hover({ position: { x: 8 + (bounds.width - 16) * 9 / 12, y: bounds.height / 2 } });
    await expect(page.locator('#seek-preview-section')).toHaveText('Outro');
    await page.locator('#seek').hover({ position: { x: 8 + (bounds.width - 16) * 2 / 12, y: bounds.height / 2 } });
    await expect(page.locator('#seek-preview-section')).toBeHidden();
    await page.locator('#seek').evaluate(el => { el.value = '8'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(page.locator('#position')).toHaveText('0:08');
    await expect.poll(() => page.locator('video').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    expect((await page.evaluate(() => window.matro.load())).progress[items[0].id].completed).toBe(true);
    await expect(page.locator('.continue-card [data-play]')).toHaveAttribute('data-play', items[1].id);
  } finally { await app.close(); }
});

test('subtitles stay right after seeks and 5-second skips, paused or playing', async () => {
  const f = await fixtures(), items = [describe(f.mkv)], profile = path.join(f.dir, `subtitle-seek-profile-${Date.now()}`); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, items, folders: [], queue: [], progress: {}, preferences: { autoplay: false, volume: .3, motion: 'off' } }));
  const app = await electron.launch(launchOptions(profile)), page = await app.firstWindow();
  const active = () => page.locator('video').evaluate(v => [...(v.textTracks[0]?.activeCues || [])].map(c => c.text).join('|'));
  try {
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.3);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    await page.locator('[data-subtitle="3"]').click();
    await expect.poll(active).toBe('A place for your collection.');
    await page.getByRole('button', { name: 'Close audio and subtitles' }).click();
    // Paused: a seek that restarts the stream must show the line for the new moment without pressing play.
    await page.locator('#seek').evaluate(el => { el.value = '6'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect.poll(active).toBe('Subtitles after a seek.');
    await page.getByRole('button', { name: 'Back 5 seconds' }).click();
    await expect.poll(active).toBe('A place for your collection.');
    // Playing: after a forward skip only the current line shows, not the one that ended before the jump.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Forward 5 seconds' }).click();
    await expect.poll(active).toBe('Subtitles after a seek.');
  } finally { await app.close(); }
});

test('a seek while paused is saved, including one right after another', async () => {
  const f = await fixtures(), items = [describe(f.mkv)], profile = path.join(f.dir, `paused-seek-profile-${Date.now()}`); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, items, folders: [], queue: [], progress: {}, preferences: { autoplay: false, volume: .3, motion: 'off' } }));
  const app = await electron.launch(launchOptions(profile)), page = await app.firstWindow();
  const saved = async () => Object.values(JSON.parse(await fs.readFile(path.join(profile, 'library.json'), 'utf8')).progress)[0]?.position ?? 0;
  try {
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.3);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.locator('#seek').evaluate(el => { el.value = '8'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect.poll(saved, { timeout: 4000 }).toBeGreaterThan(7.5);
    // The throttle must not swallow the last change: a second seek right after the first is saved too.
    await page.locator('#seek').evaluate(el => { el.value = '3'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect.poll(saved, { timeout: 4000 }).toBeLessThan(3.5);
  } finally { await app.close(); }
});

test('any file can be picked as a show prelude and plays first', async () => {
  const f = await fixtures();
  const root = path.resolve(__dirname, '../.test-media', `prelude-${Date.now()}`), show = path.join(root, 'Shows', 'Northbound');
  await fs.mkdir(show, { recursive: true });
  for (const episode of [1, 2]) await fs.copyFile(f.mkv, path.join(show, `Northbound.S01E0${episode}.mkv`));
  const prelude = path.join(root, 'Elsewhere', 'random clip_final.mkv'); await fs.mkdir(path.dirname(prelude), { recursive: true }); await fs.copyFile(f.mkv, prelude);
  const profile = path.join(root, 'profile'); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, folders: [], items: [], queue: [], progress: {}, preferences: { autoplay: false, volume: .3, motion: 'off' } }));
  const app = await electron.launch(launchOptions(profile)), page = await app.firstWindow();
  try {
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, path.join(root, 'Shows'));
    await page.getByRole('button', { name: 'Add folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).first().click();
    await expect(page.locator('.episode-row')).toHaveCount(2);
    // The picker accepts a file with any name from anywhere; cancelling changes nothing.
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await page.getByRole('button', { name: 'Add prelude…', exact: true }).click();
    await expect(page.locator('.episode-row')).toHaveCount(2);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, prelude);
    await page.getByRole('button', { name: 'Add prelude…', exact: true }).click();
    await expect(page.locator('.episode-row')).toHaveCount(3);
    await expect(page.locator('.episode-code').first()).toHaveText('Prelude');
    await page.screenshot({ path: 'test-results/prelude.png' });
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect(page.locator('.player-heading p')).toHaveText('Northbound · Prelude');
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    // A rescan keeps the pick; removing it drops the outside file from the show again.
    await page.getByRole('button', { name: 'Folders', exact: true }).click();
    await page.getByRole('button', { name: 'Rescan folders', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.matro.load())).items.filter(i => i.prelude).length).toBe(1);
    await page.getByRole('button', { name: 'Shows 1', exact: true }).click();
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).first().click();
    await page.getByRole('button', { name: 'Remove prelude', exact: true }).click();
    await expect(page.locator('.episode-row')).toHaveCount(2);
    await expect(page.locator('.episode-code').first()).toHaveText('S1 E1');
  } finally { await app.close(); }
});

test('position is saved when leaving right after a seek and when the window is closed', async () => {
  const f = await fixtures(), item = describe(f.mkv), profile = path.join(f.dir, `exit-profile-${Date.now()}`); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, items: [item], folders: [], queue: [], progress: {}, preferences: { autoplay: false, volume: .3, motion: 'off' } }));
  const launch = launchOptions(profile); let app = await electron.launch(launch), page = await app.firstWindow();
  const saved = async () => (await page.evaluate(() => window.matro.load())).progress[item.id]?.position || 0;
  try {
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    // Leave while the stream for the seek target is still starting.
    await page.locator('#seek').evaluate(el => { el.value = '9'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    expect(await saved()).toBeGreaterThanOrEqual(9);
    // Closing the window (title bar, Alt+F4) flushes the latest position before quitting.
    await page.getByRole('button', { name: /^(Resume watching|Play)$/ }).first().click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.locator('#seek').evaluate(el => { el.value = '4'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(page.locator('#position')).toHaveText(/^0:0[4-9]$/);
    const closed = app.waitForEvent('close');
    await page.evaluate(() => { void window.matro.window('close'); });
    await closed;
    app = await electron.launch(launch); page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Continue watching' })).toBeVisible();
    const position = await saved(); expect(position).toBeGreaterThanOrEqual(4); expect(position).toBeLessThan(9);
  } finally { await app.close(); }
});

test('one click anywhere on the picture pauses, even under the visible control gradients', async () => {
  const f = await fixtures(), item = describe(f.mkv), profile = path.join(f.dir, `click-profile-${Date.now()}`); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, items: [item], folders: [], queue: [], progress: {}, preferences: { autoplay: false, volume: .3, motion: 'off' } }));
  const app = await electron.launch(launchOptions(profile)), page = await app.firstWindow();
  try {
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    const stage = await page.locator('.stage').boundingBox(), x = stage.x + stage.width / 2;
    // Just below the title (inside the top gradient), then just above the seek bar (inside the bottom gradient).
    for (const y of [stage.y + 120, stage.y + stage.height - 150]) {
      await page.mouse.move(x, y); await expect(page.locator('.stage')).not.toHaveClass(/idle/);
      await page.mouse.click(x, y);
      await expect.poll(() => page.locator('video').evaluate(v => v.paused)).toBe(true);
      await page.waitForTimeout(400); // clear the double-click window, so the next click is not read as fullscreen
      await page.mouse.click(x, y);
      await expect.poll(() => page.locator('video').evaluate(v => v.paused)).toBe(false);
      await page.waitForTimeout(400);
    }
  } finally { await app.close(); }
});

test('a loaded subtitle file is copied next to the video and offered again next time', async () => {
  const f = await fixtures(), folder = path.join(f.dir, `sidecar-${Date.now()}`); await fs.mkdir(folder);
  const video = path.join(folder, 'Northbound.S01E03.The.Long.Thaw.mkv'); await fs.copyFile(f.mkv, video);
  const item = describe(video), profile = path.join(folder, 'profile'); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, items: [item], folders: [], queue: [], progress: {}, preferences: { autoplay: false, volume: .3, motion: 'off' } }));
  const launch = launchOptions(profile); let app = await electron.launch(launch), page = await app.firstWindow();
  try {
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, f.sub);
    await page.getByRole('button', { name: 'Load subtitle file…', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0]?.cues?.length || 0)).toBeGreaterThan(0);
    await expect(page.locator('[data-subtitle="10000"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await fs.readFile(path.join(folder, 'Northbound.S01E03.The.Long.Thaw.srt'), 'utf8')).toBe(await fs.readFile(f.sub, 'utf8'));
    await app.close(); app = await electron.launch(launch); page = await app.firstWindow();
    await page.getByRole('button', { name: 'Resume watching', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0]?.cues?.length || 0)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    await expect(page.locator('[data-subtitle="10000"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-subtitle="10000"] small')).toContainText('File next to video');
    // Subtitle look: size, font, background and text style are one global preference applied through CSS variables.
    await page.locator('#sub-size').evaluate(el => { el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.locator('.sub-style-row output')).toHaveText('150%');
    for (const choice of ['font:serif', 'background:solid', 'bold:on', 'edge:outline']) await page.locator(`[data-sub-style="${choice}"]`).click();
    await expect(page.locator('[data-sub-style="bold:on"]')).toHaveAttribute('aria-pressed', 'true');
    const vars = await page.locator('video').evaluate(v => ['--cue-scale', '--cue-font', '--cue-bg', '--cue-weight', '--cue-shadow'].map(name => v.style.getPropertyValue(name)));
    expect(vars[0]).toBe('1.5'); expect(vars[1]).toContain('Georgia'); expect(vars[2]).toBe('rgb(0 0 0 / 1)'); expect(vars[3]).toBe('700'); expect(vars[4]).toContain('#000');
    await page.screenshot({ path: 'test-results/subtitle-panel.png' });
    await page.getByRole('button', { name: 'Close audio and subtitles' }).click();
    await page.screenshot({ path: 'test-results/subtitle-style.png' });
    await expect.poll(async () => (await page.evaluate(() => window.matro.load())).preferences.subtitles).toEqual({ size: 1.5, font: 'serif', background: 'solid', bold: true, italic: false, edge: 'outline' });
  } finally { await app.close(); }
});

test('the next episode is preloaded near the end and starts without waiting', async () => {
  const f = await fixtures(), folder = path.join(f.dir, `preload-${Date.now()}`); await fs.mkdir(folder);
  const files = [1, 2].map(n => path.join(folder, `Northbound.S01E0${n}.mkv`)); for (const file of files) await fs.copyFile(f.mkv, file);
  const items = files.map(file => describe(file)), profile = path.join(folder, 'profile'); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, items, folders: [], queue: [], progress: {}, preferences: { autoplay: true, volume: .3, motion: 'off' } }));
  const app = await electron.launch(launchOptions(profile)), page = await app.firstWindow();
  try {
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect(page.locator('.player-heading p')).toHaveText('Northbound · S1 E1');
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.locator('#seek').evaluate(el => { el.value = '9'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    // Autoplay moves on to episode 2 on the stream that was already buffering.
    await expect(page.locator('.player-heading p')).toHaveText('Northbound · S1 E2', { timeout: 15000 });
    const adopted = await page.locator('video').getAttribute('data-preloaded');
    expect(Number(adopted)).toBeGreaterThanOrEqual(2);
    const started = Date.now();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime), { intervals: [50] }).toBeGreaterThan(.1);
    expect(Date.now() - started).toBeLessThan(1500);
    await expect(page.locator('#position')).toHaveText(/^0:0\d$/);
    expect(await page.locator('video').evaluate(v => ({ paused: v.paused, error: v.error }))).toEqual({ paused: false, error: null });
    // Opening the preload stream must not cut the playing episode short: episode 1 ran to its end.
    const first = (await page.evaluate(() => window.matro.load())).progress[items[0].id];
    expect(first.completed).toBe(true); expect(first.position).toBeGreaterThan(11);
  } finally { await app.close(); }
});

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const { _electron: electron } = require(repo + '/node_modules/@playwright/test');
const profile = path.join(repo, '.test-media/download-cards-ui-' + Date.now());
const active = 'a'.repeat(40), absent = 'b'.repeat(40);
let present = true, deleteCalls = 0, outage = false;
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const form = new URLSearchParams(body);
  if (req.url.endsWith('/auth/login')) { res.setHeader('set-cookie', 'SID=test; path=/; HttpOnly'); res.end('Ok.'); }
  else if (req.url.endsWith('/app/version')) res.end('v5.1.4');
  else if (req.url.startsWith('/api/v2/torrents/info')) {
    if (outage) { res.statusCode = 530; res.end('Temporary tunnel outage'); return; }
    const requested = new URL(req.url, 'http://test').searchParams.get('hashes');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(present && (!requested || requested === active) ? [{ hash: active, name: 'Akira (1988) [1080p]', progress: .42, state: 'downloading', dlspeed: 4053695, save_path: '/Movies' }] : []));
  } else if (req.url.endsWith('/torrents/delete')) {
    assert.equal(form.get('hashes'), active); assert.equal(form.get('deleteFiles'), 'false');
    deleteCalls++; present = false; res.end();
  } else { res.statusCode = 404; res.end(); }
});
(async () => {
  await fs.mkdir(path.join(profile, 'artwork'), { recursive: true });
  const artwork = path.join(profile, 'artwork/movie-149-backdrop.jpg');
  execFileSync(require(repo + '/node_modules/ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=1', '-frames:v', '1', artwork]);
  await fs.writeFile(path.join(profile, 'metadata.json'), JSON.stringify({ entries: {
    'download:movie:Akira:1988': { status: 'matched', matcher: 2, details: 3, title: 'Akira', backdrop: 'artwork/movie-149-backdrop.jpg' },
    'download:movie:Old download:2020': { status: 'matched', matcher: 2, details: 3, title: 'Old download', backdrop: 'artwork/movie-149-backdrop.jpg' },
  } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const makeJob = (hash, title, year, phase) => ({ id: hash.slice(0, 8), hash, target: 'local', url: base, username: 'michu', release: { title, year, kind: 'movie' }, storage: { movieRoot: '/Movies' }, seed: false, phase, error: phase === 'error' ? 'Torrent is not in the client.' : '', plan: phase === 'complete' ? { files: [], skip: [], root: '/Movies' } : undefined });
  await fs.writeFile(path.join(profile, 'download-jobs.json'), JSON.stringify([makeJob(active, 'Akira', '1988', 'complete'), makeJob(absent, 'Old download', '2020', 'error')]));
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [repo], env, cwd: repo });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async base => { await window.matro.load(); await window.matro.downloadConfigure({ target: 'local', url: base, username: 'michu', password: 'test-only', seeding: 'no' }); }, base);
    await page.getByRole('button', { name: 'Downloads', exact: true }).click();
    await page.locator('.xfer').first().waitFor();
    assert.equal(await page.locator('.xfer').count(), 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.xfer-banner')].length === 2 && [...document.querySelectorAll('.xfer-banner')].every(image => image.complete && image.naturalWidth > 0));
    outage = true;
    await page.getByRole('button', { name: 'Refresh downloads', exact: true }).click();
    await page.locator('#download-transfers > .note').waitFor();
    assert.match(await page.locator('#download-transfers > .note').textContent(), /Reconnecting automatically/);
    outage = false;
    await page.waitForFunction(() => !document.querySelector('#download-transfers > .note'), { timeout: 25000 });
    assert.equal(await page.locator('.download-transfer').count(), 1);
    console.log('Temporary HTTP 530 outage: activity polling recovered automatically without another click.');
    const remove = page.getByRole('button', { name: 'Remove Akira from downloads', exact: true });
    await page.locator('.download-transfer').hover();
    await remove.click();
    await page.getByRole('button', { name: 'Keep download', exact: true }).click();
    assert.equal(deleteCalls, 0);
    await page.screenshot({ path: path.join(repo, 'test-results/download-cards.png') });
    await page.locator('.download-transfer').hover();
    await remove.click();
    await page.getByRole('button', { name: 'Remove download', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.download-transfer').length === 0);
    assert.equal(deleteCalls, 1);
    await page.getByRole('button', { name: 'Remove Old download from downloads', exact: true }).focus();
    await page.getByRole('button', { name: 'Remove Old download from downloads', exact: true }).click();
    await page.getByRole('button', { name: 'Remove download', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.xfer').length === 0);
    assert.equal(deleteCalls, 1);
    assert.deepEqual(await page.evaluate(() => window.matro.downloadJobs('local')), []);
    assert.deepEqual(errors, []);
    console.log('Electron UI: banners loaded; cancel preserved download; remove kept files; stale entry dismissed; no renderer errors.');
  } finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });





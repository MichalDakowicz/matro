const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('overlapping large progress saves work on a slow connection', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/state') {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      await new Promise(resolve => setTimeout(resolve, 500));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    } else if (['/adapter.js', '/http.js', '/dom.js'].includes(req.url)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await fs.readFile(path.join(__dirname, '../apps/web/web', req.url.slice(1))));
    } else res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Network regression</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-network-'));
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_WEB_URL: `http://127.0.0.1:${server.address().port}` }; delete env.ELECTRON_RUN_AS_NODE;
  let browser;
  try {
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow(); await page.waitForLoadState();
    const results = await page.evaluate(async () => {
      const { createAdapter } = await import('/adapter.js');
      const { matro } = createAdapter({ user: { id: 1, username: 'viewer', role: 'viewer' } });
      const state = { progress: {}, queue: [], markers: { episode: [{ type: 'intro', start: 30, end: 90, source: 'manual' }, { type: 'outro', start: 300, end: 330, source: 'automatic' }] }, preferences: { padding: 'x'.repeat(42000) } };
      const baseline = await Promise.allSettled([1, 2, 3].map(() => fetch('/api/state', { method: 'PUT', body: JSON.stringify(state), keepalive: true })));
      const normal = await Promise.all([matro.save(state), matro.save(state), matro.save(state)].map(p => p.then(() => 'saved', e => e.message)));
      const options = [], originalFetch = window.fetch;
      window.fetch = (url, init) => { options.push(init.keepalive); return originalFetch(url, init); };
      try {
        await matro.save({ ...state, preferences: {} }, { keepalive: true });
        await matro.save({ ...state, preferences: { padding: '€'.repeat(22000) } }, { keepalive: true });
      } finally { window.fetch = originalFetch; }
      return { baseline: baseline.map(r => r.status), normal, options };
    });
    expect(results.baseline).toContain('rejected');
    expect(results.normal).toEqual(['saved', 'saved', 'saved']);
    expect(results.options).toEqual([true, false]);
    expect(requests.slice(-5).every(body => body.markers.episode.length === 1 && body.markers.episode[0].source === 'manual')).toBe(true);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
});

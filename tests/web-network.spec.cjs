const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function withWebPage(run) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/state') {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      await new Promise(resolve => setTimeout(resolve, 500));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    } else if (req.url === '/packages/browser-ui/recovery.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await fs.readFile(path.join(__dirname, '..', req.url.slice(1))));
    } else if (['/adapter.js', '/http.js', '/dom.js', '/offline.js', '/offline-store.js', '/movie-requests.js'].includes(req.url)) {
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
    await run(page, requests);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
}

test('overlapping large progress saves work on a slow connection', async () => {
  await withWebPage(async (page, requests) => {
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
    expect(requests.slice(-5).every(body => !Object.hasOwn(body, 'markers'))).toBe(true);
  });
});

test('browser migrates legacy offline saves and checkpoints only for an eligible account', async () => {
  await withWebPage(async page => {
    const result = await page.evaluate(async () => {
      const { createOffline, lastOfflineUser, migrateLegacyScope } = await import('/offline.js');
      const { createRecovery, recoveryPrefix } = await import('/packages/browser-ui/recovery.js');
      const identity = { id: 7, username: 'viewer', role: 'viewer' };
      const replacement = { ...identity, accountKey: 'replacement' };
      const user = { ...identity, accountKey: 'original', legacyScope: true };
      const from = 'account:7:viewer', to = 'account-v2:original';
      const checkpoint = { position: 25, duration: 100, updated: 100 };
      const pending = { progress: { clip: checkpoint } };
      async function seed(name, storeName, records) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(name, 1);
          request.onupgradeneeded = () => request.result.createObjectStore(storeName);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite'), store = tx.objectStore(storeName);
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
            for (const [key, value] of Object.entries(records)) store.put(value, key);
          });
        } finally { db.close(); }
      }
      await seed('matro-saved-media', 'files', {
        'active-account-scope': from + ':',
        [from + ':library']: { user: identity, items: [{ id: 'clip' }] },
        [from + ':meta:clip']: { id: 'clip', complete: true },
        [from + ':pending']: pending,
        [from + ':meta:newer']: { id: 'newer', complete: false },
        [to + ':meta:newer']: { id: 'newer', complete: true }
      });
      await seed('matro-playback-recovery', 'checkpoints', { [recoveryPrefix(from) + 'durable']: checkpoint });
      localStorage.setItem(recoveryPrefix(from) + 'clip', JSON.stringify(checkpoint));

      await migrateLegacyScope(replacement);
      const replacementSaves = await createOffline(replacement).store.list();
      const oldSession = await lastOfflineUser();
      const oldRecovery = localStorage.getItem(recoveryPrefix(from) + 'clip');

      await migrateLegacyScope(user);
      await migrateLegacyScope(user);
      const offline = createOffline(user);
      const library = await offline.library();
      const recovered = await createRecovery(() => localStorage, to).restore({}, ['clip', 'durable']);
      const older = await createRecovery(() => localStorage, from).restore({}, ['clip', 'durable']);
      return { replacementSaves, oldSession, oldRecovery: JSON.parse(oldRecovery), user: await lastOfflineUser(),
        library, saves: await offline.store.list(), recovered: recovered.progress, older: older.progress };
    });
    const checkpoint = { position: 25, duration: 100, updated: 100 };
    expect(result.replacementSaves).toEqual([]);
    expect(result.oldSession).toBeNull();
    expect(result.oldRecovery).toEqual(checkpoint);
    expect(result.user).toMatchObject({ accountKey: 'original', legacyScope: true });
    expect(result.library.user).toEqual(result.user);
    expect(result.library.items).toEqual([{ id: 'clip' }]);
    expect(result.library.progress).toEqual({ clip: checkpoint });
    expect(result.saves).toEqual([{ id: 'clip', complete: true }, { id: 'newer', complete: true }]);
    expect(result.recovered).toEqual({ clip: checkpoint, durable: checkpoint });
    expect(result.older).toEqual({});
  });
});

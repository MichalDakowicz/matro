const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function withWebPage(respond, run) {
  const server = http.createServer(async (req, res) => {
    if (['/adapter.js', '/http.js', '/dom.js', '/offline.js', '/offline-store.js', '/movie-requests.js'].includes(req.url)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await fs.readFile(path.join(__dirname, '../apps/web/web', req.url.slice(1))));
    } else if (['/packages/browser-ui/recovery.js', '/packages/core/client/watch-progress.js', '/packages/core/client/quality.js'].includes(req.url)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await fs.readFile(path.join(__dirname, '..', req.url.slice(1))));
    } else if (req.url.startsWith('/api/')) await respond(req, res);
    else res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Network regression</title><div id="toast"></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-network-'));
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_WEB_URL: `http://127.0.0.1:${server.address().port}` }; delete env.ELECTRON_RUN_AS_NODE;
  let browser;
  try {
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow(); await page.waitForLoadState();
    await run(page);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
}

test('overlapping large progress saves work on a slow connection', async () => {
  const requests = [];
  await withWebPage(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    await new Promise(resolve => setTimeout(resolve, 500));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  }, async page => {
    const results = await page.evaluate(async () => {
      const { createAdapter } = await import('/adapter.js');
      const { matro } = createAdapter({ user: { id: 1, username: 'viewer', role: 'viewer' } });
      const state = { progress: { ['x'.repeat(42000)]: { position: 1, duration: 20, updated: 1 } }, queue: ['stale'], markers: { episode: [{ type: 'intro', start: 30, end: 90, source: 'manual' }] }, preferences: { autoplay: false } };
      const baseline = await Promise.allSettled([1, 2, 3].map(() => fetch('/api/state', { method: 'PUT', body: JSON.stringify(state), keepalive: true })));
      const normal = await Promise.all([matro.save(state), matro.save(state), matro.save(state)].map(p => p.then(() => 'saved', e => e.message)));
      const options = [], originalFetch = window.fetch;
      window.fetch = (url, init) => { options.push(init.keepalive); return originalFetch(url, init); };
      try {
        await matro.save(state, { keepalive: true });
        await matro.save({ ...state, progress: { ['€'.repeat(22000)]: { position: 1, duration: 20, updated: 1 } } }, { keepalive: true });
      } finally { window.fetch = originalFetch; }
      return { baseline: baseline.map(r => r.status), normal, options };
    });
    expect(results.baseline).toContain('rejected');
    expect(results.normal).toEqual(['saved', 'saved', 'saved']);
    expect(results.options).toEqual([true, false]);
    expect(requests.slice(-5).every(body => Object.keys(body).join() === 'progress')).toBe(true);
  });
});

test('browser migrates legacy offline saves and checkpoints only for an eligible account', async () => {
  await withWebPage(() => {}, async page => {
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

test('reloading resumes both preparing and waiting episodes in an offline save batch', async () => {
  const ids = ['one', 'two', 'three'], requested = new Set();
  const user = { id: 1, username: 'viewer', role: 'viewer' };
  let preparing = true;
  await withWebPage((req, res) => {
    const json = body => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    if (req.url === '/api/library') return json({ user, items: ids.map(id => ({ id, title: id })), metadata: {}, progress: {} });
    const [, id, route] = req.url.match(/^\/api\/items\/([^/]+)\/(.+)$/) || [];
    if (route === 'info') return json({ duration: 1, audio: [], embedded: [], uploaded: [] });
    if (route === 'offline') {
      requested.add(id);
      return json(preparing ? { state: 'preparing', progress: .2 } : { state: 'ready', size: 1, version: '1', type: 'video/mp4' });
    }
    if (route === 'offline/file?version=1') return res.writeHead(206, { 'Content-Range': 'bytes 0-0/1' }).end('x');
    res.writeHead(404).end();
  }, async page => {
    const load = () => page.evaluate(async user => {
      const { createAdapter } = await import('/adapter.js');
      window.adapter = createAdapter({ user });
      await window.adapter.matro.load();
    }, user);
    await load();
    await page.evaluate(ids => { void window.adapter.matro.offlineSaveMany(ids).catch(() => {}); }, ids);
    await expect.poll(() => [...requested].sort()).toEqual(['one', 'two']);
    const state = () => page.evaluate(async () => Object.fromEntries((await window.adapter.offline.store.list()).map(({ id, state }) => [id, state])));
    await expect.poll(state).toEqual({ one: 'preparing', two: 'preparing', three: 'queued' });
    preparing = false;
    await page.reload();
    await load();
    await expect.poll(state).toEqual({ one: 'complete', two: 'complete', three: 'complete' });
  });
});

test('web uploads settle on a proxy rejection, connection failure, abort and timeout', async () => {
  await withWebPage((req, res) => {
    if (req.url.endsWith('proxy.mkv')) res.writeHead(413, { 'Content-Type': 'text/html' }).end('<h1>Payload too large</h1>');
    else if (req.url.endsWith('failed.mkv')) req.socket.destroy();
  }, async page => {
    const messages = await page.evaluate(async () => {
      const { createAdapter } = await import('/adapter.js');
      const { matro } = createAdapter({ user: { id: 1, username: 'head', role: 'admin' } });
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (file) {
        if (file.name === 'timeout.mkv') this.timeout = 25;
        send.call(this, file);
        if (file.name === 'abort.mkv') setTimeout(() => this.abort(), 25);
      };
      try {
        return await Promise.all(['proxy.mkv', 'failed.mkv', 'abort.mkv', 'timeout.mkv'].map(async name => {
          try { await matro.importDrop([new File(['x'], name)]); return 'uploaded'; }
          catch (error) { return error.message; }
        }));
      } finally { XMLHttpRequest.prototype.send = send; }
    });
    expect(messages).toEqual([
      'Could not upload proxy.mkv (HTTP 413).', 'Upload of failed.mkv failed (connection lost).',
      'Upload of abort.mkv was canceled.', 'Upload of timeout.mkv timed out.',
    ]);
  });
});

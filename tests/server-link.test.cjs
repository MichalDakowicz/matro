const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { candidates, connect, createServerLink, signIn } = require('../electron/server-link.cjs');

const listen = handler => new Promise(resolve => { const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(server)); });

test('public hostnames try https first, LAN addresses http first', () => {
  assert.deepEqual(candidates('matro.dakowicz.xyz/'), ['https://matro.dakowicz.xyz', 'http://matro.dakowicz.xyz']);
  assert.deepEqual(candidates(' 192.168.100.6:8484 '), ['http://192.168.100.6:8484', 'https://192.168.100.6:8484']);
  assert.deepEqual(candidates('http://matro.local:8484//'), ['http://matro.local:8484']);
  assert.deepEqual(candidates('  '), []);
});

test('connect finds a Matro server by its status route', async () => {
  const server = await listen((req, res) => {
    if (req.url === '/api/status' && req.headers['x-matro'] === '1') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ setup: false, user: null })); } else { res.statusCode = 404; res.end('no'); }
  });
  try {
    const address = `127.0.0.1:${server.address().port}`;
    assert.deepEqual(await connect(address), { url: `http://${address}`, setup: false });
  } finally { server.close(); }
});

test('connect rejects something that is not a Matro server', async () => {
  const server = await listen((req, res) => res.end('<html>hello</html>'));
  try {
    await assert.rejects(connect(`http://127.0.0.1:${server.address().port}`), /Couldn't reach a Matro server/);
    await assert.rejects(connect(''), /Enter your server address/);
  } finally { server.close(); }
});

test('the saved link round-trips, keeps the mode switch, and clears', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-link-'));
  const link = createServerLink(dir);
  assert.equal(await link.get(), null);
  await link.set({ url: 'http://192.168.1.5:8484', enabled: true });
  assert.deepEqual(await createServerLink(dir).get(), { url: 'http://192.168.1.5:8484', enabled: true });
  await link.set({ url: 'http://192.168.1.5:8484', enabled: false });
  assert.deepEqual(await link.get(), { url: 'http://192.168.1.5:8484', enabled: false });
  await link.clear();
  assert.equal(await link.get(), null);
  await fs.writeFile(path.join(dir, 'server.json'), '{"url":"file:///etc/passwd"}');
  assert.equal(await link.get(), null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('signIn posts credentials with the x-matro header and surfaces the server error', async () => {
  const seen = [];
  const server = await listen((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
      const { username, password } = JSON.parse(body); seen.push([req.method, req.url, req.headers['x-matro']]);
      res.setHeader('content-type', 'application/json');
      if (password === 'right') res.end(JSON.stringify({ user: { id: 1, username, role: 'head' } })); else { res.statusCode = 401; res.end(JSON.stringify({ error: 'Wrong username or password.' })); }
    });
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await signIn(base, 'ann', 'right')).username, 'ann');
    await assert.rejects(signIn(base, 'ann', 'wrong'), /Wrong username or password/);
    assert.deepEqual(seen[0], ['POST', '/api/login', '1']);
  } finally { server.close(); }
});

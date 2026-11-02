const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { candidates, connect, createServerLink, sameOrigin } = require('../electron/server-link.cjs');

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

test('the saved link round-trips and clears', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-link-'));
  const link = createServerLink(dir);
  assert.equal(await link.get(), null);
  await link.set('http://192.168.1.5:8484');
  assert.equal(await createServerLink(dir).get(), 'http://192.168.1.5:8484');
  await link.clear();
  assert.equal(await link.get(), null);
  await fs.writeFile(path.join(dir, 'server.json'), '{"url":"file:///etc/passwd"}');
  assert.equal(await link.get(), null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('only the linked origin stays in the window', () => {
  assert.equal(sameOrigin('http://a:8484', 'http://a:8484/x?y=1'), true);
  assert.equal(sameOrigin('http://a:8484', 'https://evil.example/'), false);
  assert.equal(sameOrigin('http://a:8484', 'not a url'), false);
});

test('offline support: only http origins get the secure-origin switch, and the failure page escapes the address', () => {
  const { insecureOrigin, failurePage, savedUrlSync } = require('../electron/server-link.cjs');
  assert.equal(insecureOrigin('http://192.168.1.5:8484/x'), 'http://192.168.1.5:8484');
  assert.equal(insecureOrigin('https://matro.example.com'), null);
  assert.equal(insecureOrigin('nonsense'), null);
  const page = decodeURIComponent(failurePage('http://a/"><script>x</script>').split(',')[1]);
  assert.ok(!page.includes('<script>') && page.includes('Try again'));
  assert.equal(savedUrlSync(path.join(os.tmpdir(), 'matro-no-such-dir')), null);
});

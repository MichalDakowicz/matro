const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createInterface } = require('node:readline');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { SSHMedia, normalize, rootFor } = require('../electron/ssh-media.cjs');

const config = { host: '192.168.100.6', user: 'michu', port: 22, directory: '/mnt/media' };
function fakeSSH({ fail = false } = {}) {
  const calls = [], children = [], bytes = Buffer.from('0123456789');
  const uploads = new Map();
  const spawnSSH = (binary, args) => {
    calls.push({ binary, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => { child.emit('close', 0); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); };
    createInterface({ input: child.stdin }).on('line', line => {
      const q = JSON.parse(line);
      const answer = value => child.stdout.write(JSON.stringify({ id: q.id, ...value }) + '\n');
      if (fail) { child.stderr.write('Permission denied (publickey).'); child.kill(); return; }
      if (q.path.includes('missing')) { answer({ error: 'No such file' }); return; }
      if (q.op === 'stat') answer({ result: { size: bytes.length, mtimeMs: 123, file: !!q.path, directory: !q.path } });
      if (q.op === 'list') answer({ result: [{ name: 'Movie space.mkv', file: true, directory: false }, { name: 'Movie space.en.srt', file: true, directory: false }, { name: 'Shows', file: false, directory: true }] });
      if (q.op === 'read') answer({ result: bytes.subarray(q.offset, q.offset + q.length).toString('base64') });
      if (q.op === 'subtitle') {
        if (uploads.has(q.path)) answer({ error: 'File exists', code: 'EEXIST' });
        else { uploads.set(q.path, Buffer.from(q.data, 'base64')); answer({ result: true }); }
      }
    });
    children.push(child); return child;
  };
  return { spawnSSH, calls, children, uploads };
}

test('SSH settings validate addresses, stable roots, paths and options', () => {
  assert.deepEqual(normalize(config), { ...config, identity: '' });
  assert.equal(rootFor(config), rootFor({ ...config, directory: '/mnt/media/' }));
  for (const change of [{ host: '-oProxyCommand=evil' }, { user: 'a;bad' }, { port: 0.5 }, { port: 65536 }, { directory: 'media' }, { directory: '/mnt\nmedia' }, { identity: 'relative-key' }]) assert.throws(() => normalize({ ...config, ...change }));
});

test('SSH uses key authentication, confines virtual paths and returns filesystem entries', async () => {
  const fake = fakeSSH(), media = new SSHMedia(fake), root = media.register(config);
  try {
    assert.equal(media.label(path.join(root, 'Movie space.mkv')), 'michu@192.168.100.6:/mnt/media/Movie space.mkv');
    assert.equal(media.isRemote(path.join(root + '-other', 'file')), false);
    assert.throws(() => media.resolve(root + path.sep + '..' + path.sep + 'escape'));
    const entries = await media.readdir(root, { withFileTypes: true });
    assert.equal(entries[0].isFile(), true); assert.equal(entries[2].isDirectory(), true);
    assert.equal((await media.stat(path.join(root, 'Movie space.mkv'))).size, 10);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].binary, 'ssh');
    assert.ok(fake.calls[0].args.includes('BatchMode=yes'));
    assert.ok(fake.calls[0].args.includes('StrictHostKeyChecking=yes'));
    await assert.rejects(media.stat(path.join(root, 'missing.mkv')), /No such file/);
    media.remove(root); media.register(config);
    assert.equal((await media.stat(root)).isDirectory(), true);
    assert.equal(fake.calls.length, 2);
  } finally { media.close(); }
});

test('SSH byte gateway supports seek ranges, suffixes, HEAD and rejects invalid requests', async () => {
  const media = new SSHMedia(fakeSSH()), root = media.register(config);
  try {
    const url = await media.input(path.join(root, 'Movie space.mkv'));
    let res = await fetch(url, { headers: { Range: 'bytes=3-6' } });
    assert.equal(res.status, 206); assert.equal(res.headers.get('content-range'), 'bytes 3-6/10'); assert.equal(await res.text(), '3456');
    res = await fetch(url, { headers: { Range: 'bytes=-3' } }); assert.equal(await res.text(), '789');
    res = await fetch(url, { method: 'HEAD' }); assert.equal(res.headers.get('content-length'), '10'); assert.equal(await res.text(), '');
    for (const range of ['bytes=99-', 'bytes=7-3', 'bytes=-', 'bytes=0-1,4-5']) { res = await fetch(url, { headers: { Range: range } }); assert.equal(res.status, 416); }
    res = await fetch(url.replace(/[^/]+$/, 'wrong-token')); assert.equal(res.status, 404);
    res = await fetch(url); assert.equal(await res.text(), '0123456789');
    const args = await media.args(['-protocol_whitelist', 'file,pipe,crypto', '-i', path.join(root, 'Movie space.mkv')]);
    assert.equal(args[1], 'file,pipe,crypto,http,tcp'); assert.equal(args[3], url);
    media.remove(root); res = await fetch(url); assert.equal(res.status, 404);
  } finally { media.close(); }
});

test('SSH failures reject requests and a later operation retries the connection', async () => {
  const failed = fakeSSH({ fail: true }), media = new SSHMedia(failed), root = media.register(config);
  try {
    await assert.rejects(media.stat(root), /Permission denied/);
    media.spawnSSH = fakeSSH().spawnSSH;
    assert.equal((await media.stat(root)).isDirectory(), true);
  } finally { media.close(); }
});

test('subtitle uploads preserve bytes, never overwrite and reject unsupported or oversized files', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-ssh-subtitle-'));
  const fake = fakeSSH(), media = new SSHMedia(fake), root = media.register(config);
  const local = path.join(temp, 'download.en.srt'), target = path.join(root, 'Movie.en.srt');
  const text = '1\n00:00:00,000 --> 00:00:02,000\nZażółć gęślą jaźń\n';
  try {
    await fs.writeFile(local, text);
    await media.copySubtitle(local, target, fs.constants.COPYFILE_EXCL);
    assert.equal(fake.uploads.get('Movie.en.srt').toString('utf8'), text);
    await assert.rejects(media.copySubtitle(local, target, fs.constants.COPYFILE_EXCL), { code: 'EEXIST' });
    await assert.rejects(media.copySubtitle(local, path.join(root, 'Movie.mkv'), fs.constants.COPYFILE_EXCL), /subtitle files only/);
    await assert.rejects(media.copySubtitle(local, target, 0), /subtitle files only/);
    const large = path.join(temp, 'oversized.srt');
    const file = await fs.open(large, 'w'); await file.truncate(16 * 1024 * 1024 + 1); await file.close();
    await assert.rejects(media.copySubtitle(large, target, fs.constants.COPYFILE_EXCL), /16 MiB/);
  } finally { media.close(); await fs.rm(temp, { recursive: true, force: true }); }
});

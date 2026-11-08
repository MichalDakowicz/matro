const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream');
const { once } = require('node:events');
const { argumentsFor, selectEncoder, canCopyVideo, SOFTWARE } = require('./encoding.cjs');

// FFmpeg writes ahead to disk independently of the network/player. Slow clients, pauses and
// disconnected requests never block encoding. Only complete files survive a process restart.
function createPlaybackCache({ ffmpeg, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matro-playback-')), maxJobs = 2, maxBytes = Math.max(1, Number(process.env.MATRO_PLAYBACK_CACHE_GB) || 32) * 1024 ** 3, stallMs = 45000, startupSeconds = 8, stat = fsp.stat, spawnProcess = spawn } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const entries = new Map();
  const owners = new Map();
  const hardwareFailures = new Set();
  let closed = false;
  function prune() {
    const files = fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}\.mp4$/.test(n)).map(name => ({ name, ...fs.statSync(path.join(dir, name)) })).sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files) {
      if (total <= maxBytes) break;
      const entry = entries.get(f.name.slice(0, -4));
      if (entry?.readers || entry?.owners?.size || (entry && !entry.done)) continue;
      fs.unlinkSync(path.join(dir, f.name)); entries.delete(f.name.slice(0, -4)); total -= f.size;
    }
  }
  function assign(owner, entry) {
    if (!owner) return entry;
    const previous = owners.get(owner);
    if (previous && previous !== entry) {
      previous.owners?.delete(owner);
      if (!previous.done && !previous.error && !previous.owners?.size) {
        previous.error = Error('Playback preparation was replaced by a new position.'); previous.child?.kill();
      }
    }
    if (entry) { (entry.owners ||= new Set()).add(owner); owners.set(owner, entry); }
    else owners.delete(owner);
    return entry;
  }
  async function get(options, owner) {
    if (closed) throw Error('Playback service is closed.');
    const source = await stat(options.file);
    const key = createHash('sha256').update(JSON.stringify([2, options.file, source.size, source.mtimeMs, options.offset, options.audio, options.burn, options.delay, options.info.video])).digest('hex');
    if (entries.has(key)) {
      const existing = entries.get(key);
      if (!existing.error) return assign(owner, existing);
      if (!existing.readers) { await existing.finished; entries.delete(key); await fsp.rm(existing.file, { force: true }); }
      else throw existing.error;
    }
    const final = path.join(dir, key + '.mp4');
    if (fs.existsSync(final)) {
      const entry = { file: final, size: fs.statSync(final).size, done: true, readers: 0, used: Date.now() };
      entries.set(key, entry); return assign(owner, entry);
    }
    assign(owner, null);
    if ([...entries.values()].filter(e => !e.done && !e.error).length >= maxJobs) {
      const error = Error('Playback preparation is busy. Retry shortly.'); error.status = 503; throw error;
    }
    prune();
    const entry = { file: path.join(dir, key + '.part'), size: 0, done: false, readers: 0, used: Date.now(), error: null, child: null };
    entries.set(key, entry);
    const render = async () => {
      const encoder = canCopyVideo(options.info, options.burn, options.offset) || !options.info.video || hardwareFailures.has(key) ? SOFTWARE : await selectEncoder(ffmpeg);
      if (closed || entry.error) return;
      async function attempt(selected) {
        await fsp.rm(entry.file, { force: true }); entry.size = 0; entry.preparedSeconds = 0;
        if (closed || entry.error) throw entry.error || Error('Playback service is closed.');
        return new Promise((resolve, reject) => {
          const child = spawnProcess(ffmpeg, argumentsFor(options, selected), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          entry.child = child;
          let lastOutput = Date.now(), errorText = '', progressText = '', failed;
          const timeout = setInterval(() => {
            if (Date.now() - lastOutput > stallMs) { failed = Error('Media preparation stopped responding.'); child.kill(); }
          }, 1000); timeout.unref();
          child.stderr.on('data', data => {
            errorText = (errorText + data).slice(-2000);
            progressText += data;
            const lines = progressText.split('\n'); progressText = lines.pop().slice(-2000);
            for (const line of lines) {
              const match = /^out_time_us=(\d+)\r?$/.exec(line);
              if (match) entry.preparedSeconds = Number(match[1]) / 1e6;
            }
          });
          child.stdout.on('data', data => {
            lastOutput = Date.now();
            if (output.bytesWritten + output.writableLength + data.length > maxBytes) { failed = Error('Prepared media exceeds the playback cache limit.'); child.kill(); }
          });
          const output = fs.createWriteStream(entry.file);
          output.on('error', error => { failed = error; child.kill(); });
          child.stdout.on('error', error => { failed = error; output.end(); child.kill(); });
          child.stdout.pipe(output);
          // File size is measured from disk before reading; stdout bytes may still be queued to the writer.
          child.once('error', error => { failed = error; });
          child.once('close', async code => {
            clearInterval(timeout);
            try {
              // 'finish' only flushes writes; Windows cannot rename the cache
              // file until the writer's file descriptor has actually closed.
              if (!output.closed) await once(output, 'close');
              if (failed || code !== 0) throw failed || Error(errorText || 'Media preparation failed.');
              resolve();
            } catch (error) { reject(error); }
          });
        });
      }
      try { await attempt(encoder); }
      catch (error) {
        // No bytes have been exposed yet: retry a hardware initialization failure in software.
        if (encoder !== SOFTWARE) hardwareFailures.add(key);
        if (encoder !== SOFTWARE && !entry.exposed && !closed && !entry.error) await attempt(SOFTWARE);
        else throw error;
      }
      await fsp.rename(entry.file, final); entry.file = final; entry.size = (await fsp.stat(final)).size; entry.done = true; prune();
    };
    entry.finished = render().catch(error => { entry.error = error; entry.child?.kill(); }).finally(async () => {
      if (entry.error && !entry.readers) await fsp.rm(entry.file, { force: true }).catch(() => {});
    });
    return assign(owner, entry);
  }
  async function serve(req, res, options, headers = {}, owner) {
    const entry = await get(options, owner); entry.readers++; entry.used = Date.now();
    try {
      let position = 0, handle;
      try {
        while (!res.destroyed && !closed) {
          if (entry.error) throw entry.error;
          // Keep a media-time cushion on disk before exposing the first fragment.
          // Starting on the MP4 header alone repeatedly drains the player during
          // short disk/network slowdowns, especially while torrents are writing.
          if (!res.headersSent && !entry.done && (entry.preparedSeconds || 0) < startupSeconds) {
            await new Promise(resolve => setTimeout(resolve, 100)); continue;
          }
          if (!handle) { try { handle = await fsp.open(entry.file, 'r'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
          const size = handle ? (await handle.stat()).size : 0;
          entry.size = size;
          if (size > position) {
            if (!res.headersSent) {
              if (entry.done) {
                await handle.close(); handle = null;
                return await serveFile(req, res, entry.file, size, headers);
              }
              res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store', ...headers });
            }
            entry.exposed = true;
            const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, size - position));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position); position += bytesRead;
            if (!res.write(buffer.subarray(0, bytesRead))) {
              await new Promise(resolve => { const done = () => { res.off('drain', done); res.off('close', done); resolve(); }; res.once('drain', done); res.once('close', done); });
            }
          } else if (entry.done) { res.end(); return; }
          else await new Promise(resolve => setTimeout(resolve, 100));
        }
      } finally { await handle?.close(); }
    } catch (error) {
      if (res.headersSent) res.destroy(error);
      else { res.writeHead(error.status || 502, { 'Content-Type': 'text/plain', ...headers }).end('Playback preparation failed. Retry playback.'); }
    } finally {
      entry.readers--;
      if (entry.error && !entry.readers) { await entry.finished; await fsp.rm(entry.file, { force: true }).catch(() => {}); }
    }
  }
  return {
    get, serve,
    release(owner) { assign(owner, null); },
    promote(from, to) {
      const entry = owners.get(from);
      assign(to, entry);
      entry?.owners?.delete(from); owners.delete(from);
    },
    close() { closed = true; for (const entry of entries.values()) { entry.child?.kill(); if (!entry.done) void fsp.rm(entry.file, { force: true }).catch(() => {}); } }
  };
}
async function serveFile(req, res, file, size, extra = {}) {
  if (req.aborted || res.destroyed || res.writableEnded) return;
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!m || (!m[1] && !m[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    if (!m[1]) start = Math.max(0, size - Number(m[2]));
    else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    if (start > end || start >= size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    status = 206;
  }
  res.writeHead(status, { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}), ...extra });
  if (req.method === 'HEAD') { res.end(); return; }
  await new Promise(resolve => pipeline(fs.createReadStream(file, { start, end }), res, resolve));
}
module.exports = { createPlaybackCache, serveFile };

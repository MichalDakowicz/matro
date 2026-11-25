const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream');
const { once } = require('node:events');
const { argumentsFor, selectEncoder, canCopyVideo, QUALITIES, outputChannels, supportsToneMap, SOFTWARE } = require('./encoding.cjs');

// FFmpeg writes ahead to disk independently of the network/player. Slow clients, pauses and
// disconnected requests never block encoding. Only complete files survive a process restart.
function createPlaybackCache({ ffmpeg, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matro-playback-')), maxJobs = 2, maxBytes = Math.max(1, Number(process.env.MATRO_PLAYBACK_CACHE_GB) || 32) * 1024 ** 3, stallMs = 45000, startupSeconds = 8, recentMs = 120000, ownerTtlMs = 0, stat = fsp.stat, spawnProcess = spawn } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const entries = new Map();
  const owners = new Map();
  const hardwareFailures = new Set();
  let closed = false, overLimit = false;
  function prune() {
    const now = Date.now(), files = [];
    for (const name of fs.readdirSync(dir)) {
      if (!/^[a-f0-9]{64}\.mp4$/.test(name)) continue;
      const key = name.slice(0, -4), file = path.join(dir, name);
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (!stat) continue;
      const entry = entries.get(key);
      files.push({ key, file, size: stat.size, entry, used: entry?.used ?? stat.mtimeMs });
    }
    files.sort((a, b) => a.used - b.used);
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files) {
      if (total <= maxBytes) break;
      const { entry } = f;
      if (now - f.used < recentMs || entry?.readers || entry?.owners?.size || entry?.pinnedUntil > now || (entry && !entry.done)) continue;
      try { fs.unlinkSync(f.file); } catch (error) { if (error.code !== 'ENOENT') continue; }
      entries.delete(f.key); total -= f.size;
    }
    overLimit = total > maxBytes;
  }
  function cancelUnused(entry) {
    if (!entry.done && !entry.error && !entry.readers && !entry.owners?.size && !entry.keepPreparing) {
      entry.error = Error('Playback preparation was replaced by a new position.');
      entry.child?.kill();
    }
  }
  function assign(owner, entry) {
    if (!owner) return entry;
    const previous = owners.get(owner)?.entry;
    if (previous && previous !== entry) {
      previous.owners?.delete(owner);
      cancelUnused(previous);
    }
    if (entry) {
      (entry.owners ||= new Set()).add(owner);
      owners.set(owner, { entry, expires: ownerTtlMs ? Date.now() + ownerTtlMs : Infinity });
    } else {
      owners.delete(owner);
    }
    return entry;
  }
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [owner, lease] of owners) if (lease.expires <= now) assign(owner, null);
    if (overLimit) prune();
  }, 30000);
  sweep.unref();

  async function get(options, owner, { pinMs = 0, read = false } = {}) {
    if (closed) throw Error('Playback service is closed.');
    const source = await stat(options.file);
    const toneMap = !!options.info.video?.hdr && await supportsToneMap(ffmpeg);
    if (closed) throw Error('Playback service is closed.');
    const use = entry => {
      entry.used = Date.now();
      if (pinMs) {
        entry.keepPreparing = true;
        entry.pinnedUntil = Math.max(entry.pinnedUntil || 0, entry.used + pinMs);
      }
      if (read) entry.readers++;
      return assign(owner, entry);
    };
    const identity = [3, options.file, source.size, source.mtimeMs, options.offset, options.audio, options.burn, options.delay, options.info.video];
    if (QUALITIES[options.quality]) identity.push(options.quality);
    if (outputChannels(options.info, options.audio, options.channels) === 6) identity.push('aac-5.1');
    if (toneMap) identity.push('hdr-sdr');
    if (options.audioDelay) identity.push(options.audioDelay);
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    while (entries.has(key)) {
      const existing = entries.get(key);
      if (!existing.error) return use(existing);
      if (existing.readers) throw existing.error;
      await existing.finished;
      if (entries.get(key) === existing) entries.delete(key);
    }
    const final = path.join(dir, key + '.mp4');
    if (fs.existsSync(final)) {
      const entry = { file: final, size: fs.statSync(final).size, done: true, readers: 0, used: Date.now(), encoder: 'Cached file' };
      entries.set(key, entry); return use(entry);
    }
    assign(owner, null);
    if ([...entries.values()].filter(e => !e.done && !e.error).length >= maxJobs) {
      const error = Error('Playback preparation is busy. Retry shortly.'); error.status = 503; throw error;
    }
    prune();
    const entry = { file: path.join(dir, key + '.part'), size: 0, done: false, readers: 0, used: Date.now(), error: null, child: null };
    entries.set(key, entry);
    const render = async () => {
      const encoder = canCopyVideo(options.info, options.burn, options.offset, options.quality) || !options.info.video || hardwareFailures.has(key) ? SOFTWARE : await selectEncoder(ffmpeg);
      if (closed || entry.error) return;
      async function attempt(selected) {
        await fsp.rm(entry.file, { force: true }); entry.size = 0; entry.preparedSeconds = 0;
        if (closed || entry.error) throw entry.error || Error('Playback service is closed.');
        entry.encoder = canCopyVideo(options.info, options.burn, options.offset) || !options.info.video ? 'AAC' : `${selected[1]} + AAC`;
        return new Promise((resolve, reject) => {
          const child = spawnProcess(ffmpeg, argumentsFor({ ...options, toneMap }, selected), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
      await fsp.rename(entry.file, final); entry.file = final; entry.size = (await fsp.stat(final)).size; entry.done = true; entry.used = Date.now(); prune();
    };
    entry.finished = render().catch(error => { entry.error = error; entry.child?.kill(); }).finally(async () => {
      if (entry.error && !entry.readers) await fsp.rm(entry.file, { force: true }).catch(() => {});
    });
    return use(entry);
  }
  async function serve(req, res, options, headers = {}, owner) {
    const entry = await get(options, owner, { read: true });
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
            if (!res.write(buffer.subarray(0, bytesRead)) && !res.destroyed) {
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
      entry.used = Date.now();
      if (entry.readers === 1 && entry.error) {
        await entry.finished;
        if (entry.readers === 1) await fsp.rm(entry.file, { force: true }).catch(() => {});
      }
      entry.readers--;
      if (entry.owners) cancelUnused(entry);
    }
  }
  return {
    get, serve,
    encoder(owner) { return owners.get(owner)?.entry.encoder ?? null; },
    stats() {
      let bytes = 0;
      for (const name of fs.readdirSync(dir)) {
        if (/^[a-f0-9]{64}\.(mp4|part)$/.test(name)) bytes += fs.statSync(path.join(dir, name), { throwIfNoEntry: false })?.size ?? 0;
      }
      return { active: [...entries.values()].filter(e => !e.done && !e.error).length, capacity: maxJobs, bytes };
    },
    release(owner) { assign(owner, null); },
    renew(owner) {
      const lease = owners.get(owner);
      if (lease && ownerTtlMs) lease.expires = Date.now() + ownerTtlMs;
    },
    promote(from, to) {
      const entry = owners.get(from)?.entry;
      assign(to, entry);
      entry?.owners?.delete(from); owners.delete(from);
    },
    close() { closed = true; clearInterval(sweep); for (const entry of entries.values()) { entry.child?.kill(); if (!entry.done) void fsp.rm(entry.file, { force: true }).catch(() => {}); } }
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

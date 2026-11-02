const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('./config');
const { HttpError, MIME } = require('./http');

const KEEP_DAYS = 7;

// Files people save to watch without a connection. A web-playable file is handed over as it is; anything else is converted once
// to a plain MP4 (moov up front, so the phone can seek it with no server) and kept in data/offline for a few days.
function createOffline(dataDir) {
  const dir = path.join(dataDir, 'offline');
  const jobs = new Map(); // cache file -> { error, child }
  const fileFor = (item, audio) => path.join(dir, `${item.id}-${Math.round(item.mtime || 0)}-${audio ?? 'a'}.mp4`.replace(/[^\w.-]/g, '_'));

  async function sweep() {
    let names; try { names = await fsp.readdir(dir); } catch { return; }
    for (const name of names) {
      const file = path.join(dir, name);
      try { if (Date.now() - (await fsp.stat(file)).mtimeMs > KEEP_DAYS * 864e5 && !jobs.has(file)) await fsp.rm(file); } catch { /* gone already */ }
    }
  }

  function convert(item, info, audio, target) {
    const part = `${target}.part`;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', item.path];
    if (info.video) args.push('-map', '0:v:0', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
    else args.push('-vn');
    args.push('-map', audio === null ? '0:a:0?' : `0:${audio}`, '-c:a', 'aac', '-ac', '2', '-b:a', '160k', '-sn', '-movflags', '+faststart', '-f', 'mp4', part);
    const job = { error: '' };
    jobs.set(target, job);
    const child = spawn(config.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    job.child = child;
    child.stderr.on('data', data => { job.error = (job.error + data).slice(-1500); });
    child.on('error', error => { job.failed = error.message; });
    child.on('close', async code => {
      job.child = null;
      if (code === 0) { try { await fsp.rename(part, target); jobs.delete(target); return; } catch (error) { job.failed = error.message; } }
      job.failed = job.failed || job.error || `ffmpeg exited with ${code}`;
      fsp.rm(part, { force: true }).catch(() => {});
    });
  }

  // { state: 'ready' | 'preparing' | 'failed', file, type, size }. Asking again while it converts just reports progress.
  async function status(item, info, { direct, audio = null }) {
    if (direct) {
      const { size } = await fsp.stat(item.path);
      return { state: 'ready', file: item.path, type: MIME[path.extname(item.path).toLowerCase()] || 'video/mp4', size };
    }
    const target = fileFor(item, audio);
    try { const { size } = await fsp.stat(target); return { state: 'ready', file: target, type: 'video/mp4', size }; } catch { /* not converted yet */ }
    const job = jobs.get(target);
    if (job?.failed) { jobs.delete(target); throw new HttpError(422, 'This file could not be prepared for download.'); }
    if (!job) {
      if ([...jobs.values()].filter(j => j.child).length >= config.maxTranscodes) throw new HttpError(503, 'The server is busy converting other downloads. Try again shortly.');
      await fsp.mkdir(dir, { recursive: true });
      sweep().catch(() => {});
      convert(item, info, audio, target);
    }
    return { state: 'preparing' };
  }

  return { status, close() { for (const job of jobs.values()) job.child?.kill(); } };
}
module.exports = { createOffline };

const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('./config');
const { run } = require('./media');

// Still frames for the seek bar, continue-watching cards and episode thumbnails. Cached on disk by whole second,
// and at most a few extractions run at once so a page of thumbnails cannot starve playback.
function createFrames(limit = 3) {
  const dir = path.join(config.dataDir, 'cache', 'frames');
  let active = 0; const waiting = [], pending = new Map();
  const slot = () => new Promise(resolve => { if (active < limit) { active++; resolve(); } else waiting.push(resolve); });
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };
  return async function frame(item, seconds, width) {
    const second = Math.max(0, Math.floor(seconds)), file = path.join(dir, `${item.id}-${item.mtime}-${width}-${second}.jpg`);
    try { await fs.access(file); return file; } catch { /* not cached yet */ }
    if (pending.has(file)) return pending.get(file);
    const task = (async () => {
      await slot();
      try {
        await fs.mkdir(dir, { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        const extract = args => run(config.ffmpeg, ['-v', 'error', '-nostdin', ...args, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '5', '-f', 'mjpeg', '-y', temporary], { timeout: 30000, encoding: 'buffer' }).catch(() => {});
        const size = () => fs.stat(temporary).then(s => s.size, () => 0);
        // Seeking before the input is fast; a few files only yield a frame when decoded up to the time instead.
        await extract(['-ss', String(second), '-i', item.path]);
        if (!await size()) await extract(['-i', item.path, '-ss', String(second)]);
        if (!await size()) { await fs.rm(temporary, { force: true }); throw new Error('no frame'); }
        await fs.rename(temporary, file);
        return file;
      } finally { release(); }
    })().finally(() => pending.delete(file));
    pending.set(file, task);
    return task;
  };
}
module.exports = { createFrames };

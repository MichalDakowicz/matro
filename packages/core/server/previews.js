const config = require('./config');
const { run } = require('./media');
const { createAssetCache } = require('./asset-cache');

// Still frames for the seek bar, continue-watching cards and episode thumbnails. Cached on disk by whole second,
// and at most a few extractions run at once so a page of thumbnails cannot starve playback.
function createFrames(dataDir = config.dataDir, cache = createAssetCache(dataDir), limit = 3) {
  let active = 0; const waiting = [], pending = new Map();
  const slot = () => new Promise(resolve => { if (active < limit) { active++; resolve(); } else waiting.push(resolve); });
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };
  return async function frame(item, seconds, width) {
    width = width < 240 ? 160 : width < 400 ? 320 : 480;
    const second = Math.max(0, Math.floor(seconds)), file = `${item.id}-${item.mtime}-${width}-${second}.jpg`;
    const cached = await cache.read('frames', file);
    if (cached) return cached;
    if (pending.has(file)) return pending.get(file);
    const task = (async () => {
      await slot();
      try {
        const extract = args => run(config.ffmpeg, ['-v', 'error', '-nostdin', ...args, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '5', '-f', 'mjpeg', 'pipe:1'], { timeout: 30000, encoding: 'buffer' }).catch(() => null);
        // Seeking before the input is fast; a few files only yield a frame when decoded up to the time instead.
        let jpeg = await extract(['-ss', String(second), '-i', item.path]);
        if (!jpeg?.length) jpeg = await extract(['-i', item.path, '-ss', String(second)]);
        if (!jpeg?.length) throw new Error('no frame');
        await cache.write('frames', file, jpeg);
        return jpeg;
      } finally { release(); }
    })().finally(() => pending.delete(file));
    pending.set(file, task);
    return task;
  };
}
module.exports = { createFrames };

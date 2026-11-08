const { execFile } = require('node:child_process');
const { ffmpeg } = require('./media.cjs');
const { remote } = require('./ssh-media.cjs');

// Hover frames decode only the keyframe at or before the time (no decoding forward to the exact frame), which is what
// makes scrubbing quick on long-GOP and 4K files. Library cards keep exact frames. That keyframe is stamped before the
// seek point, so passthrough stops frame-rate sync from dropping it when it is the last one in the file.
async function extract(file, second, keyframe, track) {
  const input = await remote.input(file);
  return new Promise(resolve => {
    const child = execFile(ffmpeg, ['-v', 'error', '-nostdin', '-protocol_whitelist', remote.isRemote(file) ? 'file,pipe,crypto,http,tcp' : 'file,pipe,crypto', ...(keyframe ? ['-skip_frame', 'nokey', '-noaccurate_seek'] : []), '-ss', String(second), '-i', input,
      ...(keyframe ? ['-fps_mode', 'passthrough'] : []), '-map', '0:v:0', '-frames:v', '1', '-an', '-sn', '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2', '-q:v', '4', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'],
    { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer' }, (error, data) => resolve(error || !data.length ? null : `data:image/jpeg;base64,${data.toString('base64')}`));
    track(child);
  });
}

function createPreviews() {
  const cache = new Map();
  let active = null, closed = false;
  // Hover lane: one decode running, one waiting. A newer hover replaces the waiting one (which resolves undefined) but
  // never kills the running one, so a pointer that keeps moving still gets frames instead of cancelling every decode.
  let running = null, waiting = null, hoverChild = null;
  function remember(key, image) {
    if (!image) return;
    if (cache.size >= 300) cache.delete(cache.keys().next().value);
    cache.set(key, image);
  }
  function pump() {
    if (running || !waiting || closed) return;
    const job = running = waiting; waiting = null;
    const track = child => { hoverChild = child; };
    // Some streams flag no frame as a keyframe; fall back to an exact decode rather than showing nothing.
    extract(job.file, job.second, true, track).then(image => image || (closed ? null : extract(job.file, job.second, false, track))).then(image => {
      hoverChild = null; running = null; remember(job.key, image); job.resolve(image); pump();
    });
  }
  return {
    async frame(file, time, { hover = false } = {}) {
      const second = Math.max(0, Math.floor(time));
      const key = `${file}\0${second}\0${hover ? 'key' : 'exact'}`;
      if (cache.has(key)) return cache.get(key);
      if (hover) {
        if (running?.key === key) return running.promise;
        if (waiting?.key === key) return waiting.promise;
        waiting?.resolve(undefined);
        let resolve; const promise = new Promise(done => { resolve = done; });
        waiting = { key, file, second, resolve, promise }; pump();
        return promise;
      }
      active?.kill();
      let mine; const image = await extract(file, second, false, child => { active = mine = child; });
      if (active === mine) active = null;
      remember(key, image); return image;
    },
    close() { closed = true; active?.kill(); hoverChild?.kill(); waiting?.resolve(undefined); active = hoverChild = waiting = null; cache.clear(); }
  };
}
module.exports = { createPreviews };

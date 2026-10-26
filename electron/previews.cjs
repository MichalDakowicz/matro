const { execFile } = require('node:child_process');
const { ffmpeg } = require('./media.cjs');

function createPreviews() {
  const cache = new Map();
  let active = null;
  return {
    async frame(file, time) {
      const second = Math.max(0, Math.floor(time));
      const key = `${file}\0${second}`;
      active?.kill();
      if (cache.has(key)) return cache.get(key);
      return new Promise(resolve => {
        const child = execFile(ffmpeg, ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe,crypto', '-ss', String(second), '-i', file,
          '-map', '0:v:0', '-frames:v', '1', '-an', '-sn', '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2', '-q:v', '4', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'],
        { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer' }, (error, data) => {
          if (active === child) active = null;
          if (error || !data.length) { resolve(null); return; }
          const image = `data:image/jpeg;base64,${data.toString('base64')}`;
          if (cache.size >= 100) cache.delete(cache.keys().next().value);
          cache.set(key, image); resolve(image);
        });
        active = child;
      });
    },
    close() { active?.kill(); active = null; cache.clear(); }
  };
}
module.exports = { createPreviews };

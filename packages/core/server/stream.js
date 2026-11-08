const path = require('node:path');
const config = require('./config');
const { createPlaybackCache } = require('../playback/cache.cjs');
function createStreams({ dataDir = config.dataDir } = {}) {
  const cache = createPlaybackCache({ ffmpeg: config.ffmpeg, dir: path.join(dataDir, 'playback'), maxJobs: config.maxTranscodes });
  const transcode = async (req, res, { userId, preload = false, file, info, offset, audio, burn, delay = 0 }) => {
    await cache.serve(req, res, { file, input: file, info, offset, audio, burn, delay }, {}, `${userId}:${preload ? 'preload' : 'main'}`);
  };
  transcode.close = () => cache.close();
  transcode.releaseMain = userId => cache.release(`${userId}:main`);
  transcode.stop = (userId, keepPreload = false) => {
    if (keepPreload) cache.promote(`${userId}:preload`, `${userId}:main`);
    else { cache.release(`${userId}:main`); cache.release(`${userId}:preload`); }
  };
  return transcode;
}
module.exports = { createStreams };

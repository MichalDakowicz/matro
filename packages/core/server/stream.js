const path = require('node:path');
const config = require('./config');
const { supportsToneMap } = require('../playback/encoding.cjs');
const { createPlaybackCache } = require('../playback/cache.cjs');
function createStreams({ dataDir = config.dataDir } = {}) {
  const cache = createPlaybackCache({ ffmpeg: config.ffmpeg, dir: path.join(dataDir, 'playback'), maxJobs: config.maxTranscodes, ownerTtlMs: 300000 });
  const transcode = async (req, res, { session, preload = false, file, info, offset, audio, burn, delay = 0, audioDelay = 0, quality = null, channels = 2 }) => {
    await cache.serve(req, res, { file, input: file, info, offset, audio, burn, delay, audioDelay, quality, channels }, {}, `${session}:${preload ? 'preload' : 'main'}`);
  };
  // A download releases its reader between range requests. Keep the same
  // prepared generation available across those gaps and short disconnects.
  transcode.offline = (file, info, { audio, burn, quality, copyAudio }) => cache.get({ file, input: file, info, offset: 0, audio, burn, delay: 0, quality, copyAudio }, null, { pinMs: 600000 });
  transcode.close = () => cache.close();
  transcode.supportsToneMap = () => supportsToneMap(config.ffmpeg);
  transcode.stats = () => cache.stats();
  transcode.encoder = session => cache.encoder(`${session}:main`);
  transcode.releaseMain = session => cache.release(`${session}:main`);
  transcode.renew = session => {
    cache.renew(`${session}:main`); cache.renew(`${session}:preload`);
  };
  transcode.stop = (session, keepPreload = false) => {
    if (keepPreload) cache.promote(`${session}:preload`, `${session}:main`);
    else { cache.release(`${session}:main`); cache.release(`${session}:preload`); }
  };
  return transcode;
}
module.exports = { createStreams };

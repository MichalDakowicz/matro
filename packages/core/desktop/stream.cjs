const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { ffmpeg, probe } = require('./media.cjs');
const { remote, mediaFS } = require('./ssh-media.cjs');
const { createPlaybackCache, serveFile } = require('../playback/cache.cjs');
async function createStreamServer(options = {}) {
  const sessions = new Map();
  const cache = createPlaybackCache({ ffmpeg, stat: mediaFS.stat, ...options });
  let preloadToken = null;
  const server = http.createServer(async (req, res) => {
    const token = new URL(req.url, 'http://127.0.0.1').pathname.slice(1), session = sessions.get(token);
    if (!session || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
    const headers = { 'Access-Control-Allow-Origin': 'matro://app' };
    try {
      const info = session.info || await probe(session.file);
      if (session.direct) { const stat = await mediaFS.stat(session.file); return await serveFile(req, res, session.file, stat.size, { ...headers, 'Content-Type': /\.webm$/i.test(session.file) ? 'video/webm' : 'video/mp4' }); }
      const input = await remote.input(session.file);
      await cache.serve(req, res, { file: session.file, input, offset: session.offset, audio: session.audio, info, burn: session.bitmapSubtitle ?? null, delay: session.subtitleDelay || 0, remote: remote.isRemote(session.file) }, headers, session.slot);
    } catch (error) { if (!res.headersSent) res.writeHead(error.status || 502, headers).end('Media is unavailable. Retry playback.'); else res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    create(session, { preload = false } = {}) {
      if (session.direct && !preload) cache.release('main');
      const token = randomBytes(32).toString('hex');
      for (const old of sessions.keys()) if (preload ? old === preloadToken : old !== preloadToken) sessions.delete(old);
      if (preload) preloadToken = token;
      sessions.set(token, { ...session, slot: preload ? 'preload' : 'main' }); return 'http://127.0.0.1:' + server.address().port + '/' + token;
    },
    stop(keepUrl = null) {
      const keep = keepUrl ? new URL(keepUrl).pathname.slice(1) : null;
      if (keep && sessions.get(keep)?.slot === 'preload') { cache.promote('preload', 'main'); sessions.get(keep).slot = 'main'; }
      else { cache.release('main'); cache.release('preload'); }
      for (const token of sessions.keys()) if (token !== keep) sessions.delete(token);
      preloadToken = null;
    },
    close() { this.stop(); cache.close(); server.closeAllConnections(); server.close(); }
  };
}
module.exports = { createStreamServer };

const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { ffmpeg } = require('./media.cjs');
const { remote } = require('./ssh-media.cjs');

async function createStreamServer() {
  // One playing session plus, near the end of an episode, one preload session for the next queue item. A new request
  // stops transcodes whose session was replaced, so the next episode can buffer while the current one keeps playing.
  const sessions = new Map();
  const children = new Set();
  let preloadToken = null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const session = sessions.get(url.pathname.slice(1));
    if (!session || req.method !== 'GET') { res.writeHead(404).end(); return; }
    const token = url.pathname.slice(1);
    for (const child of children) if (child.token === token || !sessions.has(child.token)) child.kill();
    const { file, offset, audio, hasVideo, bitmapSubtitle = null, subtitleDelay = 0 } = session;
    let input;
    try { input = await remote.input(file); }
    catch { res.writeHead(502).end('SSH media is unavailable.'); return; }
    if (res.destroyed) return;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', remote.isRemote(file) ? 'file,pipe,crypto,http,tcp' : 'file,pipe,crypto', '-ss', String(offset), '-i', input];
    if (hasVideo) {
      if (bitmapSubtitle !== null) args.push('-filter_complex', `[0:${bitmapSubtitle}]setpts=PTS+${subtitleDelay}/TB[sub];[0:v:0][sub]overlay=eof_action=pass:shortest=0,scale=trunc(iw/2)*2:trunc(ih/2)*2[video]`, '-map', '[video]');
      else args.push('-map', '0:v:0', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
      args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '48');
    }
    else args.push('-vn');
    args.push('-map', audio === null ? '0:a:0?' : `0:${audio}`, '-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-sn', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000', '-f', 'mp4', 'pipe:1');
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.token = token; children.add(child);
    let errorText = '';
    child.stderr.on('data', data => { errorText = (errorText + data).slice(-2000); });
    child.stdout.once('data', data => { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'matro://app' }); res.write(data); child.stdout.pipe(res); });
    child.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    child.on('close', code => { children.delete(child); if (!res.headersSent) res.writeHead(code ? 500 : 200); res.end(); if (code && errorText) session.error = errorText; });
    res.on('close', () => child.kill());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    create(session, { preload = false } = {}) {
      const token = randomBytes(32).toString('hex');
      for (const old of sessions.keys()) if (preload ? old === preloadToken : old !== preloadToken) sessions.delete(old);
      if (preload) { for (const child of children) if (child.token === preloadToken) child.kill(); preloadToken = token; }
      sessions.set(token, session); return `http://127.0.0.1:${server.address().port}/${token}`;
    },
    // Stop everything, or everything except one stream (the preloaded episode that is about to play).
    stop(keepUrl = null) {
      const keep = keepUrl ? new URL(keepUrl).pathname.slice(1) : null;
      for (const child of children) if (child.token !== keep) child.kill();
      for (const token of sessions.keys()) if (token !== keep) sessions.delete(token);
      preloadToken = null;
    },
    close() { this.stop(); server.close(); }
  };
}
module.exports = { createStreamServer };

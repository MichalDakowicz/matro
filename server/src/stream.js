const { spawn } = require('node:child_process');
const config = require('./config');
const { HttpError } = require('./http');

// Each account has one main stream plus one preload (the next episode, buffering while the current one plays); a seek
// or track change replaces the old main stream. A global ceiling keeps CPU in check.
function createStreams() {
  const active = new Map();
  return function transcode(req, res, { userId, file, info, offset, audio, burn, delay = 0, preload = false }) {
    const slot = `${userId}:${preload ? 'preload' : 'main'}`;
    const old = active.get(slot);
    if (old) old.kill();
    if (active.size >= config.maxTranscodes && !old) throw new HttpError(503, 'The server is busy transcoding for other viewers. Try again shortly.');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-ss', String(offset), '-i', file];
    if (info.video) {
      if (burn !== null) args.push('-filter_complex', `[0:${burn}]setpts=PTS+${delay}/TB[sub];[0:v:0][sub]overlay=eof_action=pass:shortest=0,scale=trunc(iw/2)*2:trunc(ih/2)*2[video]`, '-map', '[video]');
      else args.push('-map', '0:v:0', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-g', '48');
    } else args.push('-vn');
    args.push('-map', audio === null ? '0:a:0?' : `0:${audio}`, '-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-sn',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000', '-f', 'mp4', 'pipe:1');
    const child = spawn(config.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active.set(slot, child);
    let errorText = '';
    child.stderr.on('data', data => { errorText = (errorText + data).slice(-1500); });
    child.stdout.once('data', data => {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
      res.write(data); child.stdout.pipe(res);
    });
    child.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    child.on('close', code => {
      if (active.get(slot) === child) active.delete(slot);
      if (!res.headersSent) res.writeHead(code ? 500 : 200);
      res.end();
      if (code && errorText) console.error('transcode failed:', errorText);
    });
    res.on('close', () => child.kill());
    req.on('aborted', () => child.kill());
    return new Promise(resolve => res.on('close', resolve));
  };
}
module.exports = { createStreams };

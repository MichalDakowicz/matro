const { hdrDirectType } = require('./color.cjs');

function canDirectPlay(file, info, { hdr = false } = {}) {
  if (!/\.(mp4|m4v|mov|webm)$/i.test(file) || !info.video) return false;
  const first = info.audio[0];
  if (first && !['aac', 'mp3', 'opus', 'vorbis'].includes(first.codec)) return false;
  if (info.video.hdr) return hdr && !!hdrDirectType(file, info);
  return ['h264', 'vp8', 'vp9'].includes(info.video.codec) && (!info.video.pixelFormat || info.video.pixelFormat === 'yuv420p');
}
module.exports = { canDirectPlay };

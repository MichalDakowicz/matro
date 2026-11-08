function canDirectPlay(file, info) {
  if (!/\.(mp4|m4v|mov|webm)$/i.test(file) || !info.video) return false;
  const first = info.audio[0];
  return ['h264', 'vp8', 'vp9'].includes(info.video.codec) && (!info.video.pixelFormat || info.video.pixelFormat === 'yuv420p')
    && (!first || ['aac', 'mp3', 'opus', 'vorbis'].includes(first.codec));
}
module.exports = { canDirectPlay };

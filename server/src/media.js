const { execFile } = require('node:child_process');
const config = require('./config');

function run(binary, args, { timeout = 30000, input, maxBuffer = 32 * 1024 * 1024, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { timeout, maxBuffer, windowsHide: true, encoding }, (error, stdout, stderr) =>
      error ? reject(new Error(String(stderr).slice(-600) || error.message)) : resolve(stdout));
    if (input !== undefined) child.stdin.on('error', () => {}), child.stdin.end(input);
  });
}
const TEXT_SUBS = ['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'];
const BITMAP_SUBS = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'];

async function probe(file) {
  const data = JSON.parse(await run(config.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file]));
  const video = data.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  return {
    duration: Number(data.format?.duration) || 0,
    video: video ? { codec: video.codec_name, width: video.width, height: video.height, pixelFormat: video.pix_fmt } : null,
    audio: data.streams.filter(s => s.codec_type === 'audio').map(s => ({ index: s.index, language: s.tags?.language || 'und', title: s.tags?.title || '', codec: s.codec_name, channels: s.channels, default: !!s.disposition?.default })),
    subtitles: data.streams.filter(s => s.codec_type === 'subtitle').map(s => ({ index: s.index, language: s.tags?.language || 'und', title: s.tags?.title || '', codec: s.codec_name,
      forced: !!s.disposition?.forced, text: TEXT_SUBS.includes(s.codec_name), bitmap: BITMAP_SUBS.includes(s.codec_name) })),
    chapters: (data.chapters || []).map(c => ({ start: Number(c.start_time), title: c.tags?.title || 'Chapter' }))
  };
}
// Browsers play these as-is with range requests; anything else goes through the FFmpeg stream.
function canDirectPlay(file, info) {
  if (!/\.(mp4|m4v|mov|webm)$/i.test(file) || !info.video) return false;
  const first = info.audio[0];
  return ['h264', 'vp8', 'vp9'].includes(info.video.codec) && (!info.video.pixelFormat || info.video.pixelFormat === 'yuv420p')
    && (!first || ['aac', 'mp3', 'opus', 'vorbis'].includes(first.codec));
}
module.exports = { run, probe, canDirectPlay, TEXT_SUBS, BITMAP_SUBS };

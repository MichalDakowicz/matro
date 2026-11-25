const { execFile } = require('node:child_process');
const probes = new Map();
const SOFTWARE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21'];
const encoders = {
  // NVENC B-frame composition offsets in fragmented MP4 can be enormous on
  // FFmpeg 5.x, causing Android's decoder to stall. Keep presentation/decode
  // order identical for low-latency streams and accurate seek timestamps.
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '21', '-bf', '0'],
  h264_qsv: ['-c:v', 'h264_qsv', '-global_quality', '21'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'speed', '-qp_i', '21', '-qp_p', '21'],
  h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-b:v', '6M']
};
// Listing encoders is insufficient: static builds may expose an encoder without a driver/device.
function available(ffmpeg, name) {
  // Some NVIDIA drivers reject tiny probe frames even when ordinary movie sizes work.
  return new Promise(resolve => execFile(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=640x360:rate=24', '-frames:v', '1', ...encoders[name], '-f', 'null', '-'], { timeout: 6000, windowsHide: true }, error => resolve(!error)));
}
function selectEncoder(ffmpeg) {
  const requested = process.env.MATRO_VIDEO_ENCODER || 'auto';
  const key = ffmpeg + ':' + requested;
  if (!probes.has(key)) probes.set(key, (async () => {
    if (requested === 'software') return SOFTWARE;
    const candidates = requested === 'auto' ? (process.platform === 'darwin' ? ['h264_videotoolbox'] : ['h264_nvenc', 'h264_qsv', 'h264_amf']) : [requested];
    for (const name of candidates) if (encoders[name] && await available(ffmpeg, name)) return encoders[name];
    return SOFTWARE;
  })());
  return probes.get(key);
}
// Quality tiers: the picture is scaled down to at most `height` and the video bitrate is capped, so a weak link can keep up.
const QUALITIES = Object.assign(Object.create(null), { '1080p': { height: 1080, maxrate: 8000, audio: 192 }, '720p': { height: 720, maxrate: 4000, audio: 160 }, '480p': { height: 480, maxrate: 1500, audio: 128 } });
function canCopyVideo(info, burn = null, offset = 0, quality = null) {
  // Copying at an arbitrary timestamp starts at an earlier keyframe and corrupts resume/subtitle timing.
  return !QUALITIES[quality] && offset === 0 && burn === null && info?.video?.codec === 'h264' && (!info.video.pixelFormat || info.video.pixelFormat === 'yuv420p');
}
function argumentsFor({ input, offset = 0, audio = null, burn = null, delay = 0, info, remote = false, quality = null }, encoder = SOFTWARE) {
  const tier = QUALITIES[quality], scale = tier ? `scale=-2:trunc(min(ih\\,${tier.height})/2)*2` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  // The existing hardware presets use different rate control modes. Use
  // capped CRF for a consistent bandwidth limit on explicit tiers.
  if (tier) encoder = SOFTWARE;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-progress', 'pipe:2', '-stats_period', '0.25', '-threads', '2', '-filter_threads', '1', '-filter_complex_threads', '1', '-protocol_whitelist', remote ? 'file,pipe,crypto,http,tcp' : 'file,pipe,crypto'];
  if (encoder !== SOFTWARE && info.video && burn === null) args.push('-hwaccel', 'auto');
  args.push('-ss', String(offset), '-i', input);
  if (info.video) {
    if (canCopyVideo(info, burn, offset, quality)) args.push('-map', '0:v:0', '-c:v', 'copy');
    else {
      if (burn !== null) args.push('-filter_complex', `[0:${burn}]setpts=PTS+${delay}/TB[sub];[0:v:0][sub]overlay=eof_action=pass:shortest=0,${scale}[video]`, '-map', '[video]');
      else args.push('-map', '0:v:0', '-vf', scale);
      args.push(...encoder);
      if (tier) args.push('-maxrate', `${tier.maxrate}k`, '-bufsize', `${tier.maxrate * 2}k`);
      args.push('-threads', '2', '-pix_fmt', 'yuv420p', '-g', '48');
    }
  } else args.push('-vn');
  // Wait for the first fragment before writing track timing. An empty moov
  // cannot describe AAC priming / reordered video starts, so the muxer resets
  // their first timestamps independently and stretches the first audio gap.
  args.push('-map', audio === null ? '0:a:0?' : `0:${audio}`, '-c:a', 'aac', '-ac', '2', '-b:a', `${tier?.audio || 192}k`, '-sn', '-movflags', '+frag_keyframe+delay_moov+default_base_moof', '-frag_duration', '500000', '-f', 'mp4', 'pipe:1');
  return args;
}
module.exports = { selectEncoder, argumentsFor, canCopyVideo, QUALITIES, SOFTWARE };

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
function canCopyVideo(info, burn = null, offset = 0) {
  // Copying at an arbitrary timestamp starts at an earlier keyframe and corrupts resume/subtitle timing.
  return offset === 0 && burn === null && info?.video?.codec === 'h264' && (!info.video.pixelFormat || info.video.pixelFormat === 'yuv420p');
}
function argumentsFor({ input, offset = 0, audio = null, burn = null, delay = 0, info, remote = false }, encoder = SOFTWARE) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-progress', 'pipe:2', '-stats_period', '0.25', '-threads', '2', '-filter_threads', '1', '-filter_complex_threads', '1', '-protocol_whitelist', remote ? 'file,pipe,crypto,http,tcp' : 'file,pipe,crypto'];
  if (encoder !== SOFTWARE && info.video && burn === null) args.push('-hwaccel', 'auto');
  args.push('-ss', String(offset), '-i', input);
  if (info.video) {
    if (canCopyVideo(info, burn, offset)) args.push('-map', '0:v:0', '-c:v', 'copy');
    else {
      if (burn !== null) args.push('-filter_complex', `[0:${burn}]setpts=PTS+${delay}/TB[sub];[0:v:0][sub]overlay=eof_action=pass:shortest=0,scale=trunc(iw/2)*2:trunc(ih/2)*2[video]`, '-map', '[video]');
      else args.push('-map', '0:v:0', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
      args.push(...encoder, '-threads', '2', '-pix_fmt', 'yuv420p', '-g', '48');
    }
  } else args.push('-vn');
  args.push('-map', audio === null ? '0:a:0?' : `0:${audio}`, '-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-sn', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000', '-f', 'mp4', 'pipe:1');
  return args;
}
module.exports = { selectEncoder, argumentsFor, canCopyVideo, SOFTWARE };

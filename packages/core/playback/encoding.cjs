const { execFile } = require('node:child_process');
const { sdrFilters } = require('./color.cjs');
const { copiesVideo: canCopyVideo, outputChannels } = require('../client/playback-info.js');
const probes = new Map();
const filterProbes = new Map();
function supportsToneMap(ffmpeg) {
  if (!filterProbes.has(ffmpeg)) filterProbes.set(ffmpeg, new Promise(resolve => {
    execFile(ffmpeg, ['-hide_banner', '-filters'], { timeout: 6000, windowsHide: true }, (error, stdout) => {
      resolve(!error && /^\s*[A-Z.]+\s+zscale\s/m.test(stdout) && /^\s*[A-Z.]+\s+tonemap\s/m.test(stdout));
    });
  }));
  return filterProbes.get(ffmpeg);
}
const SOFTWARE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21'];
const encoders = {
  // NVENC B-frame composition offsets in fragmented MP4 can be enormous on
  // FFmpeg 5.x, causing Android's decoder to stall. Keep presentation/decode
  // order identical for low-latency streams and accurate seek timestamps.
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '21', '-bf', '0'],
  h264_qsv: ['-c:v', 'h264_qsv', '-global_quality', '21'],
  h264_vaapi: ['-c:v', 'h264_vaapi', '-b:v', '6M'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'speed', '-qp_i', '21', '-qp_p', '21'],
  h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-b:v', '6M']
};
const VAAPI_DEVICE = ['-init_hw_device', 'vaapi=matro', '-filter_hw_device', 'matro'];
const VAAPI_UPLOAD = 'format=nv12,hwupload';
const cappedEncoders = {
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-bf', '0'],
  h264_qsv: ['-c:v', 'h264_qsv'],
  h264_vaapi: ['-c:v', 'h264_vaapi', '-rc_mode', 'VBR'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'vbr_peak'],
  h264_videotoolbox: ['-c:v', 'h264_videotoolbox']
};
// Listing encoders is insufficient: static builds may expose an encoder without a driver/device.
function available(ffmpeg, name) {
  // Some NVIDIA drivers reject tiny probe frames even when ordinary movie sizes work.
  const vaapi = name === 'h264_vaapi';
  return new Promise(resolve => execFile(ffmpeg, ['-v', 'error', ...(vaapi ? VAAPI_DEVICE : []), '-f', 'lavfi', '-i', 'color=size=640x360:rate=24', '-frames:v', '1', ...(vaapi ? ['-vf', VAAPI_UPLOAD] : []), ...encoders[name], '-f', 'null', '-'], { timeout: 6000, windowsHide: true }, error => resolve(!error)));
}
function selectEncoder(ffmpeg) {
  const requested = process.env.MATRO_VIDEO_ENCODER || 'auto';
  const key = ffmpeg + ':' + requested;
  if (!probes.has(key)) probes.set(key, (async () => {
    if (requested === 'software') return SOFTWARE;
    const automatic = process.platform === 'darwin' ? ['h264_videotoolbox'] : ['h264_nvenc', 'h264_qsv', 'h264_amf'];
    if (process.platform === 'linux') automatic.push('h264_vaapi');
    const candidates = requested === 'auto' ? automatic : [requested];
    for (const name of candidates) if (encoders[name] && await available(ffmpeg, name)) return encoders[name];
    return SOFTWARE;
  })());
  return probes.get(key);
}
// Fit inside each tier's frame size without upscaling, and cap its video bitrate.
const QUALITIES = Object.assign(Object.create(null), {
  '1080p': { width: 1920, height: 1080, maxrate: 8000, audio: 192 },
  '720p': { width: 1280, height: 720, maxrate: 4000, audio: 160 },
  '480p': { width: 854, height: 480, maxrate: 1500, audio: 128 }
});
function cappedScale({ width, height }) {
  return `scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
}
// Audio offset in seconds, independent of the subtitle delay: positive plays the sound later, negative earlier.
function audioFilter(seconds) {
  if (!seconds) return null;
  return seconds > 0 ? `adelay=${Math.round(seconds * 1000)}:all=1` : `atrim=start=${-seconds},asetpts=PTS-STARTPTS`;
}
function argumentsFor({ input, offset = 0, audio = null, burn = null, delay = 0, audioDelay = 0, info, remote = false, quality = null, channels = 2, toneMap = !!info.video?.hdr }, encoder = SOFTWARE) {
  const tier = QUALITIES[quality], name = encoder[1], vaapi = name === 'h264_vaapi';
  const scale = tier ? cappedScale(tier) : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  // Shrink the high-bit-depth input before expanding it to float for tone-mapping.
  const sdr = toneMap ? `${cappedScale(tier || QUALITIES['1080p'])},${sdrFilters(info.video.hdr)}` : '';
  const count = outputChannels(info, audio, channels);
  const audioRate = (tier?.audio || 192) * (count === 6 ? 2 : 1);
  const filters = vaapi ? `${scale},${VAAPI_UPLOAD}` : scale;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-progress', 'pipe:2', '-stats_period', '0.25', '-threads', '2', '-filter_threads', '1', '-filter_complex_threads', '1', '-protocol_whitelist', remote ? 'file,pipe,crypto,http,tcp' : 'file,pipe,crypto'];
  const copy = canCopyVideo(info, burn, offset, quality);
  if (info.video && !copy) {
    if (vaapi) args.push(...VAAPI_DEVICE);
    else if (encoder !== SOFTWARE && !tier && !sdr && burn === null) args.push('-hwaccel', 'auto');
  }
  args.push('-ss', String(offset), '-i', input);
  if (info.video) {
    if (copy) args.push('-map', '0:v:0', '-c:v', 'copy');
    else {
      if (burn !== null) {
        const picture = sdr ? `[0:v:0]${sdr}[sdr];[sub][sdr]scale2ref=w=iw:h=ih[scaledSub][picture];[picture][scaledSub]` : '[0:v:0][sub]';
        args.push('-filter_complex', `[0:${burn}]setpts=PTS+${delay}/TB[sub];${picture}overlay=eof_action=pass:shortest=0,${filters}[video]`, '-map', '[video]');
      } else args.push('-map', '0:v:0', '-vf', sdr ? `${sdr},${filters}` : filters);
      const capped = tier && cappedEncoders[name];
      args.push(...(capped || encoder));
      if (capped) args.push('-b:v', `${Math.round(tier.maxrate * 0.75)}k`);
      if (tier) args.push('-maxrate', `${tier.maxrate}k`, '-bufsize', `${tier.maxrate * 2}k`);
      if (!vaapi) args.push('-pix_fmt', name === 'h264_qsv' ? 'nv12' : 'yuv420p');
      args.push('-threads', '2', '-g', '48');
      if (sdr) args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv');
    }
  } else args.push('-vn');
  // Wait for the first fragment before writing track timing. An empty moov
  // cannot describe AAC priming / reordered video starts, so the muxer resets
  // their first timestamps independently and stretches the first audio gap.
  const shift = audioFilter(audioDelay);
  args.push('-map', audio === null ? '0:a:0?' : `0:${audio}`, ...(shift ? ['-af', shift] : []), '-c:a', 'aac', '-ac', String(count), '-b:a', `${audioRate}k`, '-sn', '-movflags', '+frag_keyframe+delay_moov+default_base_moof', '-frag_duration', '500000', '-f', 'mp4', 'pipe:1');
  return args;
}
module.exports = { selectEncoder, argumentsFor, canCopyVideo, QUALITIES, outputChannels, supportsToneMap, SOFTWARE };

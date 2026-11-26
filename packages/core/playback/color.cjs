function hdrColor(stream) {
  if (!['smpte2084', 'arib-std-b67'].includes(stream.color_transfer)) return null;
  return {
    transfer: stream.color_transfer,
    primaries: stream.color_primaries,
    matrix: stream.color_space,
    codecTag: stream.codec_tag_string,
    level: stream.level
  };
}

function hdrDirectType(file, info) {
  const video = info.video;
  if (!video?.hdr || video.pixelFormat !== 'yuv420p10le' || video.width > 3840 || video.height > 2160) return null;
  if (video.codec === 'vp9' && /\.webm$/i.test(file)) return 'video/webm; codecs="vp09.02.51.10"';
  const { codecTag, level } = video.hdr;
  if (video.codec === 'hevc' && codecTag === 'hvc1' && [120, 123, 150, 153].includes(level) && /\.(mp4|m4v)$/i.test(file)) {
    return `video/mp4; codecs="hvc1.2.4.L${level}.B0"`;
  }
  return null;
}

function sdrFilters(hdr) {
  const missing = ['unknown', 'unspecified', 'reserved', undefined];
  const input = [
    missing.includes(hdr.primaries) ? 'pin=2020' : null,
    missing.includes(hdr.matrix) ? 'min=2020_ncl' : null
  ].filter(Boolean);
  return [
    ['zscale=t=linear:npl=100', ...input].join(':'),
    'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable',
    'zscale=t=bt709:m=bt709:r=limited', 'format=yuv420p',
    'sidedata=mode=delete:type=MASTERING_DISPLAY_METADATA',
    'sidedata=mode=delete:type=CONTENT_LIGHT_LEVEL'
  ].join(',');
}

module.exports = { hdrColor, hdrDirectType, sdrFilters };

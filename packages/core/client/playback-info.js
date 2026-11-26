import { knownQuality } from './quality.js';

export const savedPlayback = { mode: 'Offline copy', reason: 'Playing the file saved on this device.' };

/** @param {any} info @param {number|null} [burn] @param {number} [offset] @param {string|null} [quality] */
export function copiesVideo(info, burn = null, offset = 0, quality = null) {
  // Copying from a non-keyframe can corrupt resume and subtitle timing.
  return knownQuality(quality) === 'original' && !info?.video?.hdr && offset === 0 && burn === null
    && info?.video?.codec === 'h264' && (!info.video.pixelFormat || info.video.pixelFormat === 'yuv420p');
}

/** @param {any} info @param {number|null} audio */
function selectedAudio(info, audio) {
  return audio == null ? info.audio?.[0] : info.audio?.find(/** @param {{ index: number }} track */ track => track.index === audio);
}

/** @param {any} info @param {number|null} audio @param {number} channels */
export function outputChannels(info, audio, channels) {
  return channels === 6 && selectedAudio(info, audio)?.channels >= 6 ? 6 : 2;
}

/** @param {any} info @param {{ direct?: boolean, audio?: number|null, burn?: number|null, offset?: number, force?: boolean, remote?: boolean, quality?: string|null, channels?: number, audioDelay?: number, toneMap?: boolean }} [options] */
export function describePlayback(info, { direct, audio = null, burn = null, offset = 0, force = false, remote = false, quality = null, channels = 2, audioDelay = 0, toneMap = true } = {}) {
  const hdr = info.video?.hdr;
  const sourceChannels = selectedAudio(info, audio)?.channels;
  if (direct) {
    const reasons = [hdr ? 'The source plays in HDR.' : 'This player can use the source video and audio.'];
    if (sourceChannels === 6) reasons.push('The source carries 5.1 audio.');
    return { mode: 'Direct play', reason: reasons.join(' ') };
  }
  const mode = copiesVideo(info, burn, offset, quality) ? 'Remux' : 'Transcode';
  const reasons = [];
  if (info.video && knownQuality(quality) !== 'original') reasons.push(`The ${quality} quality tier caps picture size and bitrate.`);
  if (hdr) reasons.push(toneMap ? 'HDR is tone-mapped to SDR.' : 'HDR tone-mapping is unavailable on this system.');
  if (burn !== null) reasons.push('Bitmap subtitles are rendered into the picture.');
  if (offset > 0 && info.video) reasons.push('Video is encoded from the exact start time.');
  if (audio !== null && audio !== info.audio?.[0]?.index) reasons.push('The selected audio track is used.');
  if (audioDelay) reasons.push(`Audio plays ${Number(Math.abs(audioDelay).toFixed(3))} s ${audioDelay > 0 ? 'later' : 'earlier'}.`);
  if (force) reasons.push('The player requested a stream for compatibility or buffering.');
  if (remote) reasons.push('The source is on an SSH server.');
  if (!reasons.length) reasons.push('The source is repackaged in MP4 for playback compatibility.');
  const audioOutput = outputChannels(info, audio, channels) === 6 ? 'Audio is encoded as 5.1 AAC.' :
    sourceChannels >= 6 ? 'Audio is downmixed to stereo AAC.' : null;
  if (mode === 'Remux') reasons.push(audioOutput ? 'The video is copied.' : 'The video is copied and audio is encoded as AAC.');
  else if (info.video) reasons.push('The video is encoded as H.264.');
  else if (!audioOutput) reasons.push('The audio is encoded as AAC.');
  if (audioOutput) reasons.push(audioOutput);
  return { mode, reason: reasons.join(' ') };
}

const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('./config');
const { run } = require('./media');
const { charsetFor } = require('./lang');

const MAX_UPLOAD = 5 * 1024 * 1024;
const FORMATS = { srt: 'srt', vtt: 'webvtt', ass: 'ass', ssa: 'ass' };
const isVtt = text => /^\uFEFF?WEBVTT(?:[ \t\r\n]|$)/.test(text);
const hasCues = text => /\d:\d\d[.,]\d{1,3}\s*-->\s*\d/.test(text);

function decode(buffer, language, charset) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  if (charset && charset !== 'auto') {
    try { return new TextDecoder(charset).decode(buffer); } catch { throw Object.assign(new Error('Unknown text encoding.'), { status: 400 }); }
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder(charsetFor(language)).decode(buffer); }
}

// Any uploaded subtitle becomes WebVTT text once, at upload; playback never touches the original again.
async function toVtt(buffer, { filename, language, charset }) {
  if (!buffer.length) throw Object.assign(new Error('That file is empty.'), { status: 400 });
  if (buffer.length > MAX_UPLOAD) throw Object.assign(new Error('Subtitle files can be up to 5 MB.'), { status: 413 });
  const ext = path.extname(String(filename || '')).slice(1).toLowerCase();
  const text = decode(buffer, language, charset).replace(/^\uFEFF/, '');
  let vtt;
  if (isVtt(text) || ext === 'vtt') vtt = isVtt(text) ? text : `WEBVTT\n\n${text}`;
  else {
    const format = FORMATS[ext] || (/^\[Script Info\]/im.test(text) ? 'ass' : 'srt');
    try { vtt = await run(config.ffmpeg, ['-v', 'error', '-nostdin', '-f', format, '-i', 'pipe:0', '-f', 'webvtt', 'pipe:1'], { input: text, timeout: 60000 }); }
    catch { throw Object.assign(new Error('That does not look like a subtitle file. Use SRT, VTT, ASS or SSA.'), { status: 400 }); }
  }
  vtt = vtt.replace(/\r\n?/g, '\n');
  if (!hasCues(vtt)) throw Object.assign(new Error('No subtitle lines were found in that file.'), { status: 400 });
  return vtt;
}

function createEmbedded() {
  const dir = path.join(config.dataDir, 'cache', 'subs'), pending = new Map();
  return async function embedded(item, index) {
    const file = path.join(dir, `${item.id}-${index}-${item.mtime}.vtt`);
    try { return await fs.readFile(file, 'utf8'); } catch { /* not cached yet */ }
    if (pending.has(file)) return pending.get(file);
    const task = (async () => {
      const vtt = await run(config.ffmpeg, ['-v', 'error', '-nostdin', '-i', item.path, '-map', `0:${index}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1'], { timeout: 180000 });
      if (!isVtt(vtt)) throw new Error('Embedded subtitles did not produce WebVTT.');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file + '.tmp', vtt).then(() => fs.rename(file + '.tmp', file)).catch(() => {});
      return vtt;
    })().finally(() => pending.delete(file));
    pending.set(file, task);
    return task;
  };
}
module.exports = { toVtt, createEmbedded, isVtt, MAX_UPLOAD };

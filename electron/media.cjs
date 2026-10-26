const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const os = require('node:os');
const ffprobe = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');
const ffmpeg = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const extensions = new Set('mkv mp4 m4v avi mov webm flv wmv mpg mpeg ts mts m2ts vob ogv 3gp mp3 flac wav aac m4a ogg opus wma aiff alac'.split(' '));
const idFor = file => createHash('sha256').update(file).digest('hex').slice(0, 24);
const seasonNumber = folder => folder.match(/^(?:s|season[ ._-]*)(\d+)$/i)?.[1];
const isContainer = folder => /^(?:media|movies?|shows?|tv|tv[ ._-]*shows?|videos?|library|collection)$/i.test(folder);
function describe(file, root = '') {
  const name = path.basename(file, path.extname(file));
  const episode = name.match(/S(\d{1,2})[ ._-]*E(\d{1,3})/i) || name.match(/(\d{1,2})x(\d{2,3})/i);
  const clean = value => value.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  const title = clean(name.replace(/\b(480p|720p|1080p|2160p|BluRay|WEB-DL|x264|x265|HEVC)\b.*$/i, ''));
  return { id: idFor(file), path: file, root, title, group: episode ? clean(name.slice(0, episode.index)) || path.basename(path.dirname(file)) : title,
    kind: episode ? 'show' : /\.(mp3|flac|wav|aac|m4a|ogg|opus|wma|aiff|alac)$/i.test(file) ? 'audio' : 'movie',
    season: episode ? Number(episode[1]) : null, episode: episode ? Number(episode[2]) : null,
    format: path.extname(file).slice(1).toUpperCase(), added: Date.now() };
}
async function scan(root) {
  root = path.resolve(root);
  const items = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { try { await walk(file); } catch { /* A missing or unreadable nested folder should not stop the scan. */ } }
      else if (entry.isFile() && extensions.has(path.extname(file).slice(1).toLowerCase())) items.push(describe(file, root));
    }
  }
  await walk(root);
  items.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const videos = items.filter(item => item.kind !== 'audio');
  const directVideo = videos.some(item => path.dirname(item.path) === root);
  const seasonChildren = videos.some(item => seasonNumber(path.relative(root, item.path).split(path.sep)[0]) !== undefined);
  const rootIsTitle = !isContainer(path.basename(root)) && (directVideo || seasonChildren);
  for (const item of videos) {
    if (seasonNumber(path.basename(root)) !== undefined) item.titlePath = path.dirname(root);
    else if (rootIsTitle) item.titlePath = root;
    else {
      const directories = path.relative(root, path.dirname(item.path)).split(path.sep).filter(Boolean);
      let titlePath = root;
      for (const directory of directories) {
        if (seasonNumber(directory) !== undefined) break;
        titlePath = path.join(titlePath, directory);
        if (!isContainer(directory)) break;
      }
      // Loose files in a collection root have no title folder to group under.
      if (titlePath !== root || !isContainer(path.basename(root))) item.titlePath = titlePath;
    }
  }
  return groupFolders(items);
}
function groupFolders(items) {
  const titles = new Map();
  for (const item of items) if (item.titlePath && item.kind !== 'audio') {
    const key = idFor(path.resolve(item.titlePath));
    if (!titles.has(key)) titles.set(key, []);
    titles.get(key).push(item);
  }
  for (const [groupId, entries] of titles) {
    const seasons = new Map();
    for (const item of entries) {
      const parsed = describe(item.path, item.root);
      item.groupId = groupId;
      item.group = path.basename(item.titlePath);
      item.kind = entries.length === 1 ? 'movie' : 'show';
      if (item.kind === 'movie') { item.season = null; item.episode = null; continue; }
      const folders = path.relative(item.titlePath, path.dirname(item.path)).split(path.sep);
      item.season = parsed.season ?? Number(folders.map(seasonNumber).find(value => value !== undefined) ?? 1);
      const numbered = path.basename(item.path).match(/(?:chapter|episode|ep)[ ._-]*(\d+)/i) || path.basename(item.path).match(/^(\d+)[ ._-]/);
      item.episode = parsed.episode ?? (numbered ? Number(numbered[1]) : null);
      if (!seasons.has(item.season)) seasons.set(item.season, []);
      seasons.get(item.season).push(item);
    }
    for (const episodes of seasons.values()) {
      episodes.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
      const used = new Set(episodes.map(item => item.episode).filter(value => value !== null));
      let next = used.has(1) ? 0 : 1;
      for (const item of episodes) if (item.episode === null) {
        while (used.has(next)) next++;
        item.episode = next; used.add(next++);
      }
    }
  }
  return items;
}
function run(binary, args, options = {}) {
  const { priority, ...executionOptions } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024, ...executionOptions }, (error, stdout, stderr) => error ? reject(error.name === 'AbortError' ? error : new Error(stderr?.slice(-1000) || error.message)) : resolve(stdout));
    if (priority !== undefined && child.pid) { try { os.setPriority(child.pid, priority); } catch { /* Thread and read-rate limits still apply if OS priority cannot be set. */ } }
  });
}
async function probe(file) {
  const data = JSON.parse(await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file]));
  const video = data.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  return { duration: Number(data.format?.duration) || 0, video: video ? { codec: video.codec_name, width: video.width, height: video.height, pixelFormat: video.pix_fmt } : null,
    audio: data.streams.filter(s => s.codec_type === 'audio').map(s => ({ index: s.index, language: s.tags?.language || 'und', title: s.tags?.title || '', codec: s.codec_name, channels: s.channels, default: !!s.disposition?.default })),
    subtitles: data.streams.filter(s => s.codec_type === 'subtitle').map(s => ({ index: s.index, language: s.tags?.language || 'und', title: s.tags?.title || '', codec: s.codec_name,
      text: ['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'].includes(s.codec_name), bitmap: ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'].includes(s.codec_name) })),
    chapters: (data.chapters || []).map(c => ({ start: Number(c.start_time), title: c.tags?.title || 'Chapter' })) };
}
module.exports = { extensions, describe, scan, groupFolders, probe, run, ffmpeg, idFor };

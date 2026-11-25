const path = require('node:path');
const { mediaFS: fs, remote } = require('./ssh-media.cjs');
const { VIDEO, idFor, describe: describeName, walk, locateTitles, groupVideos } = require('../media-scan.cjs');
const { execFile } = require('node:child_process');
const os = require('node:os');
const ffprobe = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');
const ffmpeg = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const AUDIO = new Set('mp3 flac wav aac m4a ogg opus wma aiff alac'.split(' '));
const extensions = new Set([...VIDEO, ...AUDIO]);
function describe(file, root = '') {
  const { title, group, season, episode, year } = describeName(file);
  const ext = path.extname(file).slice(1);
  return { id: idFor(file), path: file, root, title, group: group || title, year,
    kind: AUDIO.has(ext.toLowerCase()) ? 'audio' : episode !== null ? 'show' : 'movie',
    season, episode, format: ext.toUpperCase(), added: Date.now() };
}
async function scan(root, exclude) {
  root = path.resolve(root);
  const walked = await walk(fs, root, extensions, { allowHiddenFiles: true, onDirectoryError() {} });
  const excluded = await exclude?.();
  const items = walked.filter(file => !excluded?.has(file)).map(file => describe(file, root));
  const videos = items.filter(item => item.kind !== 'audio');
  for (const [index, { folder }] of locateTitles(root, videos.map(item => item.path)).entries()) {
    if (folder) videos[index].titlePath = folder;
  }
  return groupFolders(items);
}
function groupFolders(items) {
  const entries = items.filter(item => item.kind !== 'audio' && (item.titlePath || (item.root && !item.prelude && describeName(item.path).episode !== null)))
    .map(item => ({ file: item.path, folder: item.titlePath, root: item.root }));
  const rows = groupVideos(entries);
  for (const item of items) {
    if (!rows.has(item.path)) continue;
    const { groupKey, ...row } = rows.get(item.path);
    // Desktop's existing directory IDs also key saved prelude choices and track preferences.
    const groupId = idFor(groupKey.startsWith('dir:') ? groupKey.slice(4) : groupKey);
    Object.assign(item, row, { groupId });
  }
  return items;
}
async function run(binary, args, options = {}) {
  args = await remote.args(args);
  const { priority, ...executionOptions } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024, ...executionOptions }, (error, stdout, stderr) => error ? reject(error.name === 'AbortError' ? error : new Error(stderr?.slice(-1000) || error.message)) : resolve(stdout));
    if (priority !== undefined && child.pid) { try { os.setPriority(child.pid, priority); } catch { /* Thread and read-rate limits still apply if OS priority cannot be set. */ } }
  });
}
// A prelude is any file the user picked for a show, whatever its name or location: it plays first, as episode 0 of the
// first season. Files outside the show's folders are added to the show. `preludes` maps a show's groupId to a file path.
function applyPreludes(items, preludes = {}) {
  const picked = new Set(Object.values(preludes));
  for (const item of items) if (item.prelude && !picked.has(item.path)) delete item.prelude;
  for (const [groupId, file] of Object.entries(preludes)) {
    const show = items.filter(i => i.kind === 'show' && i.groupId === groupId && i.path !== file);
    if (!show.length || typeof file !== 'string') continue;
    let item = items.find(i => i.path === file);
    if (!item) { item = describe(file, show[0].root); items.push(item); }
    Object.assign(item, { groupId, group: show[0].group, kind: 'show', season: Math.min(...show.map(i => i.season)), episode: 0, prelude: true });
  }
  return items;
}
// Subtitle files next to a video that share its name (Show.S01E01.srt, Show.S01E01.en.srt, Show.S01E01.pl.forced.ass)
// are offered as tracks. Their indexes start at SIDECAR so they can never collide with stream indexes.
const SIDECAR = 10000, subtitleExtensions = new Set(['srt', 'vtt', 'ass', 'ssa']);
async function sidecars(file) {
  const dir = path.dirname(file), stem = path.basename(file, path.extname(file)).toLowerCase();
  let names; try { names = await fs.readdir(dir); } catch { return []; }
  return names.filter(name => subtitleExtensions.has(path.extname(name).slice(1).toLowerCase()) && (name.toLowerCase().startsWith(`${stem}.`)))
    .sort((a, b) => a.length - b.length || a.localeCompare(b, undefined, { numeric: true }))
    .map((name, n) => {
      const tags = path.basename(name, path.extname(name)).slice(stem.length).split('.').filter(Boolean);
      const language = tags.find(tag => /^[a-z]{2,3}$/i.test(tag))?.toLowerCase() || 'und';
      return { index: SIDECAR + n, path: path.join(dir, name), language, title: tags.filter(tag => tag.toLowerCase() !== language).join(' ') || 'Subtitle file', codec: path.extname(name).slice(1).toLowerCase(), text: true, bitmap: false, sidecar: true };
    });
}
// Keep a loaded subtitle file with the video so it is offered next time. Existing files are never overwritten.
async function keepSidecar(video, subtitle, language = '') {
  const dir = path.dirname(video), stem = path.basename(video, path.extname(video)), ext = path.extname(subtitle).toLowerCase();
  if (path.resolve(path.dirname(subtitle)) === path.resolve(dir) && path.basename(subtitle).toLowerCase().startsWith(`${stem.toLowerCase()}.`)) return subtitle;
  const tag = /^[a-z]{2,3}$/i.test(language) ? `.${language.toLowerCase()}` : '';
  for (let n = 1; n < 100; n++) {
    const target = path.join(dir, `${stem}${tag}${n > 1 ? `.${n}` : ''}${ext}`);
    try { await fs.copyFile(subtitle, target, fs.constants.COPYFILE_EXCL); return target; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Too many subtitle files next to this video.');
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
module.exports = { extensions, describe, scan, groupFolders, applyPreludes, sidecars, keepSidecar, SIDECAR, probe, run, ffmpeg, idFor };

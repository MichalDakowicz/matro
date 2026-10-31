const path = require('node:path');
const { join } = require('./download-layout.cjs');
const { cleanQuery, yearOf } = require('./metadata.cjs');

function resolutionClass(video) {
  const w = +video?.width || 0, h = +video?.height || 0;
  if (w >= 3500 || h >= 2000) return 2160;
  if (w >= 2500 || h >= 1400) return 1440;
  if (w >= 1700 || h >= 1000) return 1080;
  if (w >= 1100 || h >= 650) return 720;
  return h;
}
const qualityHeight = quality => /4k/i.test(quality) ? 2160 : +(String(quality).match(/(\d{3,4})p/i)?.[1] || 0);
function createMovieUpgrades({ getState, probe, stat, describe, persist, resolveFile, metadata = () => ({}) }) {
  const cache = new Map();
  const find = id => { const item = getState().items.find(item => item.id === id); if (!item || item.kind !== 'movie') throw new Error('Choose a movie already in the library.'); return item; };
  function groupFor(item) {
    const state = getState();
    return Object.values(state.movieEditions || {}).find(group => group.editions.includes(item.id)) || { sourceId: item.id, title: metadata(item)?.title || cleanQuery(item.group || item.title), year: metadata(item)?.year || yearOf(item.group || item.title) || '', editions: [item.id], favorite: item.id };
  }
  async function measure(item) {
    const details = await stat(item.path), key = `${item.path}:${details.size}:${details.mtimeMs}`;
    if (cache.has(key)) return { ...cache.get(key), id: item.id, name: item.title };
    const info = await probe(item.path);
    if (!info.video || !info.duration) throw new Error('This movie could not be inspected. Check that its media source is online.');
    const result = { id: item.id, name: item.title, width: info.video.width, height: info.video.height, resolution: resolutionClass(info.video), codec: info.video.codec, duration: info.duration, size: details.size };
    cache.set(key, result); return result;
  }
  async function context(id) {
    const item = find(id), group = groupFor(item), current = await measure(item);
    const editions = await Promise.all(group.editions.map(async id => {
      try { return { ...await measure(find(id)), favorite: group.favorite === id }; }
      catch (error) { return { id, error: error.message, favorite: group.favorite === id }; }
    }));
    return { sourceId: group.sourceId, currentId: item.id, title: group.title, year: group.year, current, editions };
  }
  return {
    context,
    async validate(id, release) {
      const result = await context(id), height = qualityHeight(release.quality);
      const sameTitle = value => cleanQuery(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (sameTitle(release.title) !== sameTitle(result.title) || result.year && release.year && String(result.year) !== String(release.year)) throw new Error('The release title/year does not match this movie. Check the title match or browse it as a separate download.');
      if (!height || height <= result.current.resolution) throw new Error('Select a higher-resolution release than the current edition.');
      return { ...release, title: result.title, year: result.year || release.year, upgradeId: id, sourceId: result.sourceId, edition: ` [${release.hash.slice(0, 8)}]` };
    },
    async prepared(job, config) {
      if (job.release.kind !== 'movie') return;
      const state = getState(); state.pendingDownloadFiles ||= {};
      for (const file of job.plan.files) state.pendingDownloadFiles[resolveFile(job.target, config, join(job.plan.root, file.newPath))] = job.id;
      await persist();
    },
    async completed(job, config) {
      const state = getState(), videos = job.plan.files.filter(file => file.type === 'video');
      if (job.release.kind !== 'movie' || videos.length !== 1) return;
      const actual = resolveFile(job.target, config, join(job.plan.root, videos[0].newPath));
      const candidate = describe(actual);
      const measured = await measure(candidate); // validate a real playable file before adding it
      state.managedMoviePaths ||= {};
      const source = job.release.upgradeId ? find(job.release.upgradeId) : null;
      const group = source ? groupFor(source) : { sourceId: candidate.id, title: job.release.title, year: job.release.year, editions: [], favorite: candidate.id };
      if (source && measured.resolution <= (await measure(source)).resolution) throw new Error('Downloaded file is not higher resolution than the existing edition. Both files were kept for review.');
      state.managedMoviePaths[actual] = { title: group.title, year: group.year, quality: job.release.quality, sourceId: group.sourceId };
      if (source) state.managedMoviePaths[source.path] ||= { title: group.title, year: group.year, sourceId: group.sourceId };
      state.items = state.items.filter(item => item.id !== candidate.id).concat({ ...candidate, title: group.title + (job.release.quality ? ` [${job.release.quality}]` : ''), group: group.title, kind: 'movie' });
      if (!group.editions.includes(candidate.id)) group.editions.push(candidate.id);
      state.movieEditions ||= {}; state.movieEditions[group.sourceId] = group;
      for (const file of job.plan.files) delete state.pendingDownloadFiles?.[resolveFile(job.target, config, join(job.plan.root, file.newPath))];
      await persist();
    },
    async favorite(sourceId, id) {
      const item = find(sourceId), group = groupFor(item);
      if (!group.editions.includes(id)) throw new Error('Choose an edition of this movie.');
      await measure(find(id));
      group.favorite = id; const state = getState(); state.movieEditions ||= {}; state.movieEditions[group.sourceId] = group; await persist();
      return context(sourceId);
    },
    restore(items) {
      const state = getState(), records = state.managedMoviePaths || {}, directories = new Set(Object.keys(records).map(file => path.dirname(file)));
      return items.filter(item => !state.pendingDownloadFiles?.[item.path]).map(item => {
        if (item.kind === 'audio' || !directories.has(path.dirname(item.path))) return item;
        const record = records[item.path];
        return { ...item, kind: 'movie', groupId: undefined, group: record?.title || item.title, season: null, episode: null, ...(record ? { title: record.title + (record.quality ? ` [${record.quality}]` : '') } : {}) };
      });
    }
  };
}
module.exports = { createMovieUpgrades, resolutionClass, qualityHeight };

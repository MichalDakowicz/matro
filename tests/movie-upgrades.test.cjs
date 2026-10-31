const test = require('node:test'), assert = require('node:assert/strict');
const { createMovieUpgrades, resolutionClass } = require('../electron/movie-upgrades.cjs');

test('cropped widescreen files use their real resolution class', () => {
  assert.equal(resolutionClass({ width: 1920, height: 800 }), 1080);
  assert.equal(resolutionClass({ width: 3840, height: 1600 }), 2160);
});
test('upgrades keep the old edition, reject lower quality and persist a chosen favorite', async () => {
  const state = { items: [{ id: 'old', path: '/movies/Film/Film (2020).mkv', kind: 'movie', group: 'Film (2020)', title: 'Film (2020)' }] };
  const dimensions = { '/movies/Film/Film (2020).mkv': { width: 1280, height: 720 }, '/movies/Film/Film (2020) [1080p] [abcdef12].mkv': { width: 1920, height: 800 } };
  let writes = 0;
  const options = { getState: () => state, probe: async file => ({ video: { ...dimensions[file], codec: 'h264' }, duration: 100 }), stat: async () => ({ size: 1000000, mtimeMs: 1 }), describe: file => ({ id: 'new', path: file, kind: 'movie', title: 'New file' }), persist: async () => writes++, resolveFile: (_target, _config, file) => file };
  const service = createMovieUpgrades(options);
  assert.equal((await service.context('old')).title, 'Film');
  await assert.rejects(service.validate('old', { title: 'Film', quality: '480p', hash: 'a'.repeat(40) }), /higher-resolution/);
  await assert.rejects(service.validate('old', { title: 'Film', quality: '720p', hash: 'a'.repeat(40) }), /higher-resolution/);
  await assert.rejects(service.validate('old', { title: 'Another movie', quality: '1080p', hash: 'a'.repeat(40) }), /does not match/);
  const release = await service.validate('old', { title: 'Film', quality: '1080p', kind: 'movie', hash: 'abcdef12' + 'a'.repeat(32) });
  assert.equal(release.edition, ' [abcdef12]');
  const job = { id: 'job', target: 'local', release, plan: { root: '/movies', files: [{ type: 'video', newPath: 'Film/Film (2020) [1080p] [abcdef12].mkv' }] } };
  await service.prepared(job, {});
  assert.equal(Object.keys(state.pendingDownloadFiles).length, 1);
  await service.completed(job, {});
  assert.equal(state.items.length, 2); assert.equal(state.items[0].path, '/movies/Film/Film (2020).mkv');
  assert.deepEqual(state.movieEditions.old.editions, ['old', 'new']);
  assert.equal(state.movieEditions.old.favorite, 'old');
  await service.favorite('old', 'new');
  assert.equal(state.movieEditions.old.favorite, 'new');
  const restarted = createMovieUpgrades(options);
  assert.equal((await restarted.context('old')).editions.find(item => item.id === 'new').favorite, true);
  const regrouped = restarted.restore(state.items.map(item => ({ ...item, kind: 'show', groupId: 'group' })));
  assert.equal(regrouped.every(item => item.kind === 'movie'), true);
  assert.ok(writes >= 3);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { defaultStorage, storageOptions, planDownload } = require('../electron/download-layout.cjs');
const { createDownloadJobs } = require('../electron/download-jobs.cjs');
const { createPathChecker } = require('../electron/download-files.cjs');
const { connectionError, isTransient } = require('../electron/torrent-connection.cjs');
const file = (index, name, size = 100) => ({ index, name, size, priority: 1 });

test('Cloudflare outages retain the preparation step, back off across restarts and recover automatically', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-reconnect-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = { url: 'https://example.test/torrent/', username: 'u', storage: defaultStorage('server') };
  let clock = 100000, unavailable = true, requests = 0, starts = 0, job;
  const options = { dir, now: () => clock, configFor: async () => config, call: async (_target, route) => {
    requests++;
    if (unavailable) throw connectionError(530);
    if (route.startsWith('torrents/info')) return [{ tags: job.tag, save_path: '/mnt/media/Movies', state: 'stoppedDL' }];
    if (route.startsWith('torrents/files')) return [file(0, 'Film.mkv')];
    if (route === 'torrents/start') { starts++; return ''; }
    throw new Error('Unexpected mutation: ' + route);
  } };
  let jobs = createDownloadJobs(options);
  job = await jobs.create('server', config, { hash: 'd'.repeat(40), title: 'Film', kind: 'movie' }, false);
  job.phase = 'starting'; job.plan = { root: '/mnt/media/Movies', files: [file(0, 'Film.mkv')], skip: [] };
  for (const delay of [10000, 20000, 40000, 60000, 60000]) {
    await jobs.process();
    assert.equal((await jobs.status('server'))[0].phase, 'reconnecting');
    assert.equal((await jobs.status('server'))[0].nextRetryAt, clock + delay);
    const before = requests; await jobs.process(); assert.equal(requests, before);
    clock += delay;
  }
  jobs = createDownloadJobs(options); unavailable = false;
  await jobs.process();
  assert.equal((await jobs.status('server'))[0].phase, 'ready');
  assert.equal((await jobs.status('server'))[0].error, '');
  assert.equal(starts, 1);
  await jobs.process(); assert.equal(starts, 1);
});

test('permanent errors stay stopped and old processing failures recover without retrying failed submissions', async t => {
  assert.equal(isTransient(connectionError(530)), true);
  assert.equal(isTransient(connectionError(429)), true);
  assert.equal(isTransient(connectionError(401)), false);
  assert.equal(isTransient(new Error('A destination file appeared while preparing the torrent; left stopped to protect it.')), false);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-reconnect-old-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = { url: 'https://example.test/', username: 'u', storage: defaultStorage('server') };
  const jobs = createDownloadJobs({ dir, configFor: async () => config, call: async () => { throw connectionError(401); } });
  const job = await jobs.create('server', config, { hash: 'e'.repeat(40), title: 'Film', kind: 'movie' }, false);
  await jobs.process(); assert.equal((await jobs.status('server'))[0].phase, 'error');
  job.phase = 'error'; job.resumePhase = 'ready'; job.error = 'qBittorrent returned HTTP 530. Check Web UI access and retry.';
  const failedAdd = { ...job, id: 'submission', hash: 'f'.repeat(40), resumePhase: undefined };
  await fs.writeFile(path.join(dir, 'download-jobs.json'), JSON.stringify([job, failedAdd]));
  const restored = createDownloadJobs({ dir, configFor: async () => config, call: async () => [{ tags: job.tag, progress: .5 }] });
  await restored.process();
  const status = await restored.status('server');
  assert.equal(status[0].phase, 'ready');
  assert.equal(status[1].phase, 'error');
});

test('default storage matches the inspected server and supports Windows/custom roots', () => {
  assert.deepEqual(defaultStorage('server'), { movieRoot: '/mnt/media/Movies', showRoot: '/mnt/media/Shows', movieFolders: 'title', showFolders: 'season', naming: 'clean', subtitles: true });
  assert.equal(defaultStorage('server', '/mnt/media/downloads/complete').movieRoot, '/mnt/media/Movies');
  assert.equal(defaultStorage('local', 'D:\\Films').showRoot, 'D:\\Shows');
  assert.throws(() => storageOptions({ movieRoot: '../outside' }, 'server'), /absolute folders/);
});
test('movie plan keeps largest feature and matching subtitle names, skips junk and samples', () => {
  const plan = planDownload([file(0, 'Release/Sample.mkv', 10), file(1, 'Release/Film.2020.1080p.mkv', 1000), file(2, 'Release/poster.jpg'), file(3, 'Release/readme.txt'), file(4, 'Release/Subs/English.srt', 20), file(5, 'Release/Subs/Polish.srt', 20), file(6, 'Release/trailer.mp4', 100)], { title: 'Film', year: 2020, kind: 'movie' }, defaultStorage('server'));
  assert.equal(plan.root, '/mnt/media/Movies');
  assert.deepEqual(plan.files.map(file => file.newPath), ['Film/Film (2020) [1080p].mkv', 'Film/Film (2020) [1080p].en.srt', 'Film/Film (2020) [1080p].pl.srt']);
  assert.deepEqual(plan.skip, [0, 2, 3, 6]);
  const noSubs = planDownload([file(0, 'Film.mkv'), file(1, 'Film.srt')], { title: 'Film', kind: 'movie' }, { ...defaultStorage('server'), subtitles: false, movieFolders: 'flat', naming: 'original' });
  assert.deepEqual(noSubs.files.map(file => file.newPath), ['Film.mkv']);
});
test('show plans retain episodes across seasons and only pair subtitles with their own episode', () => {
  const input = [file(10, 'Release/Show.S01E01.mkv'), file(14, 'Release/Show.S01E01.en.srt'), file(18, 'Release/Show.S02E03.mkv'), file(20, 'Release/Show.S02E03.pl.srt'), file(25, 'Release/Extras/Interview.mp4')];
  const result = planDownload(input, { title: 'Show', kind: 'show' }, defaultStorage('server'));
  assert.deepEqual(result.files.map(file => file.newPath), ['Show/S01/S01E01 Show [resolution unknown].mkv', 'Show/S01/S01E01 Show [resolution unknown].en.srt', 'Show/S02/S02E03 Show [resolution unknown].mkv', 'Show/S02/S02E03 Show [resolution unknown].pl.srt']);
  assert.deepEqual(result.skip, [25]);
  assert.equal(planDownload(input, { title: 'Show', kind: 'show' }, { ...defaultStorage('server'), showFolders: 'title' }).files[0].newPath, 'Show/S01E01 Show [resolution unknown].mkv');
});
test('unsafe paths and unsupported media leave downloads stopped', () => {
  assert.throws(() => planDownload([file(0, '../Movie.mkv')], { title: 'Movie' }, defaultStorage('server')), /unsafe/);
  assert.throws(() => planDownload([file(0, 'movie.exe')], { title: 'Movie' }, defaultStorage('server')), /No playable/);
  assert.throws(() => planDownload([file(0, 'episode.mkv')], { title: 'Show', kind: 'show' }, defaultStorage('server')), /numbers are missing/);
});
test('preparation persists, filters by file index, verifies renames and starts only after relocation', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-jobs-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = { url: 'http://localhost:8080/', username: 'u', storage: defaultStorage('server') }, commands = [];
  let torrent, names = [file(0, 'Release/Film.mkv', 1000), file(2, 'Release/Film.en.srt', 20), file(5, 'Release/readme.txt')];
  const options = { dir, configFor: async () => config, call: async (_target, route, data) => {
    commands.push({ route, data });
    if (route.startsWith('torrents/info')) return torrent ? [torrent] : [];
    if (route.startsWith('torrents/files')) return names;
    if (route === 'torrents/filePrio') for (const id of data.id.split('|').map(Number)) names.find(file => file.index === id).priority = +data.priority;
    if (route === 'torrents/renameFile') names.find(file => file.name === data.oldPath).name = data.newPath;
    if (route === 'torrents/setLocation') torrent.save_path = data.location;
    return '';
  } };
  let jobs = createDownloadJobs(options);
  const job = await jobs.create('server', config, { hash: 'a'.repeat(40), title: 'Film', year: 2020, kind: 'movie' }, false);
  torrent = { tags: job.tag, save_path: job.stage, state: 'stoppedDL' };
  await jobs.process();
  assert.equal(commands.some(call => call.route === 'torrents/start'), false);
  assert.equal(names.find(file => file.index === 5).priority, 0);
  jobs = createDownloadJobs(options); // a restart resumes the persisted plan
  await jobs.process();
  assert.equal(commands.some(call => call.route === 'torrents/start'), false);
  await jobs.process();
  assert.equal(commands.at(-1).route, 'torrents/start');
  assert.equal((await jobs.status('server'))[0].phase, 'ready');
  assert.equal((await jobs.status('server'))[0].skipped, 1);
});
test('jobs refuse to mutate torrents without their unique ownership tag', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-jobs-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [], config = { url: 'http://localhost/', username: 'u', storage: defaultStorage('server') };
  const jobs = createDownloadJobs({ dir, configFor: async () => config, call: async (_target, route) => { calls.push(route); return [{ tags: 'other-user-torrent' }]; } });
  await jobs.create('server', config, { hash: 'b'.repeat(40), title: 'Film', kind: 'movie' }, true);
  await jobs.process();
  assert.equal(calls.length, 1); assert.match((await jobs.status('server'))[0].error, /left unchanged/);
});
test('existing local files are detected and remote checks require the matching SSH source', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-paths-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const checker = createPathChecker({ remote: {}, connections: () => [] });
  assert.equal(await checker('local', {}, [path.join(dir, 'new.mkv')]), false);
  await fs.writeFile(path.join(dir, 'old.mkv'), 'existing');
  assert.equal(await checker('local', {}, [path.join(dir, 'old.mkv')]), true);
  await assert.rejects(checker('server', { url: 'http://host:8080' }, ['/mnt/media/Movies/Film.mkv']), /Connect SSH/);
});

test('public torrent URLs use the explicit SSH host and still enforce media root boundaries', async () => {
  const checked = [];
  const checker = createPathChecker({
    connections: () => [{ host: '192.168.100.6', directory: '/mnt/media' }],
    remote: { register: () => 'remote-root', stat: async file => { checked.push(file); throw Object.assign(new Error('Missing'), { code: 'ENOENT' }); } },
  });
  const config = { url: 'https://dakowicz.xyz/torrent/', sshHost: '192.168.100.6' };
  assert.equal(await checker('server', config, ['/mnt/media/Movies/Film.mkv']), false);
  assert.deepEqual(checked, [path.join('remote-root', 'Movies/Film.mkv')]);
  await assert.rejects(checker('server', { ...config, sshHost: 'other-server' }, ['/mnt/media/Movies/Film.mkv']), /Connect SSH/);
  await assert.rejects(checker('server', config, ['/mnt/media-other/Film.mkv']), /Connect SSH/);
  await assert.rejects(checker('server', { url: config.url }, ['/mnt/media/Movies/Film.mkv']), /Connect SSH/);
});

test('removing during preparation waits for in-flight work and prevents a later restart', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-remove-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = { url: 'http://localhost/', username: 'u', storage: defaultStorage('server') };
  let enter, release;
  const entered = new Promise(resolve => enter = resolve), gate = new Promise(resolve => release = resolve);
  const calls = [];
  let job;
  const jobs = createDownloadJobs({ dir, configFor: async () => config, call: async (_target, route) => {
    calls.push(route);
    if (route.startsWith('torrents/info')) { enter(); await gate; return [{ tags: job.tag }]; }
    if (route.startsWith('torrents/files')) return [];
  } });
  job = await jobs.create('server', config, { hash: 'c'.repeat(40), title: 'Film', kind: 'movie' }, true);
  const processing = jobs.process(); await entered;
  let removed = false;
  const removing = jobs.remove('server', job.hash, async () => { removed = true; });
  assert.equal(removed, false);
  release(); await processing; await removing; await jobs.process();
  assert.equal(removed, true);
  assert.deepEqual(await jobs.status('server'), []);
  assert.equal(calls.includes('torrents/start'), false);
});

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { planDownload, join } = require('./download-layout.cjs');
const { isTransient, retryDelay } = require('./torrent-connection.cjs');

function createDownloadJobs({ dir, call, configFor, checkPaths = async () => false, onPrepared = async () => {}, onComplete = async () => {}, now = Date.now }) {
  const file = path.join(dir, 'download-jobs.json');
  let jobs = [], writing = Promise.resolve(), running, timer, closed = false;
  const removing = new Set();
  const loaded = fs.readFile(file, 'utf8').then(data => {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) throw new Error('Invalid job list');
    jobs = parsed;
    for (const job of jobs) {
      // Only revive old failures from processing an existing torrent, never failed submissions.
      if (job.phase === 'error' && job.resumePhase && isTransient(new Error(job.error))) {
        job.phase = job.resumePhase; job.nextRetryAt = now(); job.retryAttempts = 0;
      }
    }
  }).catch(error => { if (error.code !== 'ENOENT') throw new Error('Download preparation history could not be read. Restore download-jobs.json before adding more downloads.'); });
  void loaded.catch(() => {});
  function persist() {
    const contents = JSON.stringify(jobs);
    writing = writing.catch(() => {}).then(async () => { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file + '.tmp', contents); await fs.rename(file + '.tmp', file); });
    return writing;
  }
  function snapshot(target) { return jobs.filter(job => job.target === target).map(({ id, hash, release, storage, phase, error, plan, seed, nextRetryAt }) => ({ id, hash, title: release.title, year: release.year, kind: release.kind, sourceId: release.sourceId, phase: nextRetryAt ? 'reconnecting' : phase, error, seed, nextRetryAt, selected: plan?.files.length || 0, skipped: plan?.skip.length || 0, finalRoot: plan?.root || (release.kind === 'show' ? storage.showRoot : storage.movieRoot) })); }
  async function processOne(job) {
    const config = await configFor(job.target);
    if (!config || config.url !== job.url || config.username !== job.username) throw new Error('Reconnect the original download client before retrying preparation.');
    const request = (route, data) => call(job.target, route, data, config);
    const info = await request(`torrents/info?hashes=${job.hash}`);
    if (!Array.isArray(info) || !info.length) {
      if (Date.now() - job.created < 60000) return;
      throw new Error('Torrent is not in the client. Add it again after checking qBittorrent.');
    }
    if (!String(info[0].tags || '').split(',').map(tag => tag.trim()).includes(job.tag)) throw new Error('This torrent was not created by this download job; left unchanged.');
    if (job.phase === 'ready') {
      if (info[0].progress >= 1 && info[0].state !== 'moving') { await onComplete(job, config); job.phase = 'complete'; await persist(); }
      return;
    }
    const files = await request(`torrents/files?hash=${job.hash}`);
    if (!Array.isArray(files) || !files.length) return;
    if (!job.plan) {
      await request('torrents/stop', { hashes: job.hash });
      let plan = planDownload(files, job.release, job.storage);
      if (await checkPaths(job.target, config, plan.files.map(item => join(plan.root, item.newPath)))) {
        plan = planDownload(files, { ...job.release, edition: ` [${job.hash.slice(0, 8)}]` }, job.storage);
        if (await checkPaths(job.target, config, plan.files.map(item => join(plan.root, item.newPath)))) throw new Error('A matching edition already exists in the library. Choose another filename style or destination before retrying.');
      }
      job.plan = plan; job.phase = 'preparing'; await persist();
    }
    if (job.phase === 'moving') {
      const normalized = value => String(value || '').replace(/\\/g, '/').replace(/\/$/, '');
      if (info[0].state === 'moving') return;
      if (normalized(info[0].save_path) !== normalized(job.plan.root)) { await request('torrents/setLocation', { hashes: job.hash, location: job.plan.root }); return; }
      job.phase = 'starting'; await persist();
    }
    if (job.phase === 'starting') {
      // Persist the intent first. A restart may safely reissue start before ready.
      await request('torrents/start', { hashes: job.hash });
      job.phase = 'ready'; job.error = ''; await persist(); return;
    }
    if (job.phase !== 'preparing') return;
    const desired = new Set(job.plan.files.map(item => item.index));
    const indexed = files.map((item, position) => ({ ...item, index: item.index ?? position }));
    const skip = indexed.filter(item => !desired.has(item.index) && item.priority !== 0).map(item => item.index);
    if (skip.length) await request('torrents/filePrio', { hash: job.hash, id: skip.join('|'), priority: '0' });
    const keep = indexed.filter(item => desired.has(item.index) && item.priority !== 1).map(item => item.index);
    if (keep.length) await request('torrents/filePrio', { hash: job.hash, id: keep.join('|'), priority: '1' });
    let renamed = false;
    for (const item of job.plan.files) {
      const current = indexed.find(file => file.index === item.index);
      if (!current) throw new Error('Torrent file list changed unexpectedly; left stopped.');
      if (current.name.replace(/\\/g, '/') !== item.newPath) {
        await request('torrents/renameFile', { hash: job.hash, oldPath: current.name, newPath: item.newPath }); renamed = true;
      }
    }
    // Renaming and priority updates are asynchronous in qBittorrent. Verify on the next pass.
    if (renamed || skip.length || keep.length) return;
    if (await checkPaths(job.target, config, job.plan.files.map(item => join(job.plan.root, item.newPath)))) throw new Error('A destination file appeared while preparing the torrent; left stopped to protect it.');
    await onPrepared(job, config);
    job.phase = 'moving'; await persist();
    await request('torrents/setLocation', { hashes: job.hash, location: job.plan.root });
  }
  async function process() {
    if (closed) return;
    if (running) return running;
    running = (async () => {
      await loaded;
      for (const job of jobs) {
        if (closed) break;
        if (['complete', 'error'].includes(job.phase) || removing.has(`${job.target}:${job.hash}`)) continue;
        if (job.nextRetryAt && now() < job.nextRetryAt) continue;
        try {
          await processOne(job);
          if (job.nextRetryAt || job.retryAttempts) { job.nextRetryAt = 0; job.retryAttempts = 0; job.error = ''; await persist(); }
        }
        catch (error) {
          job.error = error.message;
          if (isTransient(error)) {
            job.retryAttempts = (job.retryAttempts || 0) + 1;
            job.nextRetryAt = now() + retryDelay(job.retryAttempts);
          } else { job.resumePhase = job.phase; job.phase = 'error'; job.nextRetryAt = 0; }
          await persist();
        }
      }
    })().finally(() => { running = null; });
    return running;
  }
  return {
    async remove(target, hash, removeTorrent) {
      const key = `${target}:${hash}`;
      if (removing.has(key)) throw new Error('This download is already being removed.');
      removing.add(key);
      try {
        await loaded;
        // Let an in-flight preparation finish before deleting the torrent. Future ticks skip it.
        if (running) await running;
        const matching = jobs.filter(job => job.target === target && job.hash === hash);
        await removeTorrent(matching);
        jobs = jobs.filter(job => job.target !== target || job.hash !== hash);
        await persist();
      } finally { removing.delete(key); }
    },
    async create(target, config, release, seed) {
      await loaded;
      const id = randomUUID(), root = release.kind === 'show' ? config.storage.showRoot : config.storage.movieRoot;
      const job = { id, tag: `matro-${id}`, target, hash: release.hash, url: config.url, username: config.username, release, storage: config.storage, seed, created: Date.now(), phase: 'metadata', error: '', stage: join(root, `.matro-pending/${id}`) };
      jobs.push(job); await persist(); return job;
    },
    async fail(job, error) { job.phase = 'error'; job.error = error.message; await persist(); },
    async status(target) { await loaded; return snapshot(target); },
    async retry(id) { await loaded; const job = jobs.find(item => item.id === id); if (!job || job.phase !== 'error') throw new Error('No failed preparation to retry.'); job.phase = job.resumePhase || (job.plan ? 'preparing' : 'metadata'); job.error = ''; await persist(); },
    process,
    start() {
      const tick = async () => { if (closed) return; await process().catch(() => {}); if (!closed) { timer = setTimeout(tick, 2000); timer.unref?.(); } };
      void tick();
    },
    close() { closed = true; clearTimeout(timer); }
  };
}
module.exports = { createDownloadJobs };

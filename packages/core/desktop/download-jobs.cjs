const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { planDownload, join } = require('./download-layout.cjs');
const { isTransient, retryDelay } = require('./torrent-connection.cjs');

const seasonSlots = 2;
const metadataTimeout = 180000;
const payloadStallTimeout = 600000;
const maximumStallRetries = 3;
const owns = (job, torrent) => String(torrent.tags || '').split(',').some(tag => tag.trim() === job.tag);
const terminal = job => ['complete', 'error'].includes(job.phase);

function createDownloadJobs({ dir, call, configFor, submit, checkPaths = async () => false, onPrepared = async () => {}, onComplete = async () => {}, now = Date.now }) {
  const file = path.join(dir, 'download-jobs.json');
  let jobs = [], writing = Promise.resolve(), running, timer, closed = false;
  const removing = new Set(), saving = new Set();
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
  function snapshot(target) { return jobs.filter(job => job.target === target).map(({ id, hash, release, storage, phase, error, plan, seed, nextRetryAt }) => ({ id, hash, title: release.title, year: release.year, kind: release.kind, sourceId: release.sourceId, season: release.season, episode: release.episode, phase: nextRetryAt ? 'reconnecting' : phase, error, seed, nextRetryAt, selected: plan?.files.length || 0, skipped: plan?.skip.length || 0, finalRoot: plan?.root || (release.kind === 'show' ? storage.showRoot : storage.movieRoot) })); }
  async function finish(job, config) {
    if (!job.finished) { job.finished = true; await persist(); }
    await onComplete(job, config);
    job.phase = 'complete'; job.error = '';
    await persist();
  }
  async function deferStall(job, request, resume, reason, torrentExists = true) {
    if (torrentExists) await request('torrents/stop', { hashes: job.hash });
    const counter = resume === 'metadata' ? 'metadataStalls' : 'payloadStalls';
    if ((job[counter] || 0) >= maximumStallRetries) {
      throw new Error(`${reason} Check peers and qBittorrent, then retry preparation.`);
    }
    job[counter] = (job[counter] || 0) + 1;
    job.phase = 'queued'; job.queueResumePhase = resume;
    job.availableAt = now() + 30000 * 2 ** (job[counter] - 1);
    job.stalledSince = null;
    job.error = `${reason} Matro will retry when a slot opens.`;
    await persist();
  }
  async function dispatch(job, config, request, torrent) {
    const resume = job.queueResumePhase || 'metadata';
    if (torrent && !owns(job, torrent)) {
      if (job.queueResumePhase) throw new Error('This torrent was replaced in qBittorrent; left unchanged.');
      jobs = jobs.filter(item => item !== job);
      await persist();
      return;
    }
    if (resume === 'metadata') {
      if (!torrent) await submit(job.target, config, job);
      else if (job.queueResumePhase && /^(stopped|paused)/.test(torrent.state)) await request('torrents/start', { hashes: job.hash });
    } else if (!torrent) {
      throw new Error('Torrent is no longer in qBittorrent. Add the episode again.');
    }
    job.phase = resume; job.created = now(); job.error = '';
    job.availableAt = 0; job.queueResumePhase = null;
    await persist();
  }
  async function processOne(job) {
    const config = await configFor(job.target);
    if (!config || config.url !== job.url || config.username !== job.username) throw new Error('Reconnect the original download client before retrying preparation.');
    if (job.finished) { await finish(job, config); return; }
    const request = (route, data) => call(job.target, route, data, config);
    const info = await request(`torrents/info?hashes=${job.hash}`);
    if (job.phase === 'queued') {
      if (!Array.isArray(info)) throw new Error('qBittorrent returned an invalid torrent list.');
      await dispatch(job, config, request, info[0]);
      return;
    }
    if (!Array.isArray(info) || !info.length) {
      if (now() - job.created < 60000) return;
      if (job.release.seasonBatch && job.phase === 'metadata' && Array.isArray(info)) {
        await deferStall(job, request, 'metadata', 'The episode did not appear in qBittorrent.', false);
        return;
      }
      throw new Error('Torrent is not in the client. Add it again after checking qBittorrent.');
    }
    if (!owns(job, info[0])) throw new Error('This torrent was not created by this download job; left unchanged.');
    if (job.phase === 'ready') {
      if (['error', 'missingFiles'].includes(info[0].state)) throw new Error('qBittorrent cannot write or find the download files. Check disk space, permissions and the destination mount, then retry.');
      if (info[0].progress >= 1 && info[0].state !== 'moving') { await finish(job, config); return; }
      if (job.release.seasonBatch) {
        const stalled = ['stalledDL', 'queuedDL'].includes(info[0].state);
        const stopped = /^(stopped|paused)/.test(info[0].state || '');
        if (stalled && job.stalledSince != null && now() - job.stalledSince >= payloadStallTimeout) {
          await deferStall(job, request, 'starting', 'The episode transfer stalled.');
        } else if (stalled !== (job.stalledSince != null) || stopped !== !!job.stopped) {
          job.stalledSince = stalled ? now() : null;
          job.stopped = stopped;
          await persist();
        }
      }
      return;
    }
    const files = await request(`torrents/files?hash=${job.hash}`);
    if (!Array.isArray(files) || !files.length || ['metaDL', 'forcedMetaDL', 'stoppedMetaDL'].includes(info[0].state)) {
      if (now() - job.created > metadataTimeout) {
        if (!job.release.seasonBatch) throw new Error('Torrent metadata has not arrived. Check peers, DHT and trackers in qBittorrent, then retry; the small metadata cache is not the movie.');
        await deferStall(job, request, 'metadata', 'Torrent metadata stalled.');
        return;
      }
      if (info[0].state === 'stoppedMetaDL') await request('torrents/start', { hashes: job.hash });
      return;
    }
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
      job.phase = 'verifying'; job.startRequested = now(); job.error = ''; await persist(); return;
    }
    if (job.phase === 'verifying') {
      if (['error', 'missingFiles'].includes(info[0].state)) throw new Error('qBittorrent cannot write the download. Check disk space, permissions and the destination mount.');
      // A tiny/previously completed torrent can finish and stop before our next poll.
      if (info[0].progress >= 1 && info[0].state !== 'moving') { await finish(job, config); return; }
      if (/^(stopped|paused)/.test(info[0].state || '')) {
        if (now() - job.startRequested > 30000) {
          if (!job.release.seasonBatch) throw new Error('qBittorrent kept the download stopped after starting. Check client limits and the destination, then retry.');
          await deferStall(job, request, 'starting', 'qBittorrent kept the episode stopped.');
          return;
        }
        await request('torrents/start', { hashes: job.hash }); return;
      }
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
  async function advance(job) {
    try {
      await processOne(job);
      if (job.nextRetryAt || job.retryAttempts) {
        job.nextRetryAt = 0; job.retryAttempts = 0;
        if (job.phase !== 'queued') job.error = '';
        await persist();
      }
    } catch (error) {
      job.error = error.message;
      if (isTransient(error)) {
        job.retryAttempts = (job.retryAttempts || 0) + 1;
        job.nextRetryAt = now() + retryDelay(job.retryAttempts);
      } else { job.resumePhase = job.phase; job.phase = 'error'; job.nextRetryAt = 0; }
      await persist();
    }
  }
  async function process() {
    if (closed) return;
    if (running) return running;
    running = (async () => {
      await loaded;
      const canRun = job => !saving.has(job) && !removing.has(`${job.target}:${job.hash}`) && !(job.nextRetryAt && now() < job.nextRetryAt);
      for (const job of jobs) {
        if (closed) break;
        if (!terminal(job) && job.phase !== 'queued' && canRun(job)) await advance(job);
      }
      const waiting = jobs.filter(job => job.phase === 'queued').sort((a, b) => (a.availableAt || 0) - (b.availableAt || 0));
      const active = jobs.filter(job => job.release.seasonBatch && !terminal(job) && job.phase !== 'queued' && !job.stopped);
      const attempted = new Set();
      for (const job of waiting) {
        if (closed) break;
        if (attempted.has(job.target) || job.availableAt > now() || !canRun(job)) continue;
        const occupying = active.filter(item => item.target === job.target);
        if (occupying.length >= seasonSlots || (job.queueResumePhase ?? 'metadata') === 'metadata' && occupying.some(item => item.phase === 'metadata')) continue;
        attempted.add(job.target);
        await advance(job);
      }
    })().finally(() => { running = null; });
    return running;
  }
  function newJob(target, config, release, seed, phase) {
    const id = randomUUID(), root = release.kind === 'show' ? config.storage.showRoot : config.storage.movieRoot;
    return { id, tag: `matro-${id}`, target, hash: release.hash, url: config.url, sshHost: config.sshHost, username: config.username, release, storage: config.storage, seed, created: now(), phase, error: '', stage: join(root, `.matro-pending/${id}`) };
  }
  return {
    async pendingVideos() {
      await loaded;
      return jobs.filter(job => job.plan && !job.finished && job.phase !== 'complete').map(job => ({
        target: job.target, url: job.url, sshHost: job.sshHost,
        paths: job.plan.files.filter(file => file.type === 'video').map(file => join(job.plan.root, file.newPath))
      }));
    },
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
      const job = newJob(target, config, release, seed, 'metadata');
      jobs.push(job); await persist(); return job;
    },
    async enqueue(target, config, releases, seed) {
      await loaded;
      const existing = new Set(jobs.filter(job => job.target === target && job.url === config.url && job.username === config.username && job.phase !== 'complete').map(job => job.hash));
      const queued = [], duplicates = [];
      for (const release of releases) {
        if (existing.has(release.hash)) duplicates.push(release.hash);
        else queued.push(newJob(target, config, release, seed, 'queued'));
      }
      if (queued.length) {
        for (const job of queued) saving.add(job);
        jobs.push(...queued);
        try { await persist(); }
        catch (error) { jobs = jobs.filter(job => !queued.includes(job)); throw error; }
        finally { for (const job of queued) saving.delete(job); }
      }
      return { queued: queued.map(job => job.hash), duplicates };
    },
    async hasSeasonJob(target, config, hash) {
      await loaded;
      return jobs.some(job => job.target === target && job.url === config.url && job.username === config.username && job.hash === hash && job.release.seasonBatch && !terminal(job));
    },
    async fail(job, error) { job.phase = 'error'; job.error = error.message; await persist(); },
    async status(target) { await loaded; return snapshot(target); },
    async retry(id) {
      await loaded;
      const job = jobs.find(item => item.id === id);
      if (!job || job.phase !== 'error') throw new Error('No failed preparation to retry.');
      const resume = job.resumePhase === 'verifying' || job.release.seasonBatch && job.resumePhase === 'ready' ? 'starting' : job.resumePhase || (job.plan ? 'preparing' : 'metadata');
      job.phase = resume;
      if (job.release.seasonBatch && !job.finished) {
        job.phase = 'queued'; job.queueResumePhase = resume === 'queued' ? job.queueResumePhase : resume;
        job.availableAt = 0; job.metadataStalls = 0; job.payloadStalls = 0; job.stalledSince = null; job.stopped = false;
      }
      job.created = now(); job.nextRetryAt = 0; job.retryAttempts = 0; job.error = ''; await persist();
    },
    process,
    start() {
      const tick = async () => { if (closed) return; await process().catch(() => {}); if (!closed) { timer = setTimeout(tick, 2000); timer.unref?.(); } };
      void tick();
    },
    close() { closed = true; clearTimeout(timer); }
  };
}
module.exports = { createDownloadJobs };

const fs = require('node:fs/promises');
const { idFor } = require('./media.cjs');
const titleKey = item => item.groupId || item.group;
const order = (a, b) => a.season - b.season || a.episode - b.episode || a.path.localeCompare(b.path);
const sameSeason = (a, b) => a.kind === 'show' && b.kind === 'show' && titleKey(a) === titleKey(b) && a.season === b.season;

function prioritizeEpisodes(state, currentId) {
  const shows = new Map();
  for (const item of state.items.filter(i => i.kind === 'show').sort(order)) {
    const key = titleKey(item); if (!shows.has(key)) shows.set(key, []); shows.get(key).push(item);
  }
  const current = state.items.find(i => i.id === currentId);
  const ranked = [...shows.values()].map(items => {
    const recent = items.filter(i => { const p = state.progress[i.id]; return p && !p.hidden && (p.position > 0 || p.completed); }).sort((a, b) => (state.progress[b.id].updated || 0) - (state.progress[a.id].updated || 0))[0];
    let resume = recent;
    if (resume && state.progress[resume.id].completed) {
      const lastComplete = items.reduce((last, item, index) => state.progress[item.id]?.completed ? index : last, -1);
      resume = items.slice(lastComplete + 1).find(i => !state.progress[i.id]?.completed);
    }
    const active = current?.kind === 'show' && titleKey(current) === titleKey(items[0]);
    const start = active ? items.findIndex(i => i.id === currentId) : resume ? items.findIndex(i => i.id === resume.id) : 0;
    return { items: [...items.slice(start), ...items.slice(0, start)], active, watching: !!resume, updated: recent ? state.progress[recent.id].updated || 0 : 0 };
  }).sort((a, b) => Number(b.active) - Number(a.active) || Number(b.watching) - Number(a.watching) || b.updated - a.updated || String(titleKey(a.items[0])).localeCompare(String(titleKey(b.items[0]))));
  return ranked.flatMap(group => group.items).filter(item => state.items.some(i => i.id !== item.id && sameSeason(i, item)));
}

function mergeMarkers(existing, detected, dismissed = []) {
  const manual = (existing || []).filter(s => s.source !== 'automatic');
  const automatic = [...(existing || []).filter(s => s.source === 'automatic'), ...detected].filter(s => !manual.some(m => m.start < s.end && m.end > s.start) && !dismissed.some(m => m.type === s.type && m.start < s.end && m.end > s.start)).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const marker of automatic) {
    const prior = merged.at(-1);
    if (prior && prior.type === marker.type && marker.start <= prior.end + (marker.type === 'outro' ? 10 : 2)) prior.end = Math.max(prior.end, marker.end);
    else merged.push({ ...marker });
  }
  return [...manual, ...merged];
}

function createSegmentScheduler({ getState, engine, persist, onUpdate = () => {}, delay = 200 }) {
  let timer, active = null, currentId = null, closed = false, running = false, playing = false, buffering = false;
  let status = { running: false, ready: 0, total: 0, message: 'Preparing background scan…' };
  const waiters = new Map(), stats = new Map();
  function snapshot() { return { ...status }; }
  function publish(update = {}) { onUpdate({ ...update, scanner: snapshot() }); }
  function refresh() { if (!closed && !running && !timer) timer = setTimeout(() => { timer = null; void run(); }, delay); }
  function settle(id, error, markers) {
    for (const waiter of waiters.get(id) || []) error ? waiter.reject(error) : waiter.resolve(markers);
    waiters.delete(id);
  }
  async function signature(items) {
    const parts = [];
    for (const item of items) {
      let entry = stats.get(item.path);
      if (!entry || Date.now() - entry.checked > 60000) {
        try { const stat = await fs.stat(item.path); entry = { checked: Date.now(), value: `${stat.size}:${stat.mtimeMs}` }; }
        catch { entry = { checked: Date.now(), value: 'unavailable' }; }
        stats.set(item.path, entry);
      }
      parts.push(`${item.id}:${item.path}:${entry.value}`);
    }
    return idFor('background-v1:' + parts.sort().join('|'));
  }
  async function run() {
    if (running || closed) return;
    running = true;
    let job;
    try {
      const state = getState(); state.segmentScans ||= {}; state.markers ||= {};
      const ordered = prioritizeEpisodes(state, currentId), signatures = new Map();
      for (const mode of ['quick', 'full']) {
        for (const item of ordered) {
          const siblings = state.items.filter(i => i.id !== item.id && sameSeason(i, item));
          const key = `${titleKey(item)}:${item.season}`;
          if (!signatures.has(key)) signatures.set(key, await signature([item, ...siblings]));
          const stamp = signatures.get(key), scan = state.segmentScans[item.id];
          if (scan?.signature === stamp && (scan[mode] || scan.retryAt > Date.now())) continue;
          job = { item, siblings, mode, signature: stamp }; break;
        }
        if (job) break;
      }
      status.ready = ordered.filter(i => state.segmentScans[i.id]?.quick).length; status.total = ordered.length;
      if (!job || closed) {
        const unavailable = ordered.some(i => state.segmentScans[i.id]?.retryAt > Date.now());
        status = { ...status, running: false, id: null, message: unavailable ? 'Some episodes unavailable; retrying shortly' : ordered.length ? 'Background scan complete' : 'No seasons to scan' }; publish();
        return;
      }
      const { item, siblings, mode, signature: stamp } = job;
      active = { id: item.id, controller: new AbortController() };
      if (state.segmentScans[item.id]?.signature !== stamp) {
        if (state.segmentScans[item.id]?.signature && state.markerDismissals) delete state.markerDismissals[item.id];
        state.segmentScans[item.id] = { signature: stamp };
        state.markers[item.id] = (state.markers[item.id] || []).filter(s => s.source !== 'automatic');
      }
      status = { ...status, running: true, id: item.id, group: item.group, title: item.title, phase: mode, message: `${mode === 'quick' ? 'Preparing' : 'Checking full episode'} · ${item.group} · S${item.season} E${item.episode}` };
      publish({ id: item.id, stage: 'started', mode });
      const markers = await engine.detect(item, siblings, update => {
        if (closed || !getState().items.some(i => i.id === item.id)) return;
        if (update.stage === 'decoding') status.message = `${playing ? 'Scanning gently' : 'Scanning'} · ${update.scanTitle || item.title} · ${update.percent}%`;
        if (update.markers) {
          getState().markers[item.id] = mergeMarkers(getState().markers[item.id], update.markers, getState().markerDismissals?.[item.id]);
          void persist().catch(() => {});
        }
        publish({ id: item.id, mode, ...update, ...(update.markers ? { markers: getState().markers[item.id] } : {}) });
      }, { mode, signal: active.controller.signal, playback: playing, readRate: buffering ? .5 : 4 });
      if (closed || !getState().items.some(i => i.id === item.id)) return;
      const latest = getState();
      latest.markers[item.id] = mergeMarkers(latest.markers[item.id], markers, latest.markerDismissals?.[item.id]);
      latest.segmentScans[item.id] = { ...latest.segmentScans[item.id], signature: stamp, [mode]: true, retryAt: 0 };
      await persist();
      status = { ...status, running: false, id: null, ready: prioritizeEpisodes(latest, currentId).filter(i => latest.segmentScans[i.id]?.quick).length };
      publish({ id: item.id, stage: 'done', mode, markers: latest.markers[item.id] });
      settle(item.id, null, latest.markers[item.id]);
    } catch (error) {
      if (!closed && job) {
        if (error.name !== 'AbortError') {
          getState().segmentScans[job.item.id] = { ...getState().segmentScans[job.item.id], retryAt: Date.now() + 5 * 60000 };
          await persist().catch(() => {});
          publish({ id: job.item.id, stage: 'error', message: error.message });
        }
        if (error.name !== 'AbortError' || currentId !== job.item.id) settle(job.item.id, error);
      }
    } finally {
      active = null; running = false;
      if (!closed) { if (job) refresh(); else timer = setTimeout(() => { timer = null; void run(); }, 30000); }
    }
  }
  return {
    snapshot, refresh,
    setPlayback(value, isBuffering = false) {
      if (playing === value && buffering === isBuffering) return;
      playing = value; buffering = isBuffering; clearTimeout(timer); timer = null;
      // Restart with a gentler read rate and a lower OS priority while watching.
      // Completed minute-sized chunks remain cached across this restart.
      active?.controller.abort();
      status = { ...status, running: false, playback: playing, buffering, id: null, message: buffering ? 'Scanning slowly · video is buffering' : playing ? 'Scanning gently · playback has priority' : 'Background scan running at normal speed' };
      publish({ id: currentId, stage: 'resource-mode' }); refresh();
    },
    invalidate() { stats.clear(); if (active && !getState().items.some(i => i.id === active.id)) active.controller.abort(); if (timer) { clearTimeout(timer); timer = null; } refresh(); },
    setCurrent(id) {
      if (id === currentId) return;
      currentId = id;
      if (active && id && active.id !== id) active.controller.abort();
      if (timer) { clearTimeout(timer); timer = null; } refresh();
    },
    request(id, force = false) {
      const state = getState();
      if (!state.items.some(i => i.id === id && i.kind === 'show')) return Promise.resolve([]);
      if (!state.items.some(i => i.id !== id && sameSeason(i, state.items.find(i => i.id === id)))) return Promise.resolve(state.markers?.[id] || []);
      if (force) { delete (state.segmentScans ||= {})[id]; if (state.markerDismissals) delete state.markerDismissals[id]; stats.clear(); if (active?.id === id) active.controller.abort(); }
      if (!force && state.segmentScans?.[id]?.quick) return Promise.resolve(state.markers?.[id] || []);
      const result = new Promise((resolve, reject) => { if (!waiters.has(id)) waiters.set(id, []); waiters.get(id).push({ resolve, reject }); });
      this.setCurrent(id); refresh(); return result;
    },
    close() { closed = true; clearTimeout(timer); active?.controller.abort(); engine.close(); for (const id of waiters.keys()) settle(id, Object.assign(new Error('Scanner closed'), { name: 'AbortError' })); }
  };
}
module.exports = { createSegmentScheduler, prioritizeEpisodes, mergeMarkers };

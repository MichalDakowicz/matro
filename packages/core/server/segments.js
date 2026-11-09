const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const config = require('./config');
const { probe } = require('./media');
const { createSegments } = require('../desktop/segments.cjs');
const { createSegmentScheduler, mergeMarkers } = require('../desktop/segment-scheduler.cjs');

function createScanner({ dataDir, db }) {
  const file = path.join(dataDir, 'segments.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* First scan. */ }
  const state = { markers: saved.markers || {}, segmentScans: saved.segmentScans || {}, progress: {} };
  const items = db.prepare('SELECT id, path, title, group_id AS groupId, group_title AS "group", kind, season, episode FROM items');
  let writes = Promise.resolve();
  const persist = () => {
    const data = JSON.stringify({ markers: state.markers, segmentScans: state.segmentScans });
    writes = writes.catch(() => {}).then(async () => {
      await fs.promises.writeFile(file + '.tmp', data);
      await fs.promises.rename(file + '.tmp', file);
    });
    return writes;
  };
  const engine = createSegments(path.join(dataDir, 'segment-cache'), {
    fs: fs.promises, probe, ffmpeg: config.ffmpeg,
    run: (binary, args, options) => new Promise((resolve, reject) => {
      const child = execFile(binary, args, { ...options, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => error ? reject(error.name === 'AbortError' ? error : new Error(String(stderr).slice(-600) || error.message)) : resolve(stdout));
      if (options.priority !== undefined && child.pid) try { os.setPriority(child.pid, options.priority); } catch { /* Best effort. */ }
    })
  });
  const scheduler = createSegmentScheduler({ getState: () => { state.items = items.all(); return state; }, engine, persist });
  return {
    ...scheduler,
    markers: (manual = {}, dismissed = {}) => {
      const result = Object.fromEntries(Object.entries(manual).filter(([, marks]) => Array.isArray(marks)).map(([id, marks]) => [id, marks.filter(m => m && m.source !== 'automatic')]));
      for (const [id, detected] of Object.entries(state.markers)) result[id] = mergeMarkers(result[id], detected, dismissed[id]);
      return result;
    }
  };
}
module.exports = { createScanner };

const { mediaFS: fs } = require('./ssh-media.cjs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const os = require('node:os');
const { run, ffmpeg, probe, idFor } = require('./media.cjs');

// Perceptual samples: comparisons ignore brightness and minor edits.
function hashFrame(frame) {
  let hash = 0n, changes = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const delta = frame[y * 9 + x] - frame[y * 9 + x + 1];
    hash = (hash << 1n) | BigInt(delta > 0); changes += Math.abs(delta);
  }
  return changes < 100 ? null : hash.toString(16);
}
function popcount(bits) { bits -= (bits >>> 1) & 0x55555555; bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333); return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
function distance(a, b) {
  if (!a || !b) return 64;
  a = a.padStart(16, '0'); b = b.padStart(16, '0');
  return popcount(parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) + popcount(parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16));
}
function detectSegments(target, references) {
  const step = target.step || 2;
  const numbers = hashes => hashes.map(hash => hash ? [parseInt(hash.padStart(16, '0').slice(0, 8), 16), parseInt(hash.slice(-8), 16)] : null);
  const targetNumbers = numbers(target.hashes);
  const matches = [];
  for (const ref of references) {
    const refNumbers = numbers(ref.hashes);
    const compare = (i, j) => {
      const a = targetNumbers[i], b = refNumbers[j];
      return a && b ? popcount(a[0] ^ b[0]) + popcount(a[1] ^ b[1]) : 64;
    };
    // Diagonals allow the same sequence to occur at different episode offsets.
    for (let shift = -ref.hashes.length + 1; shift < target.hashes.length; shift++) {
      let start = -1, last = -1, hits = 0, unique = new Set();
      const flush = () => {
        if (start >= 0 && hits >= Math.ceil(10 / step) && hits / (last - start + 1) >= .65 && unique.size >= 4) {
          const from = start * step, end = Math.min(target.duration, (last + 1) * step);
          const type = from >= target.duration * .7 ? 'outro' : from < Math.min(600, target.duration * .4) ? 'intro' : null;
          if (type) matches.push({ type, start: from, end, source: 'automatic' });
        }
        start = -1; last = -1; hits = 0; unique = new Set();
      };
      for (let i = Math.max(0, shift); i < Math.min(target.hashes.length, ref.hashes.length + shift); i++) {
        const j = i - shift;
        const early = i * step < Math.min(600, target.duration * .4);
        const late = i * step >= target.duration * .7 && j * step >= ref.duration * .7;
        // Adjacent samples tolerate sub-second timing differences and small edits.
        if (!early && !late) { if (start >= 0) flush(); continue; }
        const similarity = step === 1 ? Math.min(compare(i, j - 1), compare(i, j), compare(i, j + 1)) : compare(i, j);
        if ((early || late) && similarity <= 12) {
          if (start < 0) start = i;
          last = i; hits++; unique.add(target.hashes[i]);
        } else if (start >= 0 && i - last > 1) flush();
      }
      flush();
    }
  }
  const merged = [];
  for (const match of matches.sort((a, b) => a.start - b.start)) {
    const prior = merged.at(-1);
    if (prior && match.start <= prior.end + (match.type === 'outro' ? 10 : 2) && prior.type === match.type) prior.end = Math.max(prior.end, match.end);
    else merged.push({ ...match });
  }
  // Early clips copied from story material are recaps; shared opening sequences are intros.
  for (const segment of merged) if (segment.type === 'intro') {
    const copiedStory = references.some(ref => {
      const count = Math.floor((segment.end - segment.start) / step);
      for (let j = Math.ceil(Math.min(600, ref.duration * .4) / step); j + count < ref.hashes.length * .7; j++) {
        let hits = 0;
        for (let k = 0; k < count; k++) if (distance(target.hashes[segment.start / step + k], ref.hashes[j + k]) <= 12) hits++;
        if (hits / count >= .72) return true;
      }
      return false;
    });
    if (copiedStory) segment.type = 'recap';
  }
  return merged;
}
function createSegments(cacheDirectory) {
  const pending = new Map();
  const controller = new AbortController();
  async function fingerprint(item, mode, signal, options = {}) {
    const stat = await fs.stat(item.path);
    const fullKey = idFor(`${item.path}:${stat.size}:${stat.mtimeMs}:v2`);
    // Full fingerprints from earlier versions remain usable by the fast pass.
    try { return JSON.parse(await fs.readFile(path.join(cacheDirectory, fullKey + '.json'), 'utf8')); } catch { /* Not fully scanned yet. */ }
    const key = mode === 'quick' ? idFor(`${fullKey}:edges-v1`) : fullKey;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const file = path.join(cacheDirectory, key + '.json');
      try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* Cache miss. */ }
      const metadata = await probe(item.path);
      if (!metadata.video) return { duration: metadata.duration, hashes: [] };
      const hashes = Array(Math.ceil(metadata.duration)).fill(null);
      const windows = mode === 'quick' && metadata.duration > 900 ? [[0, 300], [Math.floor(metadata.duration - 240), 240]] : [[0, metadata.duration]];
      const starts = [...new Set(windows.flatMap(([start, duration]) => Array.from({ length: Math.ceil((start + duration) / 60) - Math.floor(start / 60) }, (_, n) => (Math.floor(start / 60) + n) * 60)))];
      const chunkDirectory = path.join(cacheDirectory, fullKey + '.chunks');
      await fs.mkdir(chunkDirectory, { recursive: true });
      for (const [index, start] of starts.entries()) {
        signal.throwIfAborted();
        const chunkFile = path.join(chunkDirectory, `${start}.json`);
        let chunk;
        try { chunk = JSON.parse(await fs.readFile(chunkFile, 'utf8')); } catch { /* Chunk not prepared yet. */ }
        if (!chunk) {
          const rate = options.playback ? ['-readrate', String(options.readRate || 4)] : [];
          const frames = await run(ffmpeg, ['-v', 'error', '-nostdin', '-threads', options.playback ? '1' : '2', '-ss', String(start), ...rate, '-i', item.path, '-t', String(Math.min(60, metadata.duration - start)), '-map', '0:v:0', '-an', '-sn', '-vf', 'fps=1,scale=9:8,format=gray', '-filter_threads', '1', '-threads', '1', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', timeout: 15 * 60 * 1000, signal, priority: options.playback ? os.constants.priority.PRIORITY_LOW : os.constants.priority.PRIORITY_BELOW_NORMAL });
          chunk = [];
          for (let i = 0; i + 72 <= frames.length; i += 72) chunk.push(hashFrame(frames.subarray(i, i + 72)));
          await fs.writeFile(chunkFile, JSON.stringify(chunk));
        }
        for (let i = 0; i < chunk.length; i++) hashes[start + i] = chunk[i];
        options.onProgress?.({ stage: 'decoding', scanTitle: item.title, percent: Math.round((index + 1) / starts.length * 100) });
      }
      const result = { duration: metadata.duration, step: 1, hashes };
      await fs.mkdir(cacheDirectory, { recursive: true }); await fs.writeFile(file, JSON.stringify(result));
      return result;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  // Keep background decoding serial, independent of playback streaming.
  let queue = Promise.resolve();
  const workers = new Set();
  function compare(target, refs, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(Object.assign(new Error('Scan interrupted'), { name: 'AbortError' }));
      const worker = new Worker(path.join(__dirname, 'segment-worker.cjs'), { workerData: { target, refs } }); workers.add(worker);
      const abort = () => { void worker.terminate(); reject(Object.assign(new Error('Scan interrupted'), { name: 'AbortError' })); };
      signal.addEventListener('abort', abort, { once: true });
      worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', () => { signal.removeEventListener('abort', abort); workers.delete(worker); });
    });
  }
  return { close() { controller.abort(); for (const worker of workers) void worker.terminate(); }, detect(item, siblings, onUpdate = () => {}, options = {}) {
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const job = queue.catch(() => {}).then(async () => {
      signal.throwIfAborted();
      onUpdate({ stage: 'fingerprint', completed: 0, total: siblings.length });
      const decodeOptions = { playback: options.playback, readRate: options.readRate, onProgress: onUpdate };
      const target = await fingerprint(item, options.mode, signal, decodeOptions), refs = [];
      signal.throwIfAborted();
      // Nearby episodes usually share an opening; publish those matches first.
      const sorted = [...siblings].sort((a, b) => Math.abs(a.episode - item.episode) - Math.abs(b.episode - item.episode) || b.episode - a.episode);
      const limit = options.mode === 'quick' ? Math.min(2, sorted.length) : sorted.length;
      let result = [];
      for (const sibling of sorted) {
        signal.throwIfAborted();
        onUpdate({ stage: 'reference', completed: refs.length, total: limit });
        try { refs.push(await fingerprint(sibling, options.mode, signal, decodeOptions)); } catch (error) {
          signal.throwIfAborted();
          onUpdate({ stage: 'unavailable', completed: refs.length, total: siblings.length, message: error.message }); continue;
        }
        result = await compare(target, refs, signal);
        onUpdate({ stage: 'matches', completed: refs.length, total: limit, markers: result });
        if (refs.length >= limit) break;
      }
      if (siblings.length && !refs.length) throw new Error('No other season episodes could be read. Check their drive or folder, then compare again.');
      return result;
    });
    queue = job; return job;
  } };
}
module.exports = { hashFrame, distance, detectSegments, createSegments };

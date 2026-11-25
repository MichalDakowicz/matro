import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSmartBatch } from './smart-plan';
import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { fetchWithDeadline, inspect, mediaHeaders, request, ServerError, type Info, type Item, type Library, type MatroUser } from './server';
import { progressRecovery, recoveryScope } from './storage';
import { holdService, offlineNotice } from './offline-notifications';

const PIECE = 8 * 1024 * 1024;
const AHEAD = 3;
const SLOTS = 2;
const PREPARATION_IDLE_MS = 30 * 60 * 1000;
const RETRY_DELAY_MS = 30_000;
const account = (base: string, user: MatroUser) => encodeURIComponent(recoveryScope(base, user));
const active = (base: string) => `matro:offline:active:${encodeURIComponent(base)}`;
const libraryKey = (scope: string) => `matro:offline:library:${scope}`;
const prefix = (scope: string) => `matro:offline:media:${scope}:`;
const recordKey = (scope: string, id: string) => prefix(scope) + id;
const decode = <T>(raw: string | null): T | null => {
  try { return raw ? JSON.parse(raw) as T : null; } catch { return null; }
};
const read = async <T>(key: string) => decode<T>(await AsyncStorage.getItem(key));

type Media = { uri: string; version: string; info: Info; text: Record<string, string> };
type RecordState = {
  id: string; title: string; size: number; have: number; complete: boolean; paused?: boolean;
  state?: 'queued' | 'preparing' | 'downloading'; prepared?: number; progressAt?: number; error?: string; retryAt?: number;
  /** Saves started together share a batch, so the whole group can be paused, resumed or cancelled. */
  batch?: string; batchLabel?: string;
};
export type OfflineRecord = RecordState & Partial<Media>;
export type SavedMedia = RecordState & Media;
type OfflineJob = { id: string; title: string; have: number; size: number; prepared: number | null; controller: AbortController; task: Promise<void> };
type Preparation = { state: 'preparing'; progress?: number | null } | { state: 'ready'; size: number; type: string; version: string };

class RetryableDownloadError extends Error {}
class DiskFullError extends Error {
  constructor() { super('Not enough storage to save this title. Free up space, then resume.'); }
}
const diskFull = (error: unknown) => /ENOSPC|no space left on device|not enough (?:disk )?(?:space|storage)|out of (?:disk )?space/i.test(String(error));
const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) { resolve(); return; }
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
  const timer = setTimeout(finish, ms);
  signal.addEventListener('abort', finish);
});

async function retrying<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  for (let tries = 0;; tries++) {
    if (signal.aborted) throw new Error('Download cancelled.');
    try { return await run(); }
    catch (error) {
      if (signal.aborted || error instanceof ServerError && error.status && error.status < 500) throw error;
      if (tries >= 6) throw new RetryableDownloadError(error instanceof Error ? error.message : 'Could not reach the server.');
      await wait(Math.min(RETRY_DELAY_MS, 1500 * 2 ** tries), signal);
    }
  }
}

const jobs = new Map<string, OfflineJob>();
const holds = new Map<string, () => void>();
const retryDue = new Map<string, number>();
const observers = new Set<() => void>();
const changed = () => { observers.forEach(listener => listener()); };
export function watchOffline(listener: () => void) { observers.add(listener); return () => { observers.delete(listener); }; }

function scopedJobs(scope: string) {
  return [...jobs.entries()].filter(([key]) => key.startsWith(prefix(scope))).map(([, job]) => job);
}
export const activeDownloads = (base: string, user: MatroUser) => scopedJobs(account(base, user));

export async function rememberLibrary(base: string, data: Library) {
  const scope = account(base, data.user);
  await AsyncStorage.setItem(libraryKey(scope), JSON.stringify(data));
  await AsyncStorage.setItem(active(base), scope);
}
export const forgetOfflineAccount = (base: string) => AsyncStorage.removeItem(active(base));

async function recordsFor(scope: string): Promise<OfflineRecord[]> {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix(scope)));
  if (!keys.length) return [];
  return (await AsyncStorage.multiGet(keys)).flatMap(([, raw]) => decode<OfflineRecord>(raw) ?? []);
}

export function savedBytes(record: OfflineRecord) {
  if (!record.uri) return 0;
  const file = new File(record.uri);
  return file.exists ? file.size : 0;
}
export const isSaved = (record: OfflineRecord): record is SavedMedia =>
  !!(record.complete && record.size > 0 && record.info && record.text && record.uri && record.version && savedBytes(record) === record.size);
export const savedTitles = (base: string, user: MatroUser) => recordsFor(account(base, user));
export async function savedTitle(base: string, user: MatroUser, id: string) {
  const record = await read<OfflineRecord>(recordKey(account(base, user), id));
  return record && isSaved(record) ? record : undefined;
}
export async function offlineLibrary(base: string): Promise<(Library & { catalogIds: string[] }) | null> {
  const scope = await AsyncStorage.getItem(active(base));
  const data = scope ? await read<Library>(libraryKey(scope)) : null;
  if (!data) return null;
  const ids = new Set((await savedTitles(base, data.user)).filter(isSaved).map(entry => entry.id));
  const items = data.items.filter(item => ids.has(item.id));
  const progress = await progressRecovery.restore(recoveryScope(base, data.user), data.progress, items.map(item => item.id));
  return { ...data, items, progress, folders: [], queue: data.queue.filter(id => ids.has(id)), catalogIds: data.items.map(item => item.id) };
}

// Serialize queue edits and slot assignment. Transfer jobs write only their own records.
let queueEdit = Promise.resolve();
function editQueue(run: () => Promise<void>) {
  const next = queueEdit.then(run);
  queueEdit = next.catch(() => {});
  return next;
}

async function drain(base: string, scope: string, retry = false) {
  try {
    const pending = (await recordsFor(scope)).filter(record => !record.complete && !record.paused && !jobs.has(recordKey(scope, record.id)));
    const ready = pending.filter(record => !record.retryAt || retry && record.retryAt <= Date.now());
    const available = SLOTS - scopedJobs(scope).length;
    for (const record of ready.slice(0, available)) {
      if (!holds.has(scope)) holds.set(scope, holdService()); // Android must keep the service alive between titles.
      startDownload(base, scope, record);
    }
    const nextRetry = pending.reduce((next, record) => record.retryAt && !jobs.has(recordKey(scope, record.id)) ? Math.min(next, record.retryAt) : next, Infinity);
    if (nextRetry < Infinity) retryDue.set(scope, nextRetry); else retryDue.delete(scope);
  } finally {
    if (!scopedJobs(scope).length) { holds.get(scope)?.(); holds.delete(scope); }
    changed();
  }
}

export function resumeInterrupted(base: string, user: MatroUser) {
  return editQueue(() => drain(base, account(base, user), true));
}
export function retryInterrupted(base: string, user: MatroUser) {
  const scope = account(base, user);
  if ((retryDue.get(scope) ?? Infinity) <= Date.now() && scopedJobs(scope).length < SLOTS) {
    return resumeInterrupted(base, user);
  }
}

export type Batch = { id: string; label: string };
export function saveOfflineBatch(base: string, user: MatroUser, items: Item[], nameOf: (item: Item) => string, batch?: Batch) {
  const scope = account(base, user);
  const batchInfo = batch ?? (items.length > 1 ? { id: `b${Date.now().toString(36)}`, label: items[0].group } : undefined);
  const smart = isSmartBatch(batchInfo?.id), release = holdService();
  return editQueue(async () => {
    const records = new Map((await recordsFor(scope)).map(record => [record.id, record]));
    const entries = new Map<string, string>();
    for (const item of items) {
      const key = recordKey(scope, item.id), previous = records.get(item.id);
      if (jobs.has(key) || previous && (smart || isSaved(previous))) continue;
      const record: OfflineRecord = {
        have: 0, size: 0, ...previous, id: item.id, title: nameOf(item), complete: false,
        state: 'queued', paused: false, error: undefined, retryAt: undefined, prepared: undefined, progressAt: undefined,
        batch: batchInfo?.id ?? previous?.batch, batchLabel: batchInfo?.label ?? previous?.batchLabel,
      };
      entries.set(key, JSON.stringify(record));
    }
    if (entries.size) await AsyncStorage.multiSet([...entries]);
    await drain(base, scope);
  }).finally(release);
}
export const saveOffline = (base: string, user: MatroUser, item: Item, title: string) =>
  saveOfflineBatch(base, user, [item], () => title);

export function pauseOffline(base: string, user: MatroUser, id: string) {
  return editQueue(async () => {
    const scope = account(base, user), key = recordKey(scope, id), job = jobs.get(key);
    job?.controller.abort();
    await job?.task;
    const record = await read<OfflineRecord>(key);
    if (record && !record.complete) await AsyncStorage.setItem(key, JSON.stringify({ ...record, paused: true, error: undefined, retryAt: undefined }));
    if (holds.has(scope)) await drain(base, scope); else changed();
  });
}
const unfinished = async (scope: string, batch: string) => (await recordsFor(scope)).filter(record => record.batch === batch && !record.complete);
/** Stops every running transfer of the batch, then lets `change` rewrite its records. The queue edit keeps other saves from starting in between. */
const stopBatch = (base: string, user: MatroUser, batch: string, change: (scope: string, records: OfflineRecord[]) => Promise<void>) => editQueue(async () => {
  const scope = account(base, user), records = await unfinished(scope, batch), running = records.flatMap(record => jobs.get(recordKey(scope, record.id)) ?? []);
  running.forEach(job => job.controller.abort());
  await Promise.all(running.map(job => job.task));
  await change(scope, (await unfinished(scope, batch)));
  if (holds.has(scope)) await drain(base, scope); else changed();
});
export const pauseBatch = (base: string, user: MatroUser, batch: string) => stopBatch(base, user, batch, (scope, records) =>
  AsyncStorage.multiSet(records.map(record => [recordKey(scope, record.id), JSON.stringify({ ...record, paused: true, error: undefined, retryAt: undefined })])));
export const cancelBatch = (base: string, user: MatroUser, batch: string) => stopBatch(base, user, batch, async (scope, records) => {
  for (const record of records) if (record.uri) { const file = new File(record.uri); if (file.exists) file.delete(); }
  await AsyncStorage.multiRemove(records.map(record => recordKey(scope, record.id)));
});
export function resumeBatch(base: string, user: MatroUser, batch: string) {
  const scope = account(base, user), release = holdService();
  return editQueue(async () => {
    const paused = (await recordsFor(scope)).filter(record => record.batch === batch && !record.complete && record.paused);
    if (paused.length) await AsyncStorage.multiSet(paused.map(record => [recordKey(scope, record.id), JSON.stringify({ ...record, paused: false, state: 'queued', error: undefined, retryAt: undefined })]));
    await drain(base, scope);
  }).finally(release);
}
export function removeOffline(base: string, user: MatroUser, id: string, { smartOnly = false } = {}) {
  return editQueue(async () => {
    const scope = account(base, user), key = recordKey(scope, id), job = jobs.get(key);
    if (smartOnly && job) return;
    job?.controller.abort();
    await job?.task;
    const record = await read<OfflineRecord>(key);
    if (smartOnly && (!record || !isSmartBatch(record.batch) || !isSaved(record))) return;
    if (record?.uri) { const file = new File(record.uri); if (file.exists) file.delete(); }
    await AsyncStorage.removeItem(key);
    if (holds.has(scope)) await drain(base, scope); else changed();
  });
}

function startDownload(base: string, scope: string, record: OfflineRecord) {
  const key = recordKey(scope, record.id), controller = new AbortController(), { signal } = controller;
  const job: OfflineJob = { id: record.id, title: record.title, have: 0, size: 0, prepared: record.prepared ?? null, controller, task: Promise.resolve() };
  const notice = offlineNotice(key, record.title);
  const route = `/api/items/${encodeURIComponent(record.id)}`;
  const persist = () => AsyncStorage.setItem(key, JSON.stringify(record));
  async function download() {
    record.state = 'preparing';
    record.progressAt ??= Date.now();
    await persist();
    notice.preparing(job.prepared);
    let preparation: Preparation;
    for (;;) {
      preparation = await retrying(signal, () => request(base, route + '/offline', { signal }));
      if (preparation?.state === 'ready') break;
      if (preparation?.state !== 'preparing') throw new Error('Invalid preparation status.');
      const progress = preparation.progress;
      if (typeof progress === 'number' && Number.isFinite(progress) && progress !== record.prepared) {
        if (progress > (record.prepared ?? 0)) record.progressAt = Date.now();
        record.prepared = progress;
        await persist();
      }
      if (Date.now() - record.progressAt >= PREPARATION_IDLE_MS) {
        throw new RetryableDownloadError('Server preparation has not advanced for 30 minutes.');
      }
      job.prepared = record.prepared ?? null;
      notice.preparing(job.prepared); changed();
      await wait(2000, signal);
    }

    const { size, version, type } = preparation;
    if (!Number.isSafeInteger(size) || size < 1 || !/^[a-f0-9]{64}$/.test(version)) throw new Error('Invalid prepared file.');
    Object.assign(record, { state: 'downloading', prepared: undefined, progressAt: undefined });
    const directory = Array.from(scope, character => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    const dir = new Directory(Paths.document, 'matro-saved', ...(directory.match(/.{1,100}/g) || []));
    const file = new File(dir, `${encodeURIComponent(record.id)}-${version}.${type === 'video/webm' ? 'webm' : 'mp4'}`);
    if (record.uri && record.uri !== file.uri) { const old = new File(record.uri); if (old.exists) old.delete(); }
    const existing = file.exists ? file.size : 0;
    const have = existing <= size && (existing === size || existing % PIECE === 0) ? existing : 0;
    const reserved = [...jobs.values()].reduce((bytes, other) => other === job ? bytes : bytes + other.size - other.have, 0);
    const reclaimable = have === 0 ? existing : 0;
    if (have < size && size - have > Paths.availableDiskSpace + reclaimable - reserved) throw new DiskFullError();
    Object.assign(job, { have, size, prepared: null });

    const headers = await mediaHeaders(base);
    const info = await retrying(signal, () => inspect(base, record.id, signal)), text: Record<string, string> = {};
    const captions: Info['embedded'] = [], uploads: Info['uploaded'] = [];
    const fetchBody = <T>(path: string, readBody: (response: Awaited<ReturnType<typeof fetch>>) => Promise<T>, extraHeaders = {}) =>
      retrying(signal, () => fetchWithDeadline(
        requestSignal => fetch(base + route + path, { headers: { ...headers, ...extraHeaders }, signal: requestSignal }),
        readBody, { signal },
      ));
    const caption = (track: string) => fetchBody('/subtitles/' + track, async response => {
      if (!response.ok) throw new ServerError(`Could not download subtitles (HTTP ${response.status}).`, response.status);
      return response.text();
    }).catch(error => {
      if (error instanceof ServerError && error.status === 404) return undefined; // The track was removed after inspection.
      throw error;
    });
    for (const track of info.embedded) {
      if (!track.text || track.bitmap) continue;
      const vtt = await caption('e' + track.index);
      if (vtt !== undefined) { text[track.index] = vtt; captions.push(track); }
    }
    for (const track of info.uploaded) {
      const vtt = await caption('u' + track.id);
      if (vtt !== undefined) { text[10000 + track.id] = vtt; uploads.push(track); }
    }
    if (signal.aborted) return;
    Object.assign(record, {
      uri: file.uri, size, have, version, info: { ...info, embedded: captions, uploaded: uploads, audio: info.audio.slice(0, 1) }, text,
      error: undefined, retryAt: undefined,
    });
    // Save the path before writing so a kill or disk error leaves a removable partial file.
    await persist();
    dir.create({ idempotent: true, intermediates: true });
    if (!file.exists || have !== existing) file.create({ overwrite: true });
    notice.progress(have, size); changed();

    const fetchPiece = (start: number) => {
      const end = Math.min(start + PIECE, size) - 1;
      const piece = fetchBody('/offline/file?version=' + version, async response => {
        if (response.status === 401) throw new ServerError('Sign in again to finish the download.', 401);
        if (response.status === 409) throw new ServerError('The prepared file changed. Retry the download.', 409);
        if (!response.ok) throw new ServerError(`Could not download media (HTTP ${response.status}).`, response.status);
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) {
          throw new ServerError('The server returned an invalid byte range.', 422);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== end - start + 1) throw new Error('The server stopped sending the file.');
        return bytes;
      }, { range: `bytes=${start}-${end}` });
      void piece.catch(() => {}); // A prefetched piece may fail before its turn to be written.
      return piece;
    };
    const ahead = new Map<number, Promise<Uint8Array>>();
    for (let start = have; start < size; start = record.have) {
      if (signal.aborted) return;
      for (let next = start; next < Math.min(size, start + AHEAD * PIECE); next += PIECE) {
        if (!ahead.has(next)) ahead.set(next, fetchPiece(next));
      }
      const bytes = await ahead.get(start)!;
      ahead.delete(start);
      if (signal.aborted) return;
      const writer = file.open();
      try { writer.offset = start; writer.writeBytes(bytes); } finally { writer.close(); }
      record.have = job.have = start + bytes.length;
      await persist();
      notice.progress(record.have, size); changed();
    }
    if (signal.aborted) return;
    await AsyncStorage.setItem(key, JSON.stringify({ ...record, complete: true, state: undefined }));
    notice.done();
  }

  jobs.set(key, job);
  job.task = download().catch(async error => {
    if (signal.aborted) return;
    const retry = error instanceof RetryableDownloadError;
    record.error = diskFull(error) ? new DiskFullError().message : error instanceof Error ? error.message : 'Could not finish saving this title.';
    record.paused = !retry;
    record.retryAt = retry ? Date.now() + RETRY_DELAY_MS : undefined;
    notice.failed(record.error);
    await persist();
  }).catch(() => {}).finally(() => {
    controller.abort(); // Cancel prefetched work if any piece failed.
    notice.dismiss();
    jobs.delete(key);
    void editQueue(() => drain(base, scope)).catch(() => {});
  });
}

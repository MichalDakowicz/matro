import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { inspect, mediaHeaders, request, type Info, type Item, type Library, type MatroUser } from './server';
import { progressRecovery, recoveryScope } from './storage';
import { holdService, offlineNotice } from './offline-notifications';

import {
  CHUNK, DOWNLOAD_SLOTS, PREFETCH_PIECES, RETRY_DELAY_MS, RetryableDownloadError, chunkRange,
  fetchPiece, isTextCaption, keptAudio, offlinePath, optionalCaption, prepareDownload, retrying, withChoice,
} from '../../../../packages/core/client/offline-rules.js';

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
export type OfflineChoice = { audio: number | null; burn: number | null; quality: string };
type RecordState = {
  id: string; title: string; size: number; have: number; complete: boolean; paused?: boolean;
  choice?: OfflineChoice;
  state?: 'queued' | 'preparing' | 'downloading'; prepared?: number; progressAt?: number; error?: string; retryAt?: number;
};
export type OfflineRecord = RecordState & Partial<Media>;
export type SavedMedia = RecordState & Media;
type OfflineJob = { id: string; title: string; have: number; size: number; prepared: number | null; controller: AbortController; task: Promise<void> };
class DiskFullError extends Error {
  constructor() { super('Not enough storage to save this title. Free up space, then resume.'); }
}
const diskFull = (error: unknown) => /ENOSPC|no space left on device|not enough (?:disk )?(?:space|storage)|out of (?:disk )?space/i.test(String(error));

const jobs = new Map<string, OfflineJob>();
const holds = new Map<string, () => void>();
const retryDue = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
    const available = DOWNLOAD_SLOTS - scopedJobs(scope).length;
    for (const record of ready.slice(0, available)) {
      if (!holds.has(scope)) holds.set(scope, holdService()); // Android must keep the service alive between titles.
      startDownload(base, scope, record);
    }
    const nextRetry = pending.reduce((next, record) => record.retryAt && !jobs.has(recordKey(scope, record.id)) ? Math.min(next, record.retryAt) : next, Infinity);
    clearTimeout(retryTimers.get(scope)); retryTimers.delete(scope);
    if (nextRetry < Infinity) {
      retryDue.set(scope, nextRetry);
      // Keep the service alive and retry on time even when the app stays in the background.
      if (!holds.has(scope)) holds.set(scope, holdService());
      retryTimers.set(scope, setTimeout(() => { retryTimers.delete(scope); void editQueue(() => drain(base, scope, true)).catch(() => {}); }, Math.max(0, nextRetry - Date.now())));
    } else retryDue.delete(scope);
  } finally {
    if (!scopedJobs(scope).length && !retryTimers.has(scope)) { holds.get(scope)?.(); holds.delete(scope); }
    changed();
  }
}

export function resumeInterrupted(base: string, user: MatroUser) {
  return editQueue(() => drain(base, account(base, user), true));
}
export function retryInterrupted(base: string, user: MatroUser) {
  const scope = account(base, user);
  if ((retryDue.get(scope) ?? Infinity) <= Date.now() && scopedJobs(scope).length < DOWNLOAD_SLOTS) {
    return resumeInterrupted(base, user);
  }
}

export function saveOfflineBatch(base: string, user: MatroUser, items: Item[], nameOf: (item: Item) => string, choices?: Map<string, OfflineChoice>) {
  const scope = account(base, user), release = holdService();
  return editQueue(async () => {
    const records = new Map((await recordsFor(scope)).map(record => [record.id, record]));
    const entries = new Map<string, string>();
    for (const item of items) {
      const key = recordKey(scope, item.id), previous = records.get(item.id);
      if (jobs.has(key) || previous && isSaved(previous)) continue;
      const record: OfflineRecord = {
        have: 0, size: 0, ...previous, id: item.id, title: nameOf(item), complete: false,
        choice: choices?.get(item.id) ?? previous?.choice,
        state: 'queued', paused: false, error: undefined, retryAt: undefined, prepared: undefined, progressAt: undefined,
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
export function removeOffline(base: string, user: MatroUser, id: string) {
  return editQueue(async () => {
    const scope = account(base, user), key = recordKey(scope, id), job = jobs.get(key);
    job?.controller.abort();
    await job?.task;
    const record = await read<OfflineRecord>(key);
    if (record?.uri) { const file = new File(record.uri); if (file.exists) file.delete(); }
    await AsyncStorage.removeItem(key);
    if (holds.has(scope)) await drain(base, scope); else changed();
  });
}

function startDownload(base: string, scope: string, record: OfflineRecord) {
  const key = recordKey(scope, record.id), controller = new AbortController(), { signal } = controller;
  const job: OfflineJob = { id: record.id, title: record.title, have: 0, size: 0, prepared: record.prepared ?? null, controller, task: Promise.resolve() };
  const notice = offlineNotice(key, record.title);
  const route = offlinePath(record.id);
  const persist = () => AsyncStorage.setItem(key, JSON.stringify(record));
  async function download() {
    record.state = 'preparing';
    record.progressAt ??= Date.now();
    await persist();
    notice.preparing(job.prepared);
    const preparation = await prepareDownload(signal, () => request(base, withChoice(route, record.choice), { signal }), async (progress, advancedAt) => {
      if (progress !== undefined && (progress !== record.prepared || advancedAt !== record.progressAt)) {
        record.prepared = progress;
        record.progressAt = advancedAt;
        await persist();
      }
      job.prepared = progress ?? null;
      notice.preparing(job.prepared); changed();
    }, { lastProgress: record.prepared, advancedAt: record.progressAt });
    const { size, version, type } = preparation;
    Object.assign(record, { state: 'downloading', prepared: undefined, progressAt: undefined });
    const directory = Array.from(scope, character => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    const dir = new Directory(Paths.document, 'matro-saved', ...(directory.match(/.{1,100}/g) || []));
    const file = new File(dir, `${encodeURIComponent(record.id)}-${version}.${type === 'video/webm' ? 'webm' : 'mp4'}`);
    if (record.uri && record.uri !== file.uri) { const old = new File(record.uri); if (old.exists) old.delete(); }
    const existing = file.exists ? file.size : 0;
    const have = existing <= size && (existing === size || existing % CHUNK === 0) ? existing : 0;
    const reserved = [...jobs.values()].reduce((bytes, other) => other === job ? bytes : bytes + other.size - other.have, 0);
    const reclaimable = have === 0 ? existing : 0;
    if (have < size && size - have > Paths.availableDiskSpace + reclaimable - reserved) throw new DiskFullError();
    Object.assign(job, { have, size, prepared: null });

    const headers = await mediaHeaders(base);
    const info = await retrying(signal, () => inspect(base, record.id, signal)), text: Record<string, string> = {};
    const captions: Info['embedded'] = [], uploads: Info['uploaded'] = [];
    const send = (path: string, extraHeaders: Record<string, string>, requestSignal: AbortSignal) =>
      fetch(base + path, { headers: { ...headers, ...extraHeaders }, signal: requestSignal });
    const caption = (track: string) => optionalCaption(
      requestSignal => send(`/api/items/${encodeURIComponent(record.id)}/subtitles/${track}`, {}, requestSignal), signal,
    );
    for (const track of info.embedded) {
      if (!isTextCaption(track)) continue;
      const vtt = await caption('e' + track.index);
      if (vtt !== undefined) { text[track.index] = vtt; captions.push(track); }
    }
    for (const track of info.uploaded) {
      const vtt = await caption('u' + track.id);
      if (vtt !== undefined) { text[10000 + track.id] = vtt; uploads.push(track); }
    }
    if (signal.aborted) return;
    Object.assign(record, {
      uri: file.uri, size, have, version, info: { ...info, embedded: captions, uploaded: uploads, audio: keptAudio(info.audio, record.choice) }, text,
      error: undefined, retryAt: undefined,
    });
    // Save the path before writing so a kill or disk error leaves a removable partial file.
    await persist();
    dir.create({ idempotent: true, intermediates: true });
    if (!file.exists || have !== existing) file.create({ overwrite: true });
    notice.progress(have, size); changed();

    const requestPiece = (start: number) => {
      const piece = fetchPiece(send, route, preparation, chunkRange(size, start / CHUNK), signal, record.choice);
      void piece.catch(() => {}); // A prefetched piece may fail before its turn to be written.
      return piece;
    };
    const ahead = new Map<number, Promise<Uint8Array>>();
    for (let start = have; start < size; start = record.have) {
      if (signal.aborted) return;
      for (let next = start; next < Math.min(size, start + PREFETCH_PIECES * CHUNK); next += CHUNK) {
        if (!ahead.has(next)) ahead.set(next, requestPiece(next));
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
    if (record.paused) notice.failed(record.error);
    await persist();
  }).catch(() => {}).finally(() => {
    controller.abort(); // Cancel prefetched work if any piece failed.
    notice.dismiss();
    jobs.delete(key);
    void editQueue(() => drain(base, scope)).catch(() => {});
  });
}

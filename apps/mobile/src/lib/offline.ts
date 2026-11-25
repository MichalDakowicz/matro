import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { inspect, mediaHeaders, request, ServerError, type Info, type Item, type Library, type MatroUser } from './server';
import { progressRecovery, recoveryScope } from './storage';
import { holdService, offlineNotice } from './offline-notifications';

const PIECE = 8 * 1024 * 1024;
// Pieces fetched ahead of the one being written, so the network never idles while the disk is busy.
const AHEAD = 3;
const account = (base: string, user: MatroUser) => encodeURIComponent(recoveryScope(base, user));
const active = (base: string) => `matro:offline:active:${encodeURIComponent(base)}`;
const libraryKey = (scope: string) => `matro:offline:library:${scope}`;
const prefix = (scope: string) => `matro:offline:media:${scope}:`;
const recordKey = (scope: string, id: string) => prefix(scope) + id;
const read = async <T>(key: string): Promise<T | null> => {
  const raw = await AsyncStorage.getItem(key);
  try { return raw ? JSON.parse(raw) as T : null; } catch { return null; }
};

// `paused` is set only when the user pauses; any other incomplete record was interrupted and resumes by itself.
export type SavedMedia = { id: string; title: string; uri: string; size: number; have: number; complete: boolean; paused?: boolean; version: string; info: Info; text: Record<string, string> };
// `prepared` is the server's transcode progress (0-1) while it converts the file, null once unknown or finished.
export type OfflineJob = { id: string; title: string; have: number; size: number; prepared: number | null; controller: AbortController; task: Promise<void> };
type Preparation = { state: 'preparing'; progress?: number } | { state: 'ready'; size: number; type: string; version: string };
const fatal = (message: string) => Object.assign(new Error(message), { fatal: true });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Network drops and 5xx answers are retried with backoff; anything the server decided on (4xx, changed file) is not.
async function retrying<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  for (let tries = 0;; tries++) {
    try { return await run(); }
    catch (error) {
      const permanent = (error as { fatal?: boolean }).fatal || error instanceof ServerError && !!error.status && error.status < 500;
      if (signal.aborted || permanent || tries >= 6) throw error;
      await wait(Math.min(30000, 1500 * 2 ** tries));
    }
  }
}
const jobs = new Map<string, OfflineJob>();
const observers = new Set<() => void>();
const changed = () => { observers.forEach(listener => listener()); };
export function watchOffline(listener: () => void) { observers.add(listener); return () => { observers.delete(listener); }; }
export function activeDownloads(base: string, user: MatroUser) {
  const scope = prefix(account(base, user));
  return [...jobs.entries()].filter(([key]) => key.startsWith(scope)).map(([, job]) => job);
}
export async function rememberLibrary(base: string, data: Library) {
  const scope = account(base, data.user);
  await AsyncStorage.setItem(libraryKey(scope), JSON.stringify(data));
  await AsyncStorage.setItem(active(base), scope);
}
export const forgetOfflineAccount = (base: string) => AsyncStorage.removeItem(active(base));
export async function savedTitles(base: string, user: MatroUser): Promise<SavedMedia[]> {
  const scope = prefix(account(base, user));
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(scope));
  const entries = await Promise.all(keys.map(key => read<SavedMedia>(key)));
  return entries.filter((entry): entry is SavedMedia => !!entry);
}
export async function savedTitle(base: string, user: MatroUser, id: string) {
  const record = await read<SavedMedia>(recordKey(account(base, user), id));
  return record?.complete && new File(record.uri).exists ? record : undefined;
}
export async function offlineLibrary(base: string): Promise<Library | null> {
  const scope = await AsyncStorage.getItem(active(base));
  const data = scope ? await read<Library>(libraryKey(scope)) : null;
  if (!data || scope !== account(base, data.user)) return null;
  const ids = new Set((await savedTitles(base, data.user)).filter(entry => entry.complete && new File(entry.uri).exists).map(entry => entry.id));
  const items = data.items.filter(item => ids.has(item.id));
  const progress = await progressRecovery.restore(recoveryScope(base, data.user), data.progress, items.map(item => item.id));
  return { ...data, items, progress, folders: [], queue: data.queue.filter(id => ids.has(id)) };
}

export function pauseOffline(base: string, user: MatroUser, id: string) {
  const key = recordKey(account(base, user), id), job = jobs.get(key);
  if (!job) return;
  job.controller.abort();
  void job.task.catch(() => {}).then(async () => {
    const record = await read<SavedMedia>(key);
    if (record && !record.complete) await AsyncStorage.setItem(key, JSON.stringify({ ...record, paused: true }));
    changed();
  });
}
// Titles waiting for a free slot in a batch (a whole season at once), so the Saved screen can list them.
const queued = new Map<string, { id: string; title: string }>();
export function queuedDownloads(base: string, user: MatroUser) {
  const scope = prefix(account(base, user));
  return [...queued.entries()].filter(([key]) => key.startsWith(scope)).map(([, entry]) => entry);
}
export function cancelQueued(base: string, user: MatroUser, id: string) {
  if (queued.delete(recordKey(account(base, user), id))) changed();
}
// Downloads several titles, a few at a time: the server converts files before sending, so more than two at once only queues there.
export async function saveOfflineBatch(base: string, user: MatroUser, items: Item[], nameOf: (item: Item) => string, slots = 2) {
  const scope = account(base, user), waiting = items.filter(item => !jobs.has(recordKey(scope, item.id)));
  for (const item of waiting) queued.set(recordKey(scope, item.id), { id: item.id, title: nameOf(item) });
  changed();
  const release = holdService(); // the foreground service can't be restarted from the background, so keep it between titles
  let failure: unknown;
  try {
    await Promise.all(Array.from({ length: Math.min(slots, waiting.length) }, async () => {
      for (let item; (item = waiting.shift());) {
        if (!queued.delete(recordKey(scope, item.id))) continue; // cancelled while waiting
        changed();
        try { await saveOffline(base, user, item, nameOf(item)); } catch (error) { failure ??= error; }
      }
    }));
  } finally { for (const item of waiting) queued.delete(recordKey(scope, item.id)); release(); changed(); }
  if (failure) throw failure;
}
// Downloads the app was interrupted in (killed, no network) continue on their own; only an explicit pause stays paused.
export async function resumeInterrupted(base: string, user: MatroUser, items: Item[], nameOf: (item: Item) => string) {
  const scope = account(base, user), byId = new Map(items.map(item => [item.id, item]));
  const resumable = (await savedTitles(base, user)).filter(record => !record.complete && !record.paused && !jobs.has(recordKey(scope, record.id)) && !queued.has(recordKey(scope, record.id)));
  const list = resumable.flatMap(record => byId.get(record.id) ?? []);
  if (list.length) void saveOfflineBatch(base, user, list, nameOf).catch(() => {});
}
export async function removeOffline(base: string, user: MatroUser, id: string) {
  const key = recordKey(account(base, user), id);
  queued.delete(key);
  jobs.get(key)?.controller.abort();
  await jobs.get(key)?.task.catch(() => {});
  const record = await read<SavedMedia>(key);
  if (record) {
    const file = new File(record.uri);
    if (file.exists) file.delete();
    await AsyncStorage.removeItem(key);
    changed();
  }
}

export function saveOffline(base: string, user: MatroUser, item: Item, title: string) {
  const scope = account(base, user), key = recordKey(scope, item.id);
  const existing = jobs.get(key); if (existing) return existing.task;
  const controller = new AbortController(), { signal } = controller;
  const job: OfflineJob = { id: item.id, title, have: 0, size: 0, prepared: null, controller, task: Promise.resolve() };
  const notice = offlineNotice(key, title);
  const route = `/api/items/${encodeURIComponent(item.id)}`;
  async function download() {
    const headers = await mediaHeaders(base);
    const previous = await read<SavedMedia>(key);
    if (previous?.complete && new File(previous.uri).exists) return;
    notice.preparing(null);
    const started = Date.now();
    let preparation: Preparation;
    for (;;) {
      if (signal.aborted) return;
      preparation = await retrying(signal, () => request(base, route + '/offline'));
      if (preparation.state === 'ready') break;
      if (preparation.state !== 'preparing' || Date.now() - started > 30 * 60 * 1000) throw new Error('The server did not finish preparing this title.');
      job.prepared = typeof preparation.progress === 'number' ? preparation.progress : null;
      notice.preparing(job.prepared); changed();
      await wait(2000);
    }
    job.prepared = null;
    const { size, version, type } = preparation;
    if (!Number.isSafeInteger(size) || size < 1 || !/^[a-f0-9]{64}$/.test(version)) throw new Error('Invalid prepared file.');
    const info = await inspect(base, item.id), text: Record<string, string> = {};
    const captions: Info['embedded'] = [], uploads: Info['uploaded'] = [];
    for (const track of info.embedded) {
      if (signal.aborted) return;
      if (!track.text || track.bitmap) continue;
      const response = await fetch(base + route + '/subtitles/e' + track.index, { headers, signal });
      if (response.ok) { text[track.index] = await response.text(); captions.push(track); }
    }
    for (const track of info.uploaded) {
      if (signal.aborted) return;
      const response = await fetch(base + route + '/subtitles/u' + track.id, { headers, signal });
      if (response.ok) { text[10000 + track.id] = await response.text(); uploads.push(track); }
    }
    const directory = Array.from(scope, character => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    const dir = new Directory(Paths.document, 'matro-saved', ...(directory.match(/.{1,100}/g) || []));
    dir.create({ idempotent: true, intermediates: true });
    const file = new File(dir, `${encodeURIComponent(item.id)}-${version}.${type === 'video/webm' ? 'webm' : 'mp4'}`);
    if (previous && previous.uri !== file.uri) { const old = new File(previous.uri); if (old.exists) old.delete(); }
    const previousSize = file.exists ? file.size : 0;
    if (!file.exists || previousSize > size || (previousSize !== size && previousSize % PIECE !== 0)) file.create({ overwrite: true });
    const record: SavedMedia = { id: item.id, title, uri: file.uri, size, have: file.size, version, info: { ...info, embedded: captions, uploaded: uploads, audio: info.audio.slice(0, 1) }, text, complete: false };
    const persist = async () => {
      await AsyncStorage.setItem(key, JSON.stringify(record));
      Object.assign(job, { have: record.have, size }); changed();
      if (!record.complete) notice.progress(record.have, size);
    };
    await persist();
    const fetchPiece = (start: number) => {
      const end = Math.min(start + PIECE, size) - 1;
      const piece = retrying(signal, async () => {
        const response = await fetch(base + route + '/offline/file?version=' + version, { headers: { ...headers, range: `bytes=${start}-${end}` }, signal });
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) {
          if (response.status === 401) throw new ServerError('Sign in again to finish the download.', 401);
          throw fatal('The prepared file changed. Retry the download.');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== end - start + 1) throw new Error('The server stopped sending the file.');
        return bytes;
      });
      piece.catch(() => {}); // a piece that fails while a later one is being written is reported when its turn comes
      return piece;
    };
    const ahead = new Map<number, Promise<Uint8Array>>();
    for (let start = record.have; start < size; start = record.have) {
      if (signal.aborted) return;
      for (let next = start; next < Math.min(size, start + AHEAD * PIECE); next += PIECE) if (!ahead.has(next)) ahead.set(next, fetchPiece(next));
      const bytes = await ahead.get(start)!.catch(error => { if (signal.aborted) return null; throw error; });
      ahead.delete(start);
      if (!bytes || signal.aborted) return;
      const writer = file.open();
      try { writer.offset = start; writer.writeBytes(bytes); } finally { writer.close(); }
      record.have = Math.min(start + PIECE, size);
      await persist();
    }
    record.complete = true;
    await persist();
    notice.done();
  }
  job.task = download().catch(error => { if (signal.aborted) notice.dismiss(); else { notice.failed(); throw error; } }).finally(() => {
    if (signal.aborted) notice.dismiss();
    jobs.delete(key); changed();
  });
  jobs.set(key, job); changed();
  return job.task;
}

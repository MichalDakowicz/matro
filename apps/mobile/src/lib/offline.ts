import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { inspect, mediaHeaders, request, ServerError, type Info, type Item, type Library, type MatroUser } from './server';
import { progressRecovery, recoveryScope } from './storage';
import { offlineNotice } from './offline-notifications';

const PIECE = 8 * 1024 * 1024;
const account = (base: string, user: MatroUser) => encodeURIComponent(recoveryScope(base, user));
const active = (base: string) => `matro:offline:active:${encodeURIComponent(base)}`;
const libraryKey = (scope: string) => `matro:offline:library:${scope}`;
const prefix = (scope: string) => `matro:offline:media:${scope}:`;
const recordKey = (scope: string, id: string) => prefix(scope) + id;
const read = async <T>(key: string): Promise<T | null> => {
  const raw = await AsyncStorage.getItem(key);
  try { return raw ? JSON.parse(raw) as T : null; } catch { return null; }
};

export type SavedMedia = { id: string; title: string; uri: string; size: number; have: number; complete: boolean; version: string; info: Info; text: Record<string, string> };
export type OfflineJob = { id: string; title: string; have: number; size: number; controller: AbortController; task: Promise<void> };
type Preparation = { state: 'preparing' } | { state: 'ready'; size: number; type: string; version: string };
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
  if (!data) return null;
  const ids = new Set((await savedTitles(base, data.user)).filter(entry => entry.complete && new File(entry.uri).exists).map(entry => entry.id));
  const items = data.items.filter(item => ids.has(item.id));
  const progress = await progressRecovery.restore(recoveryScope(base, data.user), data.progress, items.map(item => item.id));
  return { ...data, items, progress, folders: [], queue: data.queue.filter(id => ids.has(id)) };
}

export function pauseOffline(base: string, user: MatroUser, id: string) { jobs.get(recordKey(account(base, user), id))?.controller.abort(); }
export async function removeOffline(base: string, user: MatroUser, id: string) {
  const key = recordKey(account(base, user), id);
  pauseOffline(base, user, id);
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
  const job: OfflineJob = { id: item.id, title, have: 0, size: 0, controller, task: Promise.resolve() };
  const notice = offlineNotice(key, title);
  const route = `/api/items/${encodeURIComponent(item.id)}`;
  async function download() {
    const headers = await mediaHeaders(base);
    const previous = await read<SavedMedia>(key);
    if (previous?.complete && new File(previous.uri).exists) return;
    notice.progress(0, 0);
    const started = Date.now();
    let preparation: Preparation;
    for (;;) {
      if (signal.aborted) return;
      preparation = await request(base, route + '/offline');
      if (preparation.state === 'ready') break;
      if (preparation.state !== 'preparing' || Date.now() - started > 30 * 60 * 1000) throw new Error('The server did not finish preparing this title.');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
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
    for (let start = record.have; start < size; start = record.have) {
      if (signal.aborted) return;
      const end = Math.min(start + PIECE, size) - 1;
      const response = await fetch(base + route + '/offline/file?version=' + version, { headers: { ...headers, range: `bytes=${start}-${end}` }, signal });
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) {
        if (response.status === 401) throw new ServerError('Sign in again to finish the download.', 401);
        throw new Error('The prepared file changed. Retry the download.');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== end - start + 1) throw new Error('The server stopped sending the file.');
      if (signal.aborted) return;
      const writer = file.open();
      try { writer.offset = start; writer.writeBytes(bytes); } finally { writer.close(); }
      record.have = end + 1;
      await persist();
    }
    record.complete = true;
    await persist();
    notice.done();
  }
  job.task = download().catch(error => { notice.dismiss(); if (!signal.aborted) throw error; }).finally(() => {
    if (signal.aborted) notice.dismiss();
    jobs.delete(key); changed();
  });
  jobs.set(key, job); changed();
  return job.task;
}

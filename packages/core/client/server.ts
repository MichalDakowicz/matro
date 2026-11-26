// Portable native client. Sessions are supplied by the platform's secure storage;
// media requests carry the same revocable bearer session as API requests.

export type MatroUser = { id: number; accountKey?: string; legacyScope?: true; username: string; role: string };
export type Status = { setup: boolean; user: MatroUser | null };

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.]+$|.*\.(local|lan|home)$)/i;

/** "matro.dakowicz.xyz" -> ["https://matro.dakowicz.xyz"]; "192.168.1.5:8484" -> ["http://192.168.1.5:8484"]. */
export function candidates(input: string): string[] {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) return [raw];
  const host = raw.split('/')[0].split(':')[0];
  return PRIVATE_HOST.test(host) ? [`http://${raw}`, `https://${raw}`] : [`https://${raw}`, `http://${raw}`];
}

export class ServerError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) { super(message); this.status = status; this.code = code; }
}
/** A 401, or the server saying the signed-in account differs from the one this client opened. Other 409s are ordinary refusals. */
export const accountChanged = (error: unknown) => error instanceof ServerError && (error.status === 401 || error.status === 409 && error.code === 'account-changed');

let tokenStorage: { get: (base: string) => Promise<string | null>; set: (base: string, token: string | null) => Promise<void> } | null = null;
export function configureTokenStorage(storage: NonNullable<typeof tokenStorage>) { tokenStorage = storage; }
export async function mediaHeaders(base: string): Promise<Record<string, string>> {
  const token = await tokenStorage?.get(base);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Keep the signal attached through the body read, with a fresh deadline after headers arrive.
// `read` may call `touch` as data arrives to restart the body deadline, making `bodyMs` an idle limit for large bodies.
export async function fetchWithDeadline<R, T>(
  send: (signal: AbortSignal) => Promise<R>,
  read: (response: R, touch: () => void) => Promise<T>,
  { signal, requestMs = 15000, bodyMs = 30000 }: { signal?: AbortSignal; requestMs?: number; bodyMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel);
  if (signal?.aborted) cancel();
  async function phase<V>(run: (touch: () => void) => Promise<V>, ms: number, message: string) {
    if (controller.signal.aborted) throw new Error('Request cancelled.');
    let timedOut = false;
    let rejectAbort: () => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error(timedOut ? message : 'Request cancelled.'));
      controller.signal.addEventListener('abort', rejectAbort);
    });
    const arm = () => setTimeout(() => { timedOut = true; cancel(); }, ms);
    let timer = arm();
    const touch = () => { clearTimeout(timer); timer = arm(); };
    try { return await Promise.race([aborted, run(touch)]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAbort!); }
  }
  try {
    const response = await phase(() => send(controller.signal), requestMs, 'The server took too long to respond.');
    return await phase(touch => read(response, touch), bodyMs, 'The server took too long to send the response.');
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export async function request(base: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; accountId?: number } = {}, ms = 15000) {
  const headers = {
    'x-matro': '1',
    'x-matro-client': 'native',
    ...(init.accountId === undefined ? {} : { 'x-matro-account': String(init.accountId) }),
    ...await mediaHeaders(base),
    ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
  };
  const json = await fetchWithDeadline(signal => fetch(base + path, {
    method: init.method ?? 'GET',
    credentials: 'include',
    signal,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  }), async res => {
    const json = await res.json().catch(error => {
      if (error instanceof SyntaxError) return null;
      if (!res.ok) throw new ServerError(`Server answered ${res.status}.`, res.status);
      throw error;
    });
    if (!res.ok) throw new ServerError(json?.error ?? `Server answered ${res.status}.`, res.status, json?.code);
    return json;
  }, { signal: init.signal, requestMs: ms, bodyMs: ms });
  if (json?.token) await tokenStorage?.set(base, json.token);
  return json;
}

/** Finds a working address for what the person typed and proves it is a Matro server. */
export async function connect(input: string): Promise<{ base: string; status: Status }> {
  const list = candidates(input);
  if (!list.length) throw new ServerError('Enter your server address.');
  let answered: ServerError | undefined;
  for (const base of list) {
    try {
      const status = await request(base, '/api/status');
      if (status && typeof status.setup === 'boolean') return { base, status };
    } catch (error) {
      if (error instanceof ServerError && error.status) answered = error; // The server replied: keep its own message.
      /* try the next scheme */
    }
  }
  throw answered ?? new ServerError("Couldn't reach a Matro server at that address.");
}

const sessionExchanges = new Map<string, Promise<void>>();
async function ensureNativeSession(base: string) {
  if (!tokenStorage || await tokenStorage.get(base)) return;
  if (!sessionExchanges.has(base)) sessionExchanges.set(base, request(base, '/api/session/native', { method: 'POST', body: {} }).then(() => {}).finally(() => sessionExchanges.delete(base)));
  await sessionExchanges.get(base);
}
export const status = async (base: string): Promise<Status> => {
  const value: Status = await request(base, '/api/status');
  if (value.user) await ensureNativeSession(base);
  return value;
};
export const login = (base: string, username: string, password: string): Promise<{ user: MatroUser }> =>
  request(base, '/api/login', { method: 'POST', body: { username, password } });
export const signup = (base: string, code: string, username: string, password: string): Promise<{ user: MatroUser }> =>
  request(base, '/api/signup', { method: 'POST', body: { code, username, password } });
export const logout = async (base: string): Promise<unknown> => {
  try { return await request(base, '/api/logout', { method: 'POST' }); }
  finally { await tokenStorage?.set(base, null); }
};

export type RequestKind = 'movie' | 'series' | 'season';
export type MovieRequest = {
  id: number; title: string; year: number | null; kind: RequestKind; season: number | null; tmdbId: number | null;
  status: 'pending' | 'handled'; outcome?: 'pending' | 'ready' | 'declined' | 'handled'; groupId: string | null; isNew: boolean;
  created: number; requester: string | null;
};
export type MovieRequests = { pending: MovieRequest[]; handled: MovieRequest[]; alertsConfigured?: boolean; canRemove?: boolean; tmdb?: boolean };
export type RequestDraft = { title: string; year?: string; kind: RequestKind; season?: number; tmdbId?: number };
export type TitleChoice = { id: number; title: string; year: string | null; overview: string; thumb: string | null };
export const movieRequests = (base: string, owner: boolean): Promise<MovieRequests> =>
  request(base, owner ? '/api/admin/movie-requests' : '/api/movie-requests');
export const sendMovieRequest = (base: string, draft: RequestDraft): Promise<{ request: MovieRequest; duplicate: boolean }> =>
  request(base, '/api/movie-requests', { method: 'POST', body: draft });
export const searchRequestTitles = async (base: string, kind: RequestKind, query: string): Promise<TitleChoice[]> =>
  (await request(base, `/api/movie-requests/search?kind=${kind === 'movie' ? 'movie' : 'show'}&query=${encodeURIComponent(query)}`)).results;
export const markMovieRequestHandled = (base: string, id: number, declined = false): Promise<{ request: MovieRequest }> =>
  request(base, `/api/admin/movie-requests/${id}`, { method: 'PATCH', body: declined ? { declined: true } : undefined });
export const removeMovieRequest = (base: string, id: number): Promise<unknown> =>
  request(base, `/api/movie-requests/${id}`, { method: 'DELETE' });
// Viewers and the head account register their phones on different routes.
const movieRequestDevicePath = (owner: boolean) => owner ? '/api/admin/movie-requests/device' : '/api/movie-requests/device';
export const registerMovieRequestDevice = (base: string, token: string, owner: boolean): Promise<{ registration: string }> =>
  request(base, movieRequestDevicePath(owner), { method: 'PUT', body: { token } });
export const unregisterMovieRequestDevice = (base: string, owner: boolean): Promise<unknown> =>
  request(base, movieRequestDevicePath(owner), { method: 'DELETE' });
export const testMovieRequestAlert = (base: string, owner: boolean): Promise<unknown> =>
  request(base, movieRequestDevicePath(owner) + '/test', { method: 'POST' });

export type Item = { id: string; groupId: string; title: string; group: string; kind: string; season: number | null; episode: number | null; format: string; root?: string; path?: string; added?: number; editionGroup?: string; editionLabel?: string; size?: number };
export type Progress = { position: number; duration: number; completed?: boolean; hidden?: boolean; updated: number };
export type Metadata = { title?: string; poster?: string; backdrop?: string; overview?: string; tagline?: string; year?: string | number; genres?: string[]; runtime?: number; rating?: number; votes?: number; people?: string[]; peopleLabel?: string; cast?: { name: string; role?: string; photo?: string }[]; episodes?: Record<string, Record<string, { name?: string; overview?: string; still?: string; runtime?: number }>> };
export type TrackChoice = { language: string; title: string; codec?: string; channels?: number };
export type TrackPreference = { audio?: TrackChoice | null; subtitle?: TrackChoice | null; off?: boolean; delay?: number; audioDelay?: number; size?: number };
export type TrackDefaults = { audio?: string; subtitles?: 'off' | 'forced' | 'always'; subtitleLanguage?: string };
export type Preferences = { autoplay?: boolean; autoSkip?: boolean; volume?: number; tracks?: Record<string, TrackPreference>; trackDefaults?: TrackDefaults; [key: string]: unknown };
export type Segment = { type: 'intro' | 'outro' | 'recap'; start: number; end: number; source: 'manual' | 'automatic' };
export type ScannerStatus = { ready: number; total: number; message: string; complete?: boolean };
export type LibraryScanStatus = { scanning: boolean; lastScanAt: number | null; errors: { folder: string; error: string }[] };
export type Library = { scanStatus?: LibraryScanStatus; markers?: Record<string, Segment[]>; scanner?: ScannerStatus; user: MatroUser; items: Item[]; folders?: string[]; progress: Record<string, Progress>; queue: string[]; preferences: Preferences; metadata: Record<string, Metadata>; catalogRevision?: string; movieRequestsEnabled?: boolean; movieRequestPushEnabled?: boolean; requestUpdates?: { id: number; title: string; outcome: 'ready' | 'declined' }[] };
export type Track = { index: number; language: string; title: string; bitmap?: boolean; text?: boolean; codec?: string; channels?: number; default?: boolean };
export type Info = { duration: number; directPlay: boolean; hdrToneMap?: boolean; video?: { codec: string; height: number; width: number } | null; chapters?: { start: number; title: string }[]; audio: Track[]; embedded: Track[]; uploaded: { id: number; language: string; name: string; kind?: string }[]; files?: { id: number; language: string; title: string; codec: string; forced: boolean; sdh: boolean }[] };
export const library = async (base: string, accountId?: number): Promise<Library> => { await ensureNativeSession(base); return request(base, '/api/library', { accountId }); };
export const inspect = (base: string, id: string, signal?: AbortSignal): Promise<Info> => request(base, `/api/items/${encodeURIComponent(id)}/info`, { signal });
export const writeWatchState = (base: string, accountId: number, body: { progress?: Record<string, Progress>; queueChange?: { add: string[]; remove: string[] }; preferences?: Preferences }): Promise<{ progress?: Record<string, Progress> }> =>
  request(base, '/api/state', { method: 'PUT', body, accountId });
export const changeProgress = (base: string, accountId: number, id: string, body: { dismiss: true; dismissedAt?: number } | { completed: boolean; checkpoint?: Progress }): Promise<{ progress: Record<string, Progress> }> =>
  request(base, `/api/items/${encodeURIComponent(id)}/progress`, { method: 'PATCH', body, accountId });
export const changeProgressMany = (base: string, accountId: number, ids: string[], completed: boolean): Promise<{ progress: Record<string, Progress> }> =>
  request(base, '/api/progress', { method: 'PATCH', body: { ids, completed }, accountId });
type PlaybackOptions = {
  position: number;
  audio?: number | null;
  burn?: number | null;
  subtitleDelay?: number;
  session?: string;
  quality?: string;
  audioDelay?: number;
};

export function playbackPath(id: string, info: Info, { position, audio = null, burn = null, subtitleDelay = 0, session, quality, audioDelay = 0 }: PlaybackOptions) {
  const root = `/api/items/${encodeURIComponent(id)}`;
  const q = new URLSearchParams();
  if (session) q.set('session', session);
  const tier = info.video && quality && quality !== 'original' ? quality : null;
  if (!tier && !audioDelay && info.directPlay && burn === null && (audio === null || audio === info.audio[0]?.index)) return { path: root + '/direct' + (session ? '?' + q : ''), offset: 0, start: position };
  q.set('t', String(position));
  if (audio !== null) q.set('audio', String(audio));
  if (tier) q.set('quality', tier);
  if (burn !== null) { q.set('burn', String(burn)); if (subtitleDelay) q.set('delay', String(subtitleDelay)); }
  if (audioDelay) q.set('adelay', String(audioDelay));
  return { path: root + '/transcode?' + q, offset: position, start: 0 };
}

export function playbackState(base: string, session: string, playing: boolean, buffering = false) {
  return request(base, '/api/playback/state', { method: 'POST', body: { session, playing, buffering } });
}

export function stopPlayback(base: string, session: string) {
  return request(base, '/api/playback/stop', { method: 'POST', body: { session } });
}

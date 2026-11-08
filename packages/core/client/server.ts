// Portable native client. Sessions are supplied by the platform's secure storage;
// media requests carry the same revocable bearer session as API requests.

export type MatroUser = { id: number; username: string; role: string };
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
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

let tokenStorage: { get: (base: string) => Promise<string | null>; set: (base: string, token: string | null) => Promise<void> } | null = null;
export function configureTokenStorage(storage: NonNullable<typeof tokenStorage>) { tokenStorage = storage; }
export async function mediaHeaders(base: string): Promise<Record<string, string>> {
  const token = await tokenStorage?.get(base);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export async function request(base: string, path: string, init: { method?: string; body?: unknown } = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(base + path, {
      method: init.method ?? 'GET',
      credentials: 'include',
      signal: ctrl.signal,
      headers: {
        'x-matro': '1',
        'x-matro-client': 'native',
        ...await mediaHeaders(base),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ServerError(json?.error ?? `Server answered ${res.status}.`, res.status);
    if (json?.token) await tokenStorage?.set(base, json.token);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** Finds a working address for what the person typed and proves it is a Matro server. */
export async function connect(input: string): Promise<{ base: string; status: Status }> {
  const list = candidates(input);
  if (!list.length) throw new ServerError('Enter your server address.');
  for (const base of list) {
    try {
      const status = await request(base, '/api/status');
      if (status && typeof status.setup === 'boolean') return { base, status };
    } catch {
      /* try the next scheme */
    }
  }
  throw new ServerError("Couldn't reach a Matro server at that address.");
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

export type Item = { id: string; groupId: string; title: string; group: string; kind: string; season: number | null; episode: number | null; format: string; root?: string; path?: string; added?: number };
export type Progress = { position: number; duration: number; completed?: boolean; hidden?: boolean; updated: number };
export type Metadata = { title?: string; poster?: string; backdrop?: string; overview?: string; tagline?: string; year?: string | number; genres?: string[]; runtime?: number; rating?: number; votes?: number; people?: string[]; peopleLabel?: string; cast?: { name: string; role?: string; photo?: string }[]; episodes?: Record<string, Record<string, { name?: string; overview?: string; still?: string; runtime?: number }>> };
export type TrackChoice = { language: string; title: string; codec?: string; channels?: number };
export type TrackPreference = { audio?: TrackChoice | null; subtitle?: TrackChoice | null; off?: boolean; delay?: number; size?: number };
export type Preferences = { autoplay?: boolean; volume?: number; tracks?: Record<string, TrackPreference>; [key: string]: unknown };
export type Library = { user: MatroUser; items: Item[]; folders?: string[]; progress: Record<string, Progress>; queue: string[]; preferences: Preferences; metadata: Record<string, Metadata> };
export type Track = { index: number; language: string; title: string; bitmap?: boolean; text?: boolean; codec?: string; channels?: number; default?: boolean };
export type Info = { duration: number; directPlay: boolean; video?: { codec: string; height: number; width: number } | null; chapters?: { start: number; title: string }[]; audio: Track[]; embedded: Track[]; uploaded: { id: number; language: string; name: string }[] };
export const library = async (base: string): Promise<Library> => { await ensureNativeSession(base); return request(base, '/api/library'); };
export const inspect = (base: string, id: string): Promise<Info> => request(base, `/api/items/${encodeURIComponent(id)}/info`);
export const saveProgress = (base: string, id: string, entry: Progress) => request(base, '/api/state', { method: 'PUT', body: { progress: { [id]: entry } } });
export function playbackPath(id: string, info: Info, position: number, audio: number | null, burn: number | null, delay = 0) {
  const root = `/api/items/${encodeURIComponent(id)}`;
  if (info.directPlay && burn === null && (audio === null || audio === info.audio[0]?.index)) return { path: root + '/direct', offset: 0, start: position };
  const q = new URLSearchParams({ t: String(position) });
  if (audio !== null) q.set('audio', String(audio));
  if (burn !== null) { q.set('burn', String(burn)); if (delay) q.set('delay', String(delay)); }
  return { path: root + '/transcode?' + q, offset: position, start: 0 };
}

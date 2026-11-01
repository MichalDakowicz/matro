// Everything the app says to a Matro server. Mirrors server/public/web/auth.js: every write carries x-matro: 1,
// and the session lives in the matro_session cookie, which the native cookie jar shares with the WebView.

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

export class ServerError extends Error {}

async function request(base: string, path: string, init: { method?: string; body?: unknown } = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(base + path, {
      method: init.method ?? 'GET',
      credentials: 'include',
      signal: ctrl.signal,
      headers: {
        'x-matro': '1',
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ServerError(json?.error ?? `Server answered ${res.status}.`);
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

export const status = (base: string): Promise<Status> => request(base, '/api/status');
export const login = (base: string, username: string, password: string): Promise<{ user: MatroUser }> =>
  request(base, '/api/login', { method: 'POST', body: { username, password } });
export const signup = (base: string, code: string, username: string, password: string): Promise<{ user: MatroUser }> =>
  request(base, '/api/signup', { method: 'POST', body: { code, username, password } });
export const logout = (base: string): Promise<unknown> => request(base, '/api/logout', { method: 'POST' });

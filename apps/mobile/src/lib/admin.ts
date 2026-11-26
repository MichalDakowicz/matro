// Account, subtitle, metadata and release-discovery requests the web profile and title page already make.
import { fetch } from 'expo/fetch';
import { mediaHeaders, request, ServerError, type Metadata } from './server';
import type { DiscoveryRelease } from './release-groups';
import { SUBTITLE_TYPES } from './names';
export { alternateTitles, subtitleName } from './names';

export type SubtitleKind = 'full' | 'forced' | 'sdh';
export const SUBTITLE_KINDS: [SubtitleKind, string][] = [['full', 'Full'], ['forced', 'Forced only'], ['sdh', 'SDH / captions']];
export const SUBTITLE_LIMIT = 5 * 1024 * 1024; // server MAX_UPLOAD

export async function uploadSubtitle(base: string, itemId: string, file: { name: string; size?: number | null; arrayBuffer: () => Promise<ArrayBuffer> }, label: { name: string; language: string; kind: SubtitleKind }) {
  if (!SUBTITLE_TYPES.test(file.name)) throw new ServerError('Choose an SRT, VTT, ASS or SSA file.');
  if ((file.size ?? 0) > SUBTITLE_LIMIT) throw new ServerError('Subtitle files must be smaller than 5 MB.');
  const query = new URLSearchParams({ name: label.name, lang: label.language, kind: label.kind, filename: file.name });
  const response = await fetch(`${base}/api/items/${encodeURIComponent(itemId)}/subtitles?${query}`, {
    method: 'POST', headers: { 'x-matro': '1', 'x-matro-client': 'native', ...await mediaHeaders(base) }, body: await file.arrayBuffer(),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new ServerError(json?.error ?? `Server answered ${response.status}.`, response.status);
  return json;
}

export type TmdbMatch = { id: number; title: string; year: string | null; overview: string; thumb: string | null };
export const searchTmdb = async (base: string, kind: 'movie' | 'show', query: string): Promise<TmdbMatch[]> =>
  (await request(base, `/api/admin/metadata/search?${new URLSearchParams({ kind, query })}`)).results;
/** `tmdbId: null` clears the match. Returns the library's whole metadata map. */
export const assignTmdb = async (base: string, key: string, tmdbId: number | null): Promise<Record<string, Metadata>> =>
  (await request(base, '/api/admin/metadata/assign', { method: 'POST', body: { key, tmdbId } })).metadata;
export const setMetadataLanguage = async (base: string, key: string, language: string): Promise<Record<string, Metadata>> =>
  (await request(base, '/api/admin/metadata/language', { method: 'POST', body: { key, language } })).metadata;

export const changePassword = (base: string, current: string, password: string): Promise<unknown> =>
  request(base, '/api/me/password', { method: 'POST', body: { current, password } });
export type Person = { id: number; username: string; role: string; created: number; lastWatched: number | null; subtitles: number };
export type Invite = { id: number; created: number; expires: number; usedAt: number | null; usedBy: string | null; status: 'waiting' | 'used' | 'expired' };
export const listPeople = async (base: string): Promise<Person[]> => (await request(base, '/api/admin/users')).users;
export const resetPassword = (base: string, id: number, password: string): Promise<unknown> => request(base, `/api/admin/users/${id}`, { method: 'PATCH', body: { password } });
export const removePerson = (base: string, id: number): Promise<unknown> => request(base, `/api/admin/users/${id}`, { method: 'DELETE' });
export const listInvites = async (base: string): Promise<Invite[]> => (await request(base, '/api/admin/invites')).invites;
export const createInvite = (base: string, days = 7): Promise<{ code: string; expires: number }> => request(base, '/api/admin/invites', { method: 'POST', body: { days } });
export const revokeInvite = (base: string, id: number): Promise<unknown> => request(base, `/api/admin/invites/${id}`, { method: 'DELETE' });

export type DiscoveryKind = 'movie' | 'show' | 'anime';
export type Discovery = { results: DiscoveryRelease[]; warnings?: string[]; prowlarrEnabled?: boolean };
const download = async (base: string, route: string, body: unknown, ms = 30000) => (await request(base, `/api/admin/downloads/${route}`, { method: 'POST', body }, ms)).result;
/** Without a query this is the Most seeded view. */
export const discover = (base: string, body: { kind: DiscoveryKind; query?: string; aliases?: string[]; additionalOnly?: boolean }): Promise<Discovery> => download(base, 'discover', body);
export type TitlePreview = { key: string; metadata: (Metadata & { originalTitle?: string; aliases?: string[] }) | null };
export const previewTitles = (base: string, titles: { key: string; kind: string; title: string; year?: string | number | null; tmdbId?: string | number; imdbId?: string }[], detail = false): Promise<{ enabled?: boolean; results?: TitlePreview[] }> =>
  download(base, 'preview', { titles, ...(detail ? { detail: true } : {}) });

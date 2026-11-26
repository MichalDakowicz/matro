const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { HttpError } = require('./http');
const { normalize } = require('./lang');
const { MAX_UPLOAD } = require('./subtitles');

const API = 'https://api.opensubtitles.com/api/v1/';
const DOWNLOAD_HOSTS = new Set(['api.opensubtitles.com', 'www.opensubtitles.com', 'dl.opensubtitles.com']);
const TTL = 10 * 60 * 1000;
const USER_AGENT = `Matro v${require('../../../package.json').version}`;
// Every account shares the head account's OpenSubtitles quota, so each one is held to its own share.
const LIMITS = { searches: 10, searchWindow: 60 * 1000, downloads: 20, downloadWindow: 24 * 60 * 60 * 1000 };

async function bytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.length;
      if (size > limit) throw new HttpError(502, 'OpenSubtitles returned too much data.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
}

function createSubtitleSearch({ dir, secure, fetch = globalThis.fetch, limits = {}, now = Date.now }) {
  const file = path.join(dir, 'opensubtitles.key');
  const matches = new Map();
  const max = { ...LIMITS, ...limits }, hits = new Map();
  // Spend one use of a per-user allowance, or refuse with 429 and when it frees up.
  function spend(user, kind, count, windowMs, what) {
    const id = `${kind}:${user}`, since = now() - windowMs, recent = (hits.get(id) || []).filter(at => at > since);
    if (recent.length >= count) {
      hits.set(id, recent);
      const wait = Math.ceil((recent[0] + windowMs - now()) / 1000);
      throw new HttpError(429, `Too many ${what}. Try again in ${wait >= 3600 ? Math.ceil(wait / 3600) + ' hours' : wait >= 60 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'}.`);
    }
    hits.set(id, [...recent, now()]);
  }
  async function key() {
    try {
      const raw = await fs.readFile(file);
      return secure ? secure.decryptString(raw) : raw.toString('utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw new HttpError(500, 'Could not read OpenSubtitles settings.');
    }
  }
  async function configure(input) {
    if (typeof input !== 'string' || !/^[!-~]{0,200}$/.test(input.trim())) throw new HttpError(400, 'Enter a valid OpenSubtitles API key.');
    const secret = input.trim();
    if (secret) {
      if (secure && !secure.isEncryptionAvailable()) throw new HttpError(503, 'OS password storage is unavailable.');
      const pending = file + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(pending, secure ? secure.encryptString(secret) : secret, { mode: 0o600, flag: 'wx' });
        await fs.rename(pending, file);
      } finally { await fs.rm(pending, { force: true }); }
    } else await fs.rm(file, { force: true });
    matches.clear();
    return { enabled: !!secret };
  }
  async function apiKey() {
    const secret = await key();
    if (!secret) throw new HttpError(403, 'OpenSubtitles search is off.');
    return secret;
  }
  async function request(url, options = {}) {
    try { return await fetch(url, { ...options, signal: AbortSignal.timeout(15000), redirect: options.redirect || 'error' }); }
    catch { throw new HttpError(502, 'Could not reach OpenSubtitles.'); }
  }
  async function api(endpoint, secret, data) {
    const response = await request(new URL(endpoint, API), {
      headers: { 'Api-Key': secret, 'User-Agent': USER_AGENT, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { method: 'POST', body: JSON.stringify(data) } : {})
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(502, response.status === 429 ? 'OpenSubtitles has reached its request or download limit.' : 'OpenSubtitles rejected the request. Check the API key and try again.');
    }
    const body = await bytes(response, 1024 * 1024);
    try { return JSON.parse(body.toString('utf8')); }
    catch { throw new HttpError(502, 'OpenSubtitles returned an invalid response.'); }
  }
  async function search(item, language, scope) {
    const secret = await apiKey();
    const lang = normalize(language);
    if (lang === 'und') throw new HttpError(400, 'Choose a subtitle language.');
    spend(scope, 'search', max.searches, max.searchWindow, 'subtitle searches');
    const show = item.kind === 'show';
    const title = String(show ? item.group_title || item.group : item.title).slice(0, 200);
    const query = new URLSearchParams({ query: title, languages: lang, type: show ? 'episode' : 'movie' });
    if (show && item.season != null && item.episode != null) {
      query.set('season_number', String(item.season));
      query.set('episode_number', String(item.episode));
    }
    if (!show && item.year) query.set('year', String(item.year));
    const response = await api('subtitles?' + query, secret);
    const results = [];
    const now = Date.now();
    for (const [token, result] of matches) if (result.expires <= now) matches.delete(token);
    for (const entry of (Array.isArray(response?.data) ? response.data : [])) {
      const attr = entry?.attributes, source = attr?.files?.[0];
      if (!Number.isSafeInteger(source?.file_id) || source.file_id < 1 || Number(source.cd_number) > 1) continue;
      const name = String(attr.release || source.file_name || 'OpenSubtitles').trim().slice(0, 200) || 'OpenSubtitles';
      const result = { token: randomUUID(), name, language: normalize(attr.language) === 'und' ? lang : normalize(attr.language), kind: attr.foreign_parts_only ? 'forced' : attr.hearing_impaired ? 'sdh' : 'full' };
      if (matches.size >= 400) matches.delete(matches.keys().next().value);
      matches.set(result.token, { ...result, fileId: source.file_id, itemId: item.id, scope, expires: now + TTL });
      results.push(result);
      if (results.length >= 20) break;
    }
    return results;
  }
  async function download(item, token, scope) {
    const secret = await apiKey(), result = matches.get(token);
    if (!result || result.expires <= Date.now() || result.itemId !== item.id || result.scope !== scope) throw new HttpError(404, 'Search again to refresh subtitle results.');
    spend(scope, 'download', max.downloads, max.downloadWindow, 'subtitle downloads today');
    const payload = await api('download', secret, { file_id: result.fileId, sub_format: 'srt' });
    let link;
    try { link = new URL(payload.link); } catch { throw new HttpError(502, 'OpenSubtitles returned an invalid download link.'); }
    for (let redirect = 0; redirect < 4; redirect++) {
      if (link.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(link.hostname) || link.port || link.username || link.password) throw new HttpError(502, 'OpenSubtitles returned an invalid download link.');
      const response = await request(link, { redirect: 'manual' });
      if (response.ok) return { name: result.name, language: result.language, kind: result.kind, body: await bytes(response, MAX_UPLOAD) };
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) break;
      try { link = new URL(location, link); } catch { break; }
    }
    throw new HttpError(502, 'Could not download the OpenSubtitles file.');
  }
  return { status: async () => ({ enabled: !!await key() }), configure, search, download };
}

module.exports = { createSubtitleSearch };

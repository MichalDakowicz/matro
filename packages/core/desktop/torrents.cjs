const fs = require('node:fs/promises');
const path = require('node:path');
const { storageOptions } = require('./download-layout.cjs');
const { createDownloadJobs } = require('./download-jobs.cjs');
const { createSeriesCatalog } = require('./series-catalog.cjs');
const { connectionError } = require('./torrent-connection.cjs');

const targets = ['local', 'server'];
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const hashPattern = /^[a-f0-9]{40}$/i;
function endpoint(value, target) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a full qBittorrent Web UI address, including http:// or https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) Web UI address without credentials, query, or fragment.');
  if (target === 'local' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('This PC must use localhost, 127.0.0.1, or [::1]. Use Server for another machine.');
  url.pathname = url.pathname.replace(/\/(?:api\/v2)?\/*$/, '') + '/';
  return url.href;
}

// Why a request failed, without the address: shown after "Could not reach the service".
const reason = error => error?.name === 'TimeoutError' ? 'timed out' : String(error?.cause?.code || error?.cause?.message || error?.message || '').replace(/https?:\/\/\S+/gi, '').trim().slice(0, 80);

// catalogFetch reaches the public catalogs (YTS, TVmaze, EZTV). In the app it is the
// Chromium network stack, which honours the system proxy and certificate store; the
// qBittorrent Web UI calls keep using fetch.
function createTorrents({ dir, secure, fetch = globalThis.fetch, catalogFetch = fetch, catalog = 'https://yts.gg/api/v2/', videos, checkPaths, validateUpgrade, onPrepared, onComplete, seriesShowsURL, seriesReleasesURL }) {
  const file = path.join(dir, 'downloads.json');
  let settings = { local: null, server: null, seeding: null }, writing = Promise.resolve();
  const sessions = new Map(), releases = new Map(), inFlight = new Set();
  const loaded = fs.readFile(file, 'utf8').then(contents => {
    const saved = JSON.parse(contents);
    settings.seeding = typeof saved.seeding === 'boolean' ? saved.seeding : null;
    for (const target of targets) if (saved[target]) {
      const item = saved[target];
      settings[target] = { url: endpoint(item.url, target), username: text(item.username), sshHost: text(item.sshHost, 255), savePath: text(item.savePath, 2000), secret: text(item.secret, 20000), storage: storageOptions(item.storage, target, item.savePath, videos) };
    }
  }).catch(error => { if (error.code !== 'ENOENT') throw new Error('Download settings could not be read. Restore or remove downloads.json in the Matro profile.'); });
  // Avoid an unhandled rejection before the user opens Downloads.
  void loaded.catch(() => {});
  const checkTarget = target => { if (!targets.includes(target)) throw new Error('Choose This PC or Server.'); return target; };
  function snapshot() {
    return { seeding: settings.seeding, defaults: Object.fromEntries(targets.map(target => [target, storageOptions(null, target, '', videos)])), ...Object.fromEntries(targets.map(target => {
      const item = settings[target];
      return [target, item ? { url: item.url, username: item.username, sshHost: item.sshHost || '', savePath: item.savePath, passwordSaved: !!item.secret, storage: item.storage } : null];
    })) };
  }
  async function request(url, options = {}, via = fetch) {
    let response;
    try { response = await via(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch (error) { const detail = reason(error); throw Object.assign(new Error(`Could not reach the service${detail ? ` (${detail})` : ''}. Check its address, connection, and Web UI settings, then retry.`), { retryable: true }); }
    return response;
  }
  const catalogRequest = (url, options) => request(url, options, catalogFetch);
  async function body(response) {
    // Read a bounded body, including chunked responses with no Content-Length.
    const reader = response.body?.getReader();
    if (!reader) return '';
    let length = 0; const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.length;
        if (length > 4 * 1024 * 1024) throw new Error('Service response is too large.');
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally { await reader.cancel().catch(() => {}); }
  }
  async function json(response) {
    if (!response.ok) throw new Error(`Service returned HTTP ${response.status}. Try again later.`);
    try { return JSON.parse(await body(response)); } catch { throw new Error('Service returned an invalid response. Try again later.'); }
  }
  function password(config) {
    if (!config.secret) return '';
    if (!secure.isEncryptionAvailable()) throw new Error('OS password storage is unavailable.');
    try { return secure.decryptString(Buffer.from(config.secret, 'base64')); }
    catch { throw new Error('Saved password cannot be unlocked. Enter it again in Download settings.'); }
  }
  async function login(config, supplied) {
    const response = await request(new URL('api/v2/auth/login', config.url), {
      method: 'POST', headers: { Origin: new URL(config.url).origin, Referer: config.url },
      body: new URLSearchParams({ username: config.username, password: supplied ?? password(config) })
    });
    if (!response.ok) throw connectionError(response.status, 'qBittorrent login returned');
    const cookie = response.headers.get('set-cookie')?.match(/(?:^|[,;]\s*)SID=([^;,\s]+)/)?.[1];
    if (!response.ok || (await body(response)).trim() !== 'Ok.' || !cookie) throw new Error('qBittorrent login failed. Check credentials, Web UI access, and any login ban.');
    return `SID=${cookie}`;
  }
  async function qb(target, route, data, retry = true, configured) {
    checkTarget(target); await loaded;
    const config = configured || settings[target];
    if (!config) throw new Error('Configure this download destination first.');
    let cookie = sessions.get(config);
    if (!cookie) { cookie = await login(config); sessions.set(config, cookie); }
    const response = await request(new URL(`api/v2/${route}`, config.url), {
      method: data ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: new URL(config.url).origin, Referer: config.url },
      ...(data ? { body: new URLSearchParams(data) } : {})
    });
    if (response.status === 403 && retry) { sessions.delete(config); return qb(target, route, data, false, config); }
    if (!response.ok) throw connectionError(response.status);
    return response;
  }
  const series = createSeriesCatalog({ request: catalogRequest, json, showsURL: seriesShowsURL, releasesURL: seriesReleasesURL, rememberRelease: (hash, release) => {
    releases.delete(hash); releases.set(hash, release);
    while (releases.size > 1000) releases.delete(releases.keys().next().value);
  } });
  const jobs = createDownloadJobs({ dir, checkPaths, onPrepared, onComplete, configFor: async target => { await loaded; return settings[target]; }, call: async (target, route, data, config) => {
    const response = await qb(target, route, data, true, config);
    return /^torrents\/(info|files)\?/.test(route) ? json(response) : body(response);
  } });
  async function rememberSeeding(value) {
    const operation = writing.catch(() => {}).then(async () => {
      await loaded;
      const saved = { ...settings, seeding: value };
      await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file + '.tmp', JSON.stringify(saved), { mode: 0o600 }); await fs.rename(file + '.tmp', file); settings = saved;
    });
    writing = operation; return operation;
  }
  return {
    seriesSearch: options => series.search(options),
    seriesReleases: options => series.releases(options),
    seriesSource: id => series.source(id),
    async config() { await loaded; return snapshot(); },
    async configure(options) {
      // Serialize saves so a failed connection never replaces a working profile.
      const operation = writing.catch(() => {}).then(async () => {
        await loaded; const target = checkTarget(options?.target);
        const previous = settings[target];
        const next = { url: endpoint(text(options.url, 2000), target), username: text(options.username), sshHost: target === 'server' ? text(options.sshHost ?? previous?.sshHost, 255) : '', savePath: text(options.savePath, 2000), secret: '', storage: storageOptions(options.storage || previous?.storage, target, options.savePath, videos) };
        if (next.sshHost && !/^[a-zA-Z0-9.:[\]-]+$/.test(next.sshHost)) throw new Error('Enter only the SSH server hostname or IP address, without a URL, username, or path.');
        if (next.savePath && (!path.posix.isAbsolute(next.savePath) && !path.win32.isAbsolute(next.savePath) || /[\r\n\0]/.test(next.savePath))) throw new Error('Use an absolute save folder on the destination machine.');
        const supplied = typeof options.password === 'string' ? options.password : '';
        if (supplied.length > 4000) throw new Error('Password is too long.');
        if (supplied) {
          if (!secure.isEncryptionAvailable() || secure.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure OS password storage is unavailable.');
          next.secret = secure.encryptString(supplied).toString('base64');
        } else if (previous?.url === next.url && previous?.username === next.username) next.secret = previous.secret;
        const cookie = await login(next);
        const versionResponse = await request(new URL('api/v2/app/version', next.url), { headers: { Cookie: cookie, Origin: new URL(next.url).origin, Referer: next.url } });
        const version = (await body(versionResponse)).trim().match(/^v?(\d+)\.(\d+)/);
        if (!versionResponse.ok || !version || +version[1] < 5 || +version[1] === 5 && +version[2] < 1) throw new Error('Organized downloads require qBittorrent 5.1 or newer.');
        const seed = options.seeding === 'yes' ? true : options.seeding === 'no' ? false : options.seeding === 'ask' ? null : settings.seeding;
        const saved = { ...settings, seeding: seed, [target]: next };
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(file + '.tmp', JSON.stringify(saved), { mode: 0o600 }); await fs.rename(file + '.tmp', file);
        if (previous) sessions.delete(previous);
        settings = saved; sessions.set(next, cookie); return snapshot();
      });
      writing = operation; return operation;
    },
    async search(options) {
      const query = text(options?.query, 200), page = options?.page ?? 1;
      if (!query) throw new Error('Enter a movie title to search.');
      if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error('Invalid results page.');
      const url = new URL('list_movies.json', catalog);
      url.search = new URLSearchParams({ query_term: query, page, limit: 20, sort_by: 'seeds' }).toString();
      const payload = await json(await catalogRequest(url));
      if (payload?.status !== 'ok' || !payload.data || (payload.data.movies !== undefined && !Array.isArray(payload.data.movies))) throw new Error('Movie catalog is unavailable. Try again later.');
      const movies = (payload.data.movies || []).slice(0, 20).map(movie => {
        const title = text(movie.title, 300), variants = [];
        for (const item of (Array.isArray(movie.torrents) ? movie.torrents : []).slice(0, 30)) {
          if (!hashPattern.test(item.hash)) continue;
          const hash = item.hash.toLowerCase();
          releases.delete(hash); releases.set(hash, { title, year: movie.year, kind: 'movie', hash, quality: text(item.quality, 30), expires: Date.now() + 60 * 60 * 1000 });
          variants.push({ hash, quality: text(item.quality, 30), type: text(item.type, 30), codec: text(item.video_codec, 30), size: text(item.size, 30), seeds: Math.max(0, Number(item.seeds) || 0), peers: Math.max(0, Number(item.peers) || 0) });
        }
        return { id: String(movie.id), title, year: text(String(movie.year), 10), language: text(movie.language, 30), overview: text(movie.summary || movie.description_full, 2000), torrents: variants };
      });
      while (releases.size > 1000) releases.delete(releases.keys().next().value);
      return { movies, page, total: Math.max(0, Number(payload.data.movie_count) || 0) };
    },
    async add(options) {
      const target = checkTarget(options?.target);
      let hash = options?.hash, release = releases.get(hash);
      if (options?.magnet) {
        let magnet;
        try { magnet = new URL(options.magnet); } catch { throw new Error('Enter a valid magnet link.'); }
        hash = magnet.searchParams.get('xt')?.match(/^urn:btih:([a-f0-9]{40})$/i)?.[1]?.toLowerCase();
        if (magnet.protocol !== 'magnet:' || !hash || !text(options.title) || !['movie', 'show'].includes(options.kind)) throw new Error('A magnet link, title, and Movie or Show type are required.');
        release = { hash, title: text(options.title, 200), year: /^\d{4}$/.test(options.year) ? options.year : '', kind: options.kind, quality: /^\d{3,4}p$/.test(options.quality) ? options.quality : '', season: Math.max(1, Math.min(99, +options.season || 1)), expires: Infinity };
        const cleanMagnet = new URL(`magnet:?xt=urn:btih:${hash}`);
        for (const tracker of magnet.searchParams.getAll('tr').slice(0, 30)) if (/^(https?|udp):\/\//i.test(tracker) && tracker.length < 2000) cleanMagnet.searchParams.append('tr', tracker);
        release.magnet = cleanMagnet.href;
      }
      if (!release || release.expires < Date.now()) throw new Error('Search again to refresh this release before downloading.');
      const key = `${target}:${hash}`;
      if (inFlight.has(key)) throw new Error('This release is already being sent.');
      inFlight.add(key);
      try {
        await loaded; const config = settings[target];
        if (!config) throw new Error('Configure this download destination first.');
        const seed = typeof options.seed === 'boolean' ? options.seed : settings.seeding;
        if (typeof seed !== 'boolean') throw new Error('Choose whether to seed after downloading before starting.');
        const existing = await json(await qb(target, `torrents/info?hashes=${hash}`, undefined, true, config));
        if (!Array.isArray(existing)) throw new Error('qBittorrent returned an invalid torrent list.');
        if (existing.length) return { duplicate: true };
        const version = (await body(await qb(target, 'app/version', undefined, true, config))).trim().match(/^v?(\d+)\.(\d+)/);
        if (!version || +version[1] < 5 || +version[1] === 5 && +version[2] < 1) throw new Error('Organized downloads require qBittorrent 5.1 or newer.');
        if (options.upgradeId) {
          if (release.kind !== 'movie') throw new Error('Series releases cannot be submitted as a movie upgrade.');
          if (!validateUpgrade) throw new Error('Movie upgrades are unavailable.');
          release = await validateUpgrade(options.upgradeId, release);
        }
        if (options.rememberSeed) await rememberSeeding(seed);
        const job = await jobs.create(target, config, release, seed);
        const data = { urls: release.magnet || `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(release.title)}`, savepath: job.stage, autoTMM: 'false', useDownloadPath: 'false', stopped: 'false', stopCondition: 'MetadataReceived', tags: job.tag, contentLayout: 'Original', shareLimitAction: 'Stop', ratioLimit: seed ? '-1' : '0', seedingTimeLimit: seed ? '-1' : '0', inactiveSeedingTimeLimit: '-1' };
        try {
          const response = await qb(target, 'torrents/add', data, true, config);
          if ((await body(response)).trim() !== 'Ok.') throw new Error('qBittorrent did not accept this release.');
        } catch (error) { await jobs.fail(job, error); throw error; }
        return { duplicate: false, preparing: true, jobId: job.id };
      } finally { inFlight.delete(key); }
    },
    async list(target) {
      const items = await json(await qb(target, 'torrents/info?sort=added_on&reverse=true&limit=100'));
      if (!Array.isArray(items)) throw new Error('qBittorrent returned an invalid torrent list.');
      return items.slice(0, 100).map(item => ({ hash: text(item.hash, 64), name: text(item.name), progress: Math.max(0, Math.min(1, Number(item.progress) || 0)), state: text(item.state, 80), speed: Math.max(0, Number(item.dlspeed) || 0), savePath: text(item.save_path, 2000), temporaryPath: text(item.download_path, 2000) }));
    },
    jobs: target => jobs.status(target),
    async remove(options) {
      const target = checkTarget(options?.target), hash = options?.hash;
      if (typeof hash !== 'string' || !hashPattern.test(hash)) throw new Error('Choose a valid download to remove.');
      const key = `${target}:${hash}`;
      if (inFlight.has(key)) throw new Error('This download is busy. Try again in a moment.');
      inFlight.add(key);
      try {
      await loaded;
      const config = settings[target];
      if (!config) throw new Error('Configure this download destination first.');
      await jobs.remove(target, hash, async matching => {
        if (matching.some(job => job.url !== config.url || job.username !== config.username)) throw new Error('Reconnect the original download client before removing this download.');
        const info = await json(await qb(target, `torrents/info?hashes=${hash}`, undefined, true, config));
        if (!Array.isArray(info)) throw new Error('qBittorrent returned an invalid torrent list.');
        if (info.length) await qb(target, 'torrents/delete', { hashes: hash, deleteFiles: 'false' }, true, config);
      });
      return { removed: true, filesKept: true };
      } finally { inFlight.delete(key); }
    },
    retry: id => jobs.retry(id),
    process: () => jobs.process(),
    start: () => jobs.start(),
    close: () => jobs.close()
  };
}
module.exports = { createTorrents, endpoint };

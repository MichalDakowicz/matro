const { createHash } = require('node:crypto');
const { canonicalHash, cleanMagnet } = require('./release-discovery.cjs');

const categories = {
  movie: [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060],
  show: [5000, 5020, 5030, 5040, 5045, 5050],
  anime: [5070]
};
const limit = 100;
const torrentLimit = 4 * 1024 * 1024;

function configURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    url.pathname = url.pathname.replace(/\/+$/, '') + '/';
    return url;
  } catch { return null; }
}

function proxyURL(value, base, indexerId) {
  if (!Number.isSafeInteger(indexerId) || indexerId < 1 || typeof value !== 'string' || value.length > 32000) return null;
  try {
    const url = new URL(value);
    const proxy = new URL(`${indexerId}/download`, base);
    if (url.origin !== base.origin || url.pathname !== proxy.pathname || url.username || url.password || url.hash) return null;
    const links = url.searchParams.getAll('link'), files = url.searchParams.getAll('file');
    if (links.length !== 1 || !/^[\w-]{1,24000}$/.test(links[0]) || files.length !== 1 || !files[0] || files[0].length > 1500) return null;
    // Rebuild the URL with the documented fields only. Credentials go in the header.
    proxy.search = new URLSearchParams({ link: links[0], file: files[0] });
    return proxy;
  } catch { return null; }
}

function originalTorrentHash(buffer) {
  let offset = 0;
  const invalid = () => { throw new Error('Prowlarr returned invalid or unsupported torrent metadata.'); };
  function byteString() {
    const start = offset;
    while (buffer[offset] >= 48 && buffer[offset] <= 57) offset++;
    if (offset === start || offset - start > 7 || buffer[offset++] !== 58) invalid();
    const length = Number(buffer.toString('ascii', start, offset - 1));
    if (offset + length > buffer.length || offset - start > 2 && buffer[start] === 48) invalid();
    const value = buffer.subarray(offset, offset + length);
    offset += length;
    return value;
  }
  function value(depth) {
    if (depth > 64) invalid();
    if (buffer[offset] >= 48 && buffer[offset] <= 57) return byteString();
    if (buffer[offset] === 105) {
      const start = ++offset;
      if (buffer[offset] === 45) offset++;
      while (buffer[offset] >= 48 && buffer[offset] <= 57) offset++;
      if (offset - start > 24 || buffer[offset++] !== 101 || !/^(?:0|-?[1-9]\d*)$/.test(buffer.toString('ascii', start, offset - 1))) invalid();
      return undefined;
    }
    if (buffer[offset] === 100) return dictionary(depth + 1);
    if (buffer[offset++] !== 108) invalid();
    while (buffer[offset] !== 101) value(depth + 1);
    offset++;
    return undefined;
  }
  function dictionary(depth, field) {
    if (buffer[offset++] !== 100) invalid();
    let previous;
    while (buffer[offset] !== 101) {
      const key = byteString(), start = offset;
      if (previous && Buffer.compare(previous, key) >= 0) invalid();
      previous = key;
      if (field) field(key.toString('latin1'), start);
      else value(depth);
    }
    offset++;
  }
  let hash;
  dictionary(0, (key, start) => {
    if (key !== 'info') { value(1); return; }
    let pieces, hasFiles = false, hasLength = false;
    dictionary(1, info => {
      const type = buffer[offset];
      const field = value(2);
      if (info === 'pieces') pieces = field;
      if (info === 'files') hasFiles = type === 108;
      if (info === 'length') hasLength = type === 105;
    });
    if (!Buffer.isBuffer(pieces) || !pieces.length || pieces.length % 20 !== 0 || hasLength === hasFiles) invalid();
    hash = createHash('sha1').update(buffer.subarray(start, offset)).digest('hex');
  });
  if (!hash || offset !== buffer.length) invalid();
  return hash;
}

function createProwlarrCatalog({ config, fetch, json, readBytes }) {
  if (config == null) return null;
  const base = configURL(config.url);
  const key = typeof config.key === 'string' ? config.key.trim() : '';
  const safeKey = /^[!-~]{1,256}$/.test(key);
  const name = 'Prowlarr', headers = { 'X-Api-Key': key };
  const containsKey = value => value.includes(key) || value.includes(encodeURIComponent(key));
  function allowTracker(tracker) {
    try {
      const url = new URL(tracker);
      return !containsKey(tracker) && url.host !== base.host && !url.username && !url.password;
    } catch { return false; }
  }
  async function resolve(proxy, expectedHash) {
    try {
      const response = await fetch(proxy, { headers, redirect: 'manual', signal: AbortSignal.timeout(12000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const magnet = cleanMagnet(response.headers.get('location'), expectedHash, allowTracker);
        if (magnet) return magnet;
        throw new Error();
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      const torrent = await readBytes(response, torrentLimit);
      if (containsKey(torrent.toString('latin1')) || torrent.includes(base.origin + base.pathname)) throw new Error();
      const hash = originalTorrentHash(torrent);
      if (expectedHash && expectedHash !== hash) throw new Error();
      return { hash, torrent };
    } catch {
      throw new Error('Prowlarr could not provide usable torrent metadata for this release. Try a different release.');
    }
  }

  return {
    name, search: true, additional: true, kinds: Object.keys(categories),
    async list(kind, query) {
      if (!base || !safeKey) throw new Error('Prowlarr configuration is invalid.');
      const url = new URL('api/v1/search', base);
      url.search = new URLSearchParams({ indexerIds: '-2', limit, type: 'search' });
      if (query) url.searchParams.set('query', query);
      for (const category of categories[kind]) url.searchParams.append('categories', category);
      const data = await json(await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(12000) }));
      if (!Array.isArray(data)) throw new Error('Prowlarr returned an invalid catalog.');
      return data.slice(0, limit).flatMap(item => {
        if (![2, '2', 'torrent'].includes(typeof item?.protocol === 'string' ? item.protocol.toLowerCase() : item?.protocol)) return [];
        if (typeof item.title !== 'string' || containsKey(item.title) || /(?:https?|magnet):/i.test(item.title)) return [];
        const categoryIds = Array.isArray(item.categories) ? item.categories.map(category => Number(category?.id)) : [];
        if (kind === 'show' && categoryIds.includes(5070)) return [];
        const expectedHash = canonicalHash(item.infoHash);
        const magnet = cleanMagnet(item.magnetUrl, expectedHash, allowTracker) || cleanMagnet(item.downloadUrl, expectedHash, allowTracker);
        const urls = [item.magnetUrl, item.downloadUrl].map(value => proxyURL(value, base, item.indexerId)).filter(Boolean);
        if (!magnet && !urls.length) return [];
        const hash = expectedHash || magnet?.hash || null;
        const indexer = typeof item.indexer === 'string' && !containsKey(item.indexer) && !/[:/?#@]/.test(item.indexer) ? item.indexer.trim().slice(0, 70) : '';
        const identity = typeof item.guid === 'string' && item.guid.length > 0 && item.guid.length <= 2500 ? `${item.indexerId}:${item.guid}` : urls[0]?.href;
        const proxies = urls.map(proxy => ({ identity: proxy.href, resolve: () => resolve(proxy, hash) }));
        return {
          hash, magnet: magnet?.magnet, identity, proxies,
          releaseTitle: item.title, provider: indexer || name, sizeBytes: item.size, seeds: item.seeders, peers: item.leechers,
          tmdbId: item.tmdbId, imdbId: item.imdbId, movie: categoryIds.some(id => id >= 2000 && id < 3000)
        };
      });
    }
  };
}

module.exports = { createProwlarrCatalog };

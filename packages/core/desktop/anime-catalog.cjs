const { canonicalHash, cleanMagnet } = require('./release-discovery.cjs');

function field(item, tag) {
  // Nyaa's feed escapes text and puts HTML only in the unused description CDATA.
  const value = item.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] || '';
  return value.trim().replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
    const names = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (names[entity]) return names[entity];
    const hex = entity.startsWith('&#x');
    const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
  });
}

function createAnimeCatalog({ request, body, url = 'https://nyaa.si/' }) {
  return {
    name: 'Nyaa',
    kinds: ['anime'],
    search: true,
    async list(kind, query) {
      const endpoint = new URL(url);
      endpoint.search = new URLSearchParams({ page: 'rss', m: '1', c: '1_0' });
      if (query) endpoint.searchParams.set('q', query);
      const response = await request(endpoint, { headers: { Accept: 'application/rss+xml, application/xml', 'User-Agent': 'Matro' } });
      if (!response.ok) throw new Error('Nyaa returned an HTTP error.');
      const xml = await body(response);
      if (!/^\s*(?:<\?xml[^?]*\?>\s*)?<rss\s/i.test(xml) || !/<\/channel>\s*<\/rss>\s*$/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Nyaa returned an invalid RSS feed.');
      const releases = [];
      for (const match of xml.matchAll(/<item>\s*([\s\S]*?)<\/item>/g)) {
        if (releases.length >= 100) break;
        const item = match[1];
        if (!['1_2', '1_3', '1_4'].includes(field(item, 'nyaa:categoryId'))) continue;
        const hash = canonicalHash(field(item, 'nyaa:infoHash'));
        const magnet = cleanMagnet(field(item, 'link'), hash);
        if (!hash && !magnet) continue;
        releases.push({ hash: hash || magnet.hash, magnet: magnet?.magnet, provider: 'Nyaa', releaseTitle: field(item, 'title'), size: field(item, 'nyaa:size'), seeds: field(item, 'nyaa:seeders'), peers: field(item, 'nyaa:leechers') });
      }
      return releases;
    }
  };
}

module.exports = { createAnimeCatalog };

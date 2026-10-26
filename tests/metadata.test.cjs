const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readEnv, credentials, createMetadata, cleanQuery, yearOf } = require('../electron/metadata.cjs');

test('file and folder names become clean TMDB queries', () => {
  assert.equal(cleanQuery('The.Brutalist.2024.2160p.WEB-DL.x265'), 'The Brutalist');
  assert.equal(cleanQuery('Akira (1988)'), 'Akira');
  assert.equal(cleanQuery('Cyberpunk Edgerunners'), 'Cyberpunk Edgerunners');
  assert.equal(yearOf('Akira (1988)'), '1988');
  assert.equal(yearOf('Blade.Runner.2049.2017.1080p'), '2017');
  assert.equal(cleanQuery('Blade.Runner.2049.2017.1080p'), 'Blade Runner 2049');
  assert.equal(cleanQuery('Blade Runner 2049'), 'Blade Runner 2049');
  assert.equal(cleanQuery('2001 A Space Odyssey (1968)'), '2001 A Space Odyssey');
  assert.equal(yearOf('Northbound'), null);
});

test('credentials come from .env files and both naming styles', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-env-'));
  await fs.writeFile(path.join(dir, '.env'), '# comment\nVITE_TMDB_ACCESS_TOKEN="token-value"\nOTHER=1\n');
  const env = readEnv([path.join(dir, '.env'), path.join(dir, 'missing.env')]);
  assert.deepEqual(credentials(env), { token: 'token-value', key: '' });
  assert.equal(credentials({}), null);
  assert.deepEqual(credentials({ TMDB_API_KEY: 'k' }), { token: '', key: 'k' });
});

test('titles are matched once, cached, and artwork is stored locally', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-meta-'));
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const json = body => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(4) });
    if (url.startsWith('https://image.tmdb.org/')) return json(null);
    if (url.includes('/search/movie') && url.includes('query=home')) return json({ results: [{ id: 5, title: 'Video Home System', release_date: '2018-01-01' }] });
    if (url.includes('/search/movie')) return json({ results: [{ id: 7, title: 'Akira Kurosawa’s Dreams', release_date: '1990-05-10' }, { id: 149, title: 'Akira', release_date: '1988-07-16' }] });
    if (url.includes('/movie/149')) return json({ id: 149, title: 'Akira', release_date: '1988-07-16', genres: [{ name: 'Animation' }], credits: { crew: [{ job: 'Director', name: 'Katsuhiro Otomo' }], cast: [] }, vote_average: 7.94, vote_count: 4000, poster_path: '/p.jpg', backdrop_path: null });
    if (url.includes('/search/tv')) return json({ results: [] });
    return { ok: false, status: 500 };
  };
  let updates = 0;
  const metadata = createMetadata({ dir, fetch, auth: { token: 't', key: '' }, onUpdate: () => updates++ });
  const items = [{ id: 'a', kind: 'movie', group: 'Akira (1988)', path: 'D:/Movies/Akira (1988).mkv', season: null }, { id: 'b', kind: 'show', group: 'Nowhere Show', groupId: 'g', path: 'D:/Shows/x.mkv', season: 1 }, { id: 'h', kind: 'movie', group: 'home_video_2019_final', path: 'D:/Movies/home_video_2019_final.mkv', season: null }];
  await metadata.sync(items);
  await new Promise(resolve => setTimeout(resolve, 900));
  const snapshot = metadata.snapshot();
  assert.equal(snapshot.a.title, 'Akira');
  assert.equal(snapshot.a.year, '1988');
  assert.deepEqual(snapshot.a.people, ['Katsuhiro Otomo']);
  assert.equal(snapshot.a.rating, 7.9);
  assert.equal(snapshot.a.poster, 'artwork/movie-149-poster.jpg');
  assert.equal(snapshot.g, undefined);
  assert.equal(snapshot.h, undefined, 'a loosely similar title is not accepted');
  assert.ok(calls.some(url => url.includes('year=1988')));
  assert.ok(updates >= 1);
  await fs.access(path.join(dir, 'artwork', 'movie-149-poster.jpg'));
  assert.equal(metadata.artworkFile('../library.json'), null);
  const before = calls.length; await metadata.sync(items); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls.length, before, 'matched and missing titles are not looked up again');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { episodeGaps } = require('../packages/core/episode-schedule.cjs');

test('episode gaps list dated episodes the library lacks, newest missing first then soonest upcoming', () => {
  const episodes = [
    { season: 1, episode: 1, title: 'Owned', airDate: '2020-01-01' },
    { season: 1, episode: 2, title: 'Missing older', airDate: '2020-01-08' },
    { season: 1, episode: 3, title: 'Missing newer', airDate: '2020-01-15' },
    { season: 1, episode: 5, title: 'Later', airDate: '2020-03-01' },
    { season: 1, episode: 4, title: 'Soon', airDate: '2020-02-01' },
    { season: 1, episode: 6, title: 'Undated', airDate: '' },
  ];
  const gaps = episodeGaps(episodes, [{ season: 1, episode: 1 }], '2020-01-20');
  assert.deepEqual(gaps.map(g => [g.episode, g.status]), [[3, 'missing'], [2, 'missing'], [4, 'upcoming'], [5, 'upcoming']]);
});

test('compound episode names cover the listed episodes and every episode in a range', () => {
  const episodes = [1, 2, 3, 4, 5, 6, 7].map(episode => ({ season: 1, episode, airDate: '2020-01-01' }));
  const owned = [
    { season: 1, episode: 1, path: 'C:/Shows/Series.S01E01E02.mkv' },
    { season: 1, episode: 4, path: '/shows/Series.S01E04-E06.mkv' },
  ];
  assert.deepEqual(episodeGaps(episodes, owned, '2020-01-20').map(row => row.episode), [3, 7]);
});

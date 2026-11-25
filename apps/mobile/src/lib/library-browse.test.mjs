import test from 'node:test';
import assert from 'node:assert/strict';
import { browseTitles } from '../../../../packages/core/client/library-browse.js';

test('library sort and filters handle missing metadata and dates on later episodes', () => {
  const groups = [
    [{ id: 'b', title: 'Bravo', added: 1 }, { added: 10 }],
    [{ id: 'a', title: 'Alpha', added: 4 }],
    [{ id: 'c', title: 'Charlie', added: 7, duration: 1800 }],
  ];
  const metadata = new Map([
    ['a', { year: '2022', rating: 8, runtime: 39, genres: ['Drama'] }],
    ['b', { year: '2025', rating: 7, runtime: 40, genres: ['Drama'] }],
  ]);
  const browse = options => browseTitles(groups, options, item => metadata.get(item.id), item => item.title, {}).map(([item]) => item.id);
  assert.deepEqual(browse({ sort: 'title' }), ['a', 'b', 'c']);
  assert.deepEqual(browse({ sort: 'added' }), ['b', 'c', 'a']);
  assert.deepEqual(browse({ sort: 'year' }), ['b', 'a', 'c']);
  assert.deepEqual(browse({ sort: 'rating' }), ['a', 'b', 'c']);
  assert.deepEqual(browse({ genre: 'Drama', short: true }), ['a']);
  assert.deepEqual(browse({ short: true }), ['a', 'c']);
});

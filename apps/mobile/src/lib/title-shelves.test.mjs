import test from 'node:test';
import assert from 'node:assert/strict';
import { titleShelves } from '../../../../packages/core/client/title-shelves.js';

const movie = (id, collection) => [{ id, kind: 'movie', collection }];
test('lists become shelves and TMDB collections need two titles', () => {
  const groups = [movie('a', { id: 1, name: 'Saga' }), movie('b', { id: 1, name: 'Saga' }), movie('c', { id: 2, name: 'Solo' })];
  const shelves = titleShelves(groups, [{ id: 'watch-later', name: 'Watch Later', titles: ['c', 'gone'] }, { id: 'x', name: 'Empty', titles: [] }],
    item => item.id, item => ({ collection: item.collection }));
  assert.deepEqual(shelves.map(shelf => [shelf.id, shelf.groups.length]), [['watch-later', 1], ['tmdb-1', 2]]);
});

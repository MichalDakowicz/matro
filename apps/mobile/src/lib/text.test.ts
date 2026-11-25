import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEpisodeName, plural, rememberQuery, titleMeta } from './text.ts';

test('counts are pluralised', () => {
  assert.equal(plural(1, 'season'), '1 season');
  assert.equal(plural(2, 'season'), '2 seasons');
  assert.equal(plural(0, 'show'), '0 shows');
  assert.equal(plural(1, 'copy', 'copies'), '1 copy');
});
test('episode names lose the show name and the code', () => {
  assert.equal(cleanEpisodeName('Lighthouse Keepers S01E01 Arrival', 'Lighthouse Keepers', 1), 'Arrival');
  assert.equal(cleanEpisodeName('Lighthouse.Keepers.S01E02.Low.Tide', 'Lighthouse Keepers', 2), 'Low.Tide');
  assert.equal(cleanEpisodeName('S01E03', 'Lighthouse Keepers', 3), 'Episode 3');
  assert.equal(cleanEpisodeName('The Long Thaw', 'Northbound', 3), 'The Long Thaw');
  assert.equal(cleanEpisodeName('', 'Northbound', 3), 'Episode 3');
});
test('card meta is a year for movies and a size for shows', () => {
  assert.equal(titleMeta('movie', 2021, 0, 1), '2021');
  assert.equal(titleMeta('movie', undefined, 0, 1), '');
  assert.equal(titleMeta('show', 2021, 1, 6), '1 season · 6 eps');
  assert.equal(titleMeta('show', 2021, 2, 18), '2 seasons · 18 eps');
});
test('recent searches keep the newest first and drop repeats', () => {
  assert.deepEqual(rememberQuery([], ' harbour '), ['harbour']);
  assert.deepEqual(rememberQuery(['harbour', 'varna'], 'Harbour'), ['Harbour', 'varna']);
  assert.deepEqual(rememberQuery(['a1', 'b1'], 'x'), ['a1', 'b1']);
  assert.equal(rememberQuery(['1', '2', '3'], 'new one', 3).length, 3);
});

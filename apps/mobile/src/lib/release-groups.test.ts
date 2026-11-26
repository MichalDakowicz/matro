import test from 'node:test';
import assert from 'node:assert/strict';
import { groupReleases, seedText, type DiscoveryRelease } from './release-groups.ts';

const release = (over: Partial<DiscoveryRelease>): DiscoveryRelease => ({ hash: null, title: 'Dune', year: 2021, downloadKind: 'movie', quality: '1080p', size: '2 GB', ...over });

test('releases of one title share a group, most seeded first', () => {
  const groups = groupReleases([release({ hash: 'a', seeds: 3, selectionId: 'x' }), release({ hash: 'b', seeds: 40, selectionId: 'y' }), release({ hash: 'c', title: 'Heat', year: 1995, seeds: 5, selectionId: 'z' })]);
  assert.deepEqual(groups.map(group => [group.title, group.releases.map(item => item.hash)]), [['Dune', ['b', 'a']], ['Heat', ['c']]]);
});
test('titles with different catalog ids stay apart, and known or repeated hashes are dropped', () => {
  const groups = groupReleases([release({ hash: 'a', tmdbId: 1, seeds: 9 }), release({ hash: 'b', tmdbId: 2, seeds: 8 }), release({ hash: 'a', tmdbId: 1 }), release({ hash: 'k', tmdbId: 1 })], ['k']);
  assert.deepEqual(groups.map(group => group.releases.map(item => item.hash)), [['a'], ['b']]);
});
test('seed counts read naturally', () => {
  assert.equal(seedText(1), '1 seed');
  assert.equal(seedText(0), '0 seeds');
  assert.equal(seedText(null), 'Seeds unknown');
});

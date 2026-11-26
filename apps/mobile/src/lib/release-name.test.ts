import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseName, transferLabel } from './release-name.ts';

test('site prefix, year and codec noise are stripped', () => {
  assert.deepEqual(releaseName('www.UIndex.org    -    Ghost in the Shell 1995 BluRay 1080p DDP 5 1 x264-hallowed'), { title: 'Ghost in the Shell (1995)', detail: '1080p · BluRay' });
});
test('dotted scene names read as words', () => {
  assert.deepEqual(releaseName('Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.H.265-GRP'), { title: 'Dune Part Two (2024)', detail: '2160p · WEB-DL' });
});
test('episodes keep their title', () => {
  assert.equal(releaseName('[SubsPlease] Frieren - 12 (1080p) [ABCD1234].mkv').title, 'Frieren - 12');
  assert.equal(releaseName('Severance S02E03 720p WEB').title, 'Severance');
});
test('a name with no markers is returned as is', () => {
  assert.deepEqual(releaseName('Holiday Video'), { title: 'Holiday Video', detail: '' });
  assert.equal(releaseName('2012').title, '2012');
});
test('qBittorrent states read as plain words', () => {
  assert.equal(transferLabel('stalledDL'), 'Waiting for sources');
  assert.equal(transferLabel('stalledUP'), 'Seeding');
  assert.equal(transferLabel('missingFiles'), 'Needs attention');
  assert.equal(transferLabel('pausedDL'), 'Paused');
});

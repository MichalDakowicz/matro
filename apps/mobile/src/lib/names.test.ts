import test from 'node:test';
import assert from 'node:assert/strict';
import { alternateTitles, SUBTITLE_TYPES, subtitleName } from './names.ts';

test('a subtitle file name becomes a readable label', () => {
  assert.equal(subtitleName('Dune.2021.English_HI.srt'), 'Dune 2021 English HI');
  assert.equal(subtitleName('x'.repeat(80) + '.vtt').length, 60);
});
test('only subtitle formats the server reads are accepted', () => {
  assert.ok(['a.srt', 'a.VTT', 'a.ass', 'a.ssa'].every(name => SUBTITLE_TYPES.test(name)));
  assert.ok(!['a.txt', 'a.srt.exe', 'srt'].some(name => SUBTITLE_TYPES.test(name)));
});
test('alternate titles skip the one already searched and repeats', () => {
  const metadata = { originalTitle: 'Shingeki no Kyojin', title: 'Attack on Titan', aliases: ['AoT', 'attack on titan', 'Shingeki no Kyojin'] };
  assert.deepEqual(alternateTitles(metadata, 'attack on titan'), ['Shingeki no Kyojin', 'AoT']);
  assert.deepEqual(alternateTitles(null, 'x'), []);
});

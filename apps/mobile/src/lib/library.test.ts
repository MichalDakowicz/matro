import test from 'node:test';
import assert from 'node:assert/strict';
import { continueItems, groupLibrary, matchTrack, metadataFor, resumeItem, trackKey } from '../../../../packages/core/client/library.ts';
import { parseVtt } from '../../../../packages/core/client/subtitles.ts';
import type { Item, Library } from '../../../../packages/core/client/server.ts';
const episode = (id: string, number: number): Item => ({ id, title: id, groupId: 'show', group: 'Show', kind: 'show', season: 1, episode: number, format: 'MKV' });
const blank = (items: Item[]): Library => ({ user: { id: 1, username: 'viewer', role: 'viewer' }, items, progress: {}, queue: [], preferences: {}, metadata: {} });

test('native shelves use the same show grouping, movie editions and metadata keys as the web', () => {
  const first = episode('one', 1), second = episode('two', 2), movie = { ...first, id: 'movie-a', kind: 'movie', groupId: 'film' }, edition = { ...movie, id: 'movie-b' };
  const data = blank([second, first, movie, edition]); data.metadata.show = { title: 'The show' };
  const groups = groupLibrary(data.items);
  assert.equal(groups.length, 3); assert.deepEqual(groups[0].map(i => i.id), ['one', 'two']);
  assert.equal(metadataFor(data, second).title, 'The show'); assert.equal(trackKey(movie), trackKey(edition));
});
test('continue watching advances a completed episode and preserves a dismissed show', () => {
  const one = episode('one', 1), two = episode('two', 2), data = blank([one, two]);
  data.progress.one = { position: 99, duration: 100, completed: true, updated: 1 };
  assert.equal(continueItems(data, groupLibrary(data.items))[0].id, 'two');
  assert.equal(resumeItem(data, data.items).id, 'two');
  data.progress.one.hidden = true; assert.equal(continueItems(data, groupLibrary(data.items)).length, 0);
});
test('track preferences follow language/title across episode stream-index changes', () => {
  const tracks = [{ index: 2, title: 'Original mix', language: 'en', codec: 'aac', channels: 2 }, { index: 5, title: 'Dub', language: 'pl', codec: 'aac', channels: 2 }];
  assert.equal(matchTrack(tracks, { language: 'pl', title: 'Dub', codec: 'aac', channels: 2 })?.index, 5);
});
test('native subtitle parsing retains timing and line breaks without rendering HTML', () => {
  const cues = parseVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\n<i>Hello</i>\nworld\n\n00:03.000 --> 00:04.000\nNext');
  assert.deepEqual(cues, [{ start: 1, end: 2.5, text: 'Hello\nworld' }, { start: 3, end: 4, text: 'Next' }]);
});

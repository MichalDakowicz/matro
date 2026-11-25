import test from 'node:test';
import assert from 'node:assert/strict';
import { continueItems, groupLibrary, matchTrack, metadataFor, resumeItem, savedServes, trackKey } from '../../../../packages/core/client/library.ts';
import { parseVtt } from '../../../../packages/core/client/subtitles.ts';
import { randomReelStart } from '../../../../packages/core/client/reel-start.js';
import type { Item, Library } from '../../../../packages/core/client/server.ts';
const episode = (id: string, number: number): Item => ({ id, title: id, groupId: 'show', group: 'Show', kind: 'show', season: 1, episode: number, format: 'MKV' });
const blank = (items: Item[]): Library => ({ user: { id: 1, username: 'viewer', role: 'viewer' }, items, progress: {}, queue: [], preferences: {}, metadata: {} });

test('featured reel picks from every title except its previous start', () => {
  const titles = ['one', 'two', 'three'];
  assert.equal(randomReelStart([], null), 0);
  assert.equal(randomReelStart(['one'], 'one'), 0);
  assert.equal(randomReelStart(titles, 'removed', () => .99), 2);
  assert.equal(randomReelStart(titles, 'two', () => 0), 0);
  assert.equal(randomReelStart(titles, 'two', () => .99), 2);
  assert.equal(randomReelStart(['one', 'two'], 'one'), 1);
  assert.equal(randomReelStart(['two', 'one'], 'one'), 0);
});

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
test('continue watching and title playback cross seasons and return to a skipped episode', () => {
  const skipped = episode('skipped', 1), last = episode('last', 2), next = { ...episode('next', 1), season: 2 };
  const data = blank([next, last, skipped]), groups = groupLibrary(data.items);
  const assertTarget = (target: Item) => {
    assert.deepEqual(continueItems(data, groups), [target]);
    assert.equal(resumeItem(data, groups[0]), target);
  };

  data.progress.last = { position: 98, duration: 100, updated: 1 };
  data.progress.skipped = { position: 0, duration: 0, completed: false, updated: 2 };
  assertTarget(next);

  data.progress.next = { position: 0, duration: 0, completed: true, updated: 3 };
  assertTarget(skipped);

  data.progress.last = { position: 98, duration: 100, completed: false, updated: 4 };
  assertTarget(last);

  data.progress.last.completed = true;
  data.progress.skipped.completed = true;
  assert.deepEqual(continueItems(data, groups), []);
});
test('undated completions advance from the furthest episode and dismissed titles resume the latest partial', () => {
  const items = [episode('one', 1), episode('two', 2), episode('three', 3), episode('four', 4)];
  const data = blank(items), groups = groupLibrary(items);
  data.progress.one = { position: 100, duration: 100, completed: true, updated: 0 };
  data.progress.three = { position: 100, duration: 100, completed: true, updated: 0 };
  assert.equal(continueItems(data, groups)[0].id, 'four');

  data.progress.one.hidden = true;
  data.progress.three.hidden = true;
  data.progress.two = { position: 25, duration: 100, hidden: true, updated: 10 };
  data.progress.four = { position: 50, duration: 100, hidden: true, updated: 20 };
  assert.deepEqual(continueItems(data, groups), []);
  assert.equal(resumeItem(data, items).id, 'four');
});
test('track preferences follow language/title across episode stream-index changes', () => {
  const tracks = [{ index: 2, title: 'Original mix', language: 'en', codec: 'aac', channels: 2 }, { index: 5, title: 'Dub', language: 'pl', codec: 'aac', channels: 2 }];
  assert.equal(matchTrack(tracks, { language: 'pl', title: 'Dub', codec: 'aac', channels: 2 })?.index, 5);
});
test('native subtitle parsing retains timing and line breaks without rendering HTML', () => {
  const cues = parseVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\n<i>Hello</i>\nworld\n\n00:03.000 --> 00:04.000\nNext');
  assert.deepEqual(cues, [{ start: 1, end: 2.5, text: 'Hello\nworld' }, { start: 3, end: 4, text: 'Next' }]);
});

test('a saved copy serves online playback only when its single audio track and text subtitles cover the choice', () => {
  const track = (index: number, language: string, extra = {}) => ({ index, language, title: '', ...extra });
  const full = { duration: 5, directPlay: true, audio: [track(1, 'jpn'), track(2, 'eng')], embedded: [track(3, 'eng', { text: true }), track(4, 'eng', { bitmap: true })], uploaded: [] };
  const saved = { ...full, audio: [full.audio[0]], embedded: [full.embedded[0]] };
  assert.equal(savedServes(saved, full), true);
  assert.equal(savedServes(saved, full, { audio: { language: 'jpn', title: '' }, subtitle: { language: 'eng', title: '' } }), true);
  assert.equal(savedServes(saved, full, { audio: { language: 'eng', title: '' } }), false);
  assert.equal(savedServes(saved, { ...full, embedded: [full.embedded[1]] }, { subtitle: { language: 'eng', title: '' } }), false);
});

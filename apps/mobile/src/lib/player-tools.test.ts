import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoSkip } from '../../../../packages/core/client/auto-skip.js';
import { chapterIndex, framePath, seasonCopies, showCreditsNext, sleepMinutes, tapZone } from '../player/playerTools.ts';
import { defaultSubtitleStyle, parseSubtitleStyle, subtitleTextStyle } from '../player/subtitleStyle.ts';

const intro = { type: 'intro' as const, start: 10, end: 40, source: 'manual' as const };
const outro = { type: 'outro' as const, start: 160, end: 200, source: 'automatic' as const };

test('taps in the outer thirds seek and the middle toggles the controls', () => {
  assert.equal(tapZone(40, 400), 'left');
  assert.equal(tapZone(200, 400), 'center');
  assert.equal(tapZone(360, 400), 'right');
  assert.equal(tapZone(10, 0), 'center');
});

test('seek frames are snapped to five-second buckets and the id is escaped', () => {
  assert.equal(framePath('a b', 12.9), '/api/items/a%20b/frame?t=10&w=320');
  assert.equal(framePath('x', -4, 480), '/api/items/x/frame?t=0&w=480');
});

test('the current chapter is the last one that has started', () => {
  const chapters = [{ start: 0, title: 'A' }, { start: 60, title: 'B' }, { start: 120, title: 'C' }];
  assert.equal(chapterIndex(chapters, 0), 0);
  assert.equal(chapterIndex(chapters, 59.9), 1);
  assert.equal(chapterIndex(chapters, 130), 2);
  assert.equal(chapterIndex(undefined, 5), -1);
});

test('auto-skip jumps past intros and recaps but never outros, and never backwards', () => {
  const autoSkip = createAutoSkip();
  assert.equal(autoSkip.target([intro, outro], 12, 200), 40);
  assert.equal(autoSkip.target([intro, outro], 170, 200), null);
  assert.equal(autoSkip.target([intro], 40, 200), null);
  assert.equal(autoSkip.target([{ ...intro, end: 500 }], 12, 200), 199.9);
  assert.equal(autoSkip.target([], 12, 200), null);
});

test('Next episode appears from a valid outro of an episode that has a successor', () => {
  assert.equal(showCreditsNext([outro], 165, 200, true), true);
  assert.equal(showCreditsNext([outro], 165, 200, false), false);
  assert.equal(showCreditsNext([outro], 100, 200, true), false);
  assert.equal(showCreditsNext([{ ...outro, start: 30 }], 100, 200, true), false, 'an early outro is ignored');
});

test('season copies keep openings and keep the outro the same distance from the end', () => {
  const copies = seasonCopies([intro, { ...outro, source: 'manual' }], 200, [{ id: 'b', duration: 150 }, { id: 'c', duration: 30 }]);
  assert.deepEqual(copies[0].markers.map(m => [m.type, m.start, m.end]), [['intro', 10, 40], ['outro', 110, 150]]);
  assert.deepEqual(copies[1].markers.map(m => [m.type, m.start, m.end]), [['intro', 10, 30], ['outro', 0, 30]], 'ranges are cut to a short episode, as the web player does');
  assert.ok(copies.every(copy => copy.markers.every(m => m.source === 'manual')));
});

test('sleep timer modes map to minutes', () => {
  assert.equal(sleepMinutes('30'), 30);
  assert.equal(sleepMinutes('off'), 0);
  assert.equal(sleepMinutes('episode'), 0);
});

test('subtitle style reads the shared preference, falls back to the web defaults and maps to native text style', () => {
  assert.deepEqual(parseSubtitleStyle(undefined), defaultSubtitleStyle);
  assert.deepEqual(parseSubtitleStyle({ font: 'comic', background: 'solid', bold: true, edge: 'laser' }), { ...defaultSubtitleStyle, background: 'solid', bold: true });
  const solid = subtitleTextStyle({ ...defaultSubtitleStyle, background: 'solid', bold: true, edge: 'shadow', font: 'serif' });
  assert.equal(solid.backgroundColor, '#000ff');
  assert.equal(solid.fontWeight, '700');
  assert.equal(solid.fontFamily, 'serif');
  assert.equal(solid.textShadowRadius, 4);
  assert.equal(subtitleTextStyle({ ...defaultSubtitleStyle, background: 'none' }).backgroundColor, 'transparent');
  assert.equal(subtitleTextStyle(defaultSubtitleStyle).textShadowRadius, 0);
  assert.equal(subtitleTextStyle({ ...defaultSubtitleStyle, edge: 'outline' }).textShadowOffset?.width, 0);
});

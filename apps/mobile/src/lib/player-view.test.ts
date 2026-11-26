import test from 'node:test';
import assert from 'node:assert/strict';
import { captionLift, delayLabel, holdDelay, movieFacts, preparingLabel, previewFontSize, runtimeLabel, sizeLabel, speeds, trackName } from '../player/playerView.ts';
import { DOUBLE_TAP_SECONDS } from '../player/playerTools.ts';

const name = (language: string) => ({ eng: 'English' })[language as 'eng'] || language;
test('tracks without a language read "Track N" and named ones keep their language', () => {
  assert.equal(trackName('', 2, name), 'Track 2');
  assert.equal(trackName(undefined, 1, name), 'Track 1');
  assert.equal(trackName('und', 3, name), 'Track 3');
  assert.equal(trackName('eng', 1, name), 'English');
});

test('a movie subtitle is year and runtime, never the container format', () => {
  assert.equal(movieFacts({ year: 2019, runtime: 112, kind: 'movie' }), '2019 · 1h 52m');
  assert.equal(movieFacts({ year: '2019', duration: 5400, kind: 'movie' }), '2019 · 1h 30m');
  assert.equal(movieFacts({ runtime: 45, kind: 'movie' }), '45m');
  assert.equal(movieFacts({ kind: 'movie' }), 'Movie');
  assert.equal(movieFacts({ kind: 'audio' }), 'Audio');
  assert.equal(runtimeLabel(120), '2h 0m');
});

test('a held stepper waits, then repeats faster and never faster than the floor', () => {
  assert.equal(holdDelay(0), 420);
  assert.ok(holdDelay(1) < holdDelay(0) && holdDelay(5) < holdDelay(1));
  assert.equal(holdDelay(500), 45);
});

test('captions rise only as far as the obstacle that covers them', () => {
  assert.equal(captionLift(700, [null, null]), 0);
  assert.equal(captionLift(700, [800, null]), 0);
  assert.equal(captionLift(700, [650, null]), 50);
  assert.equal(captionLift(700, [650, 600]), 100);
  assert.equal(captionLift(700, []), 0);
});

test('readouts and the speed choices', () => {
  assert.equal(delayLabel(0), '+0.0 s');
  assert.equal(delayLabel(-1.25), '−1.3 s');
  assert.equal(sizeLabel(1.05), '105%');
  assert.equal(previewFontSize(1.5), 30);
  assert.equal(preparingLabel('1:12'), 'Preparing playback · 1:12');
  assert.ok(speeds.includes(1) && speeds.every((rate, index) => index === 0 || rate > speeds[index - 1]));
  assert.equal(DOUBLE_TAP_SECONDS, 10);
});

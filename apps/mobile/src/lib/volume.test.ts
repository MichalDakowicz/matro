import test from 'node:test';
import assert from 'node:assert/strict';
import { boostMillibels, clampVolume, isBoosted, volumeLabel } from '../player/volume.ts';

test('saved volumes clamp to the available range', () => {
  assert.equal(clampVolume(.5), .5);
  assert.equal(clampVolume(1.3), 1.3);
  assert.equal(clampVolume(2), 1.5);
  assert.equal(clampVolume(1.3, 1), 1);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(0), 0);
  assert.equal(clampVolume(undefined), .72);
  assert.equal(clampVolume('loud'), .72);
  assert.equal(clampVolume(1.2345), 1.23);
});

test('only volume above 100% becomes boost gain', () => {
  assert.equal(boostMillibels(50), 0);
  assert.equal(boostMillibels(100), 0);
  assert.equal(boostMillibels(120), 158);
  assert.equal(boostMillibels(150), 352);
  assert.equal(boostMillibels(400), 352);
  assert.equal(boostMillibels(Number.NaN), 0);
});

test('boost shows above 100%', () => {
  assert.equal(isBoosted(1), false);
  assert.equal(isBoosted(1.05), true);
  assert.equal(volumeLabel(1.25), '125%');
});

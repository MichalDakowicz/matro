import test from 'node:test';
import assert from 'node:assert/strict';
import { createPictureInPictureLifecycle } from '../player/pictureInPicture.ts';

test('automatic PiP keeps playback across AppState and saves at each transition', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let saved = 0, paused = 0;
  const pip = createPictureInPictureLifecycle(() => saved++, () => paused++);
  pip.appState(false, true);
  assert.equal(paused, 0);
  pip.started();
  context.mock.timers.tick(2000);
  assert.equal(pip.isFloating(), true);
  assert.equal(saved, 2);
  assert.equal(paused, 0);
  pip.stopped();
  pip.appState(true, false);
  context.mock.timers.tick(2000);
  assert.equal(saved, 3);
  assert.equal(paused, 0);
});

test('playback pauses when background PiP fails or is dismissed', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let paused = 0;
  const pip = createPictureInPictureLifecycle(() => {}, () => paused++);
  pip.appState(false, true);
  context.mock.timers.tick(2000);
  assert.equal(paused, 1);
  pip.appState(true, false);
  pip.request();
  pip.appState(false, false);
  assert.equal(paused, 1);
  pip.started();
  pip.stopped();
  context.mock.timers.tick(2000);
  assert.equal(paused, 2);
  pip.appState(true, false);
  pip.request();
  pip.appState(false, false);
  pip.failed();
  assert.equal(paused, 3);
  pip.appState(true, false);
  pip.appState(false, false);
  assert.equal(paused, 4);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { bar, noticeText, parseDownloadMessage } from './downloadNotice.ts';

test('parses the page message and clamps the percentage', () => {
  assert.deepEqual(parseDownloadMessage('dl:{"id":"a","title":"Heat","state":"saving","percent":41.6}'), { id: 'a', title: 'Heat', state: 'saving', percent: 42 });
  assert.equal(parseDownloadMessage('dl:{"id":"a","state":"saving","percent":900}')?.percent, 100);
  assert.equal(parseDownloadMessage('dl:{"id":"a","state":"saving"}')?.title, 'Matro');
});

test('ignores messages that are not downloads or are malformed', () => {
  assert.equal(parseDownloadMessage('logout'), null);
  assert.equal(parseDownloadMessage('dl:{nope'), null);
  assert.equal(parseDownloadMessage('dl:{"id":"a","state":"weird"}'), null);
});

test('progress bar and notification text', () => {
  assert.equal(bar(0), '▱▱▱▱▱▱▱▱▱▱');
  assert.equal(bar(50), '▰▰▰▰▰▱▱▱▱▱');
  assert.deepEqual(noticeText({ id: 'a', title: 'Heat', state: 'saving', percent: 30 }), { title: 'Saving Heat', body: '▰▰▰▱▱▱▱▱▱▱ 30%' });
  assert.match(noticeText({ id: 'a', title: 'Heat', state: 'saved', percent: 100 })!.title, /ready offline/);
  assert.equal(noticeText({ id: 'a', title: 'Heat', state: 'stopped', percent: 10 }), null);
});

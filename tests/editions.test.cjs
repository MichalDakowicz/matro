const test = require('node:test'), assert = require('node:assert/strict');

test('editions of one movie form a single title that resumes the edition being watched', async () => {
  const { groupTitles, resumeTarget } = await import('../packages/core/client/watch-progress.js');
  const cut = { id: 'a', title: 'Film cut', kind: 'movie', group: 'Film', editionGroup: 'g' }, theatrical = { id: 'b', title: 'Film', kind: 'movie', group: 'Film', editionGroup: 'g' };
  const other = { id: 'c', title: 'Other', kind: 'movie', group: 'Other' };
  const groups = groupTitles([cut, theatrical, other]);
  assert.deepEqual(groups.map(group => group.map(item => item.id)), [['a', 'b'], ['c']]);
  assert.equal(resumeTarget([cut, theatrical], {}, theatrical).id, 'b');
  assert.equal(resumeTarget([cut, theatrical], { a: { position: 30, updated: 5 } }, theatrical).id, 'a');
});

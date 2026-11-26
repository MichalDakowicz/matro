const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../packages/core/client/track-preferences.js');
const audio = [{ index: 1, language: 'eng', title: '', default: true }, { index: 2, language: 'pol', title: 'Lektor' }, { index: 3, language: 'pl', title: 'Dubbing', default: true }];
const subs = [
  { index: 4, language: 'pol', title: '', text: true, forced: true },
  { index: 5, language: 'eng', title: 'SDH', text: true },
  { index: 6, language: 'eng', title: '', text: true },
  { index: 7, language: 'eng', title: 'Signs', text: true, forced: true },
  { index: 8, language: 'jpn', title: '', bitmap: true },
  { index: 9, language: 'eng', title: 'junk' }
];
const prefs = trackDefaults => ({ trackDefaults });

test('no defaults keeps the default audio track and no subtitles', async () => {
  const { initialTracks } = await load();
  assert.deepEqual(initialTracks({ audio, subtitles: subs }, undefined, {}), { audio: 1, subtitle: null });
});

test('preferred audio language matches 3-letter and 2-letter codes, preferring the default track', async () => {
  const { initialTracks } = await load();
  assert.equal(initialTracks({ audio, subtitles: [] }, undefined, prefs({ audio: 'pl' })).audio, 3);
  assert.equal(initialTracks({ audio, subtitles: [] }, undefined, prefs({ audio: 'de' })).audio, 1);
});

test('subtitle modes', async () => {
  const { initialTracks } = await load();
  const pick = (trackDefaults, tracks = audio) => initialTracks({ audio: tracks, subtitles: subs }, undefined, prefs(trackDefaults)).subtitle;
  assert.equal(pick({ audio: 'pl', subtitles: 'off', subtitleLanguage: 'en' }), null);
  assert.equal(pick({ audio: 'pl', subtitles: 'forced' }), 4);
  assert.equal(pick({ audio: 'en', subtitles: 'forced' }), 7);
  assert.equal(pick({ audio: 'ja', subtitles: 'forced' }, [{ index: 1, language: 'jpn' }]), null);
  assert.equal(pick({ subtitles: 'always', subtitleLanguage: 'en' }), 6);
  assert.equal(pick({ subtitles: 'always', subtitleLanguage: 'ja' }), 8);
  assert.equal(pick({ subtitles: 'always', subtitleLanguage: 'de' }), null);
  assert.equal(pick({ subtitles: 'always' }), null);
});

test('an explicit choice for the title always wins over the defaults', async () => {
  const { initialTracks } = await load();
  const choice = { audio: { language: 'eng', title: '' }, subtitle: null, off: true };
  assert.deepEqual(initialTracks({ audio, subtitles: subs }, choice, prefs({ audio: 'pl', subtitles: 'always', subtitleLanguage: 'en' })), { audio: 1, subtitle: null });
  const picked = { audio: { language: 'pol', title: 'Lektor' }, subtitle: { language: 'eng', title: 'SDH' } };
  assert.deepEqual(initialTracks({ audio, subtitles: subs }, picked, prefs({ audio: 'en', subtitles: 'off' })), { audio: 2, subtitle: 5 });
});

test('partial remembered choices keep the defaults for untouched tracks', async () => {
  const { initialTracks } = await load();
  const details = { audio, subtitles: subs };
  const preferences = prefs({ audio: 'pl', subtitles: 'always', subtitleLanguage: 'en' });
  assert.deepEqual(initialTracks(details, { delay: 2 }, preferences), { audio: 3, subtitle: 6 });
  assert.deepEqual(initialTracks(details, { audio: { language: 'eng', title: '' } }, preferences), { audio: 1, subtitle: 6 });
  assert.deepEqual(initialTracks(details, { subtitle: null, off: true }, preferences), { audio: 3, subtitle: null });
});

test('bad stored defaults fall back to off', async () => {
  const { trackDefaults } = await load();
  assert.deepEqual(trackDefaults({ trackDefaults: { audio: 5, subtitles: 'x', subtitleLanguage: '!!' } }), { audio: '', subtitles: 'off', subtitleLanguage: '' });
});

test('one rule decides whether a saved copy has the tracks a title opens with', async () => {
  const { savedServes } = await load();
  const full = { audio, subtitles: subs }, saved = { audio: [audio[0]], subtitles: [subs[2]] };
  assert.equal(savedServes(saved, full, undefined, {}), true);
  assert.equal(savedServes(saved, full, undefined, prefs({ subtitles: 'always', subtitleLanguage: 'en' })), true);
  assert.equal(savedServes(saved, full, undefined, prefs({ audio: 'pl' })), false);
  assert.equal(savedServes(saved, full, { subtitle: { language: 'jpn', title: '' } }, {}), false);
  assert.equal(savedServes(saved, full, { audioDelay: .3 }, {}), false);
  assert.equal(savedServes(saved, full, { audioDelay: 0 }, {}), true);
});

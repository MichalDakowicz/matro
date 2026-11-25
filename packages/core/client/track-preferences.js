// Which audio and subtitle track a title opens with. A choice made for that show or film always wins; the account's
// defaults (preferences.trackDefaults) only decide titles nothing has been chosen for yet. Shared by every player.
export const SUBTITLE_MODES = ['off', 'forced', 'always'];
export const LANGUAGES = 'en ja pl de fr es it pt ru uk cs sk hu ro nl sv no da fi el tr he ar zh ko hi th vi id bg hr sr sl lt lv et ca fa'.split(' ');
const TABLE = 'en eng,ja jpn,pl pol,de ger deu,fr fre fra,es spa,it ita,pt por,ru rus,uk ukr,cs cze ces,sk slo slk,hu hun,ro rum ron,nl dut nld,sv swe,no nor nob nno,da dan,fi fin,el gre ell,tr tur,he heb,ar ara,zh chi zho,ko kor,hi hin,th tha,vi vie,id ind,bg bul,hr hrv,sr srp,sl slv,lt lit,lv lav,et est,ca cat,fa per fas'.split(',');
const TO2 = new Map(TABLE.flatMap(row => { const [two, ...threes] = row.split(' '); return [[two, two], ...threes.map(three => [three, two])]; }));
// ffprobe reports 3-letter codes; the server and the settings use 2-letter ones.
export function normalizeLanguage(code) {
  const base = String(code || '').trim().toLowerCase().split(/[-_]/)[0];
  return !/^[a-z]{2,3}$/.test(base) || ['und', 'unk', 'mis', 'zxx'].includes(base) ? 'und' : TO2.get(base) || base;
}
export function trackDefaults(preferences) {
  const value = preferences?.trackDefaults || {}, language = code => { const normal = normalizeLanguage(code); return normal === 'und' ? '' : normal; };
  return { audio: language(value.audio), subtitles: SUBTITLE_MODES.includes(value.subtitles) ? value.subtitles : 'off', subtitleLanguage: language(value.subtitleLanguage) };
}
export function matchTrack(tracks, choice) {
  if (!choice) return null;
  const score = t => Number(t.title === choice.title) * 4 + Number(t.channels === choice.channels) * 2 + Number(t.codec === choice.codec);
  return tracks.filter(t => t.language === choice.language).sort((a, b) => score(b) - score(a))[0] || null;
}
const isForced = t => !!t.forced || /\bforced\b/i.test(t.title || '');
const isSdh = t => !!t.sdh || /\b(sdh|hi|captions?)\b/i.test(t.title || '');
const inLanguage = (tracks, language) => language ? tracks.filter(t => normalizeLanguage(t.language) === language) : [];
// The preferred audio language, the default or the first track. `defaults` is the result of trackDefaults().
export function pickAudio(tracks, defaults) {
  const wanted = inLanguage(tracks, defaults.audio);
  return (wanted.find(t => t.default) || wanted[0] || tracks.find(t => t.default) || tracks[0])?.index ?? null;
}
// off: nothing. forced: only forced tracks, in the audio's language (or the subtitle language). always: a full track in
// the subtitle language, preferring plain over SDH, then forced.
export function pickSubtitle(tracks, audioTrack, defaults) {
  const usable = tracks.filter(t => t.text || t.bitmap);
  if (defaults.subtitles === 'forced') {
    const forced = usable.filter(isForced);
    return (inLanguage(forced, normalizeLanguage(audioTrack?.language))[0] || inLanguage(forced, defaults.subtitleLanguage)[0])?.index ?? null;
  }
  if (defaults.subtitles !== 'always') return null;
  const wanted = inLanguage(usable, defaults.subtitleLanguage);
  return (wanted.find(t => !isForced(t) && !isSdh(t)) || wanted.find(t => !isForced(t)) || wanted[0])?.index ?? null;
}
// details: { audio, subtitles }. choice: this title's saved choice (undefined if none).
export function initialTracks({ audio, subtitles }, choice, preferences) {
  if (choice) return {
    audio: matchTrack(audio, choice.audio)?.index ?? audio.find(t => t.default)?.index ?? audio[0]?.index ?? null,
    subtitle: choice.off ? null : matchTrack(subtitles.filter(t => t.text || t.bitmap), choice.subtitle)?.index ?? null
  };
  const defaults = trackDefaults(preferences), chosen = pickAudio(audio, defaults);
  return { audio: chosen, subtitle: pickSubtitle(subtitles, audio.find(t => t.index === chosen), defaults) };
}

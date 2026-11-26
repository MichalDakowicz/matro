// The languages the web profile offers for subtitles and TMDB metadata (packages/browser-ui and apps/web/web/dom.js keep the same list).
export const LANGUAGES: [code: string, name: string][] = [
  ['en', 'English'], ['pl', 'Polish'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['zh', 'Chinese'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['cs', 'Czech'], ['sk', 'Slovak'], ['hu', 'Hungarian'], ['ro', 'Romanian'],
  ['nl', 'Dutch'], ['sv', 'Swedish'], ['no', 'Norwegian'], ['da', 'Danish'], ['fi', 'Finnish'], ['el', 'Greek'], ['tr', 'Turkish'], ['he', 'Hebrew'],
  ['ar', 'Arabic'], ['hi', 'Hindi'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['id', 'Indonesian'], ['bg', 'Bulgarian'], ['hr', 'Croatian'], ['sr', 'Serbian'],
  ['sl', 'Slovenian'], ['lt', 'Lithuanian'], ['lv', 'Latvian'], ['et', 'Estonian'], ['ca', 'Catalan'], ['fa', 'Persian'],
];
export const languageName = (code: string) => LANGUAGES.find(([value]) => value === code)?.[1] || (code === 'und' ? 'Unknown' : code);

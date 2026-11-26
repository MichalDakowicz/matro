// Matro palettes (packages/browser-ui/styles.css :root and [data-theme=light]). Kept free of font/asset imports so node tests can read it.
export type Scheme = 'dark' | 'light';
export type ThemeChoice = 'system' | Scheme;

// `ink` washes: white at low alpha on dark, warm black on light (the web's --ink / --line).
const dark = {
  hairlineStrong: '#ffffff24',
  chipSelected: '#f3f1ec',
  onChipSelected: '#0a0a0b',
  fill: '#ffffff0a',
  glassStrong: '#1a1a1cd9',
  dock: '#1c1c1ff2',
  veil: '#0a0a0b99',
  shade: '#000000e8',
  fade: '#0a0a0bf2',
  clear: '#0a0a0b00',
  sheenHigh: '#ffffff1f',
  sheenLow: '#00000026',
  ground: '#0a0a0b',
  panel: '#161618',
  text: '#ece9e4',
  soft: '#bebab3',
  muted: '#a9a59d',
  dim: '#8f8c87',
  hairline: '#ffffff14',
  fieldBorder: '#ece9e438',
  inputFill: '#1a1a1cb3',
  placeholder: '#6f6c68',
  primary: '#f3f1ec',
  onPrimary: '#0a0a0b',
  warn: '#e3a58b',
  good: '#9fd6b0',
  wash: '#ffffff05',
  tint: '#ffffff0d',
  chip: '#ffffff18',
  active: '#ffffff1f',
  outline: '#ffffff24',
  outlineStrong: '#ffffff33',
  glass: '#1a1a1c99',
  glassSolid: '#171719f5',
  scrim: '#0009',
  shadow: '#0006',
  track: '#ffffff30',
};
export type Palette = { [K in keyof typeof dark]: string };
const light: Palette = {
  hairlineStrong: '#00000026',
  chipSelected: '#17171a',
  onChipSelected: '#f6f4ef',
  fill: '#00000008',
  glassStrong: '#fffffff5',
  dock: '#fefdfaf2',
  veil: '#00000055',
  shade: '#000000e8',
  fade: '#f4f2eef2',
  clear: '#f4f2ee00',
  sheenHigh: '#ffffff1f',
  sheenLow: '#00000026',
  ground: '#f4f2ee',
  panel: '#ffffff',
  text: '#1b1a18',
  soft: '#4a4741',
  muted: '#5e5a53',
  dim: '#6b675f',
  hairline: '#0000001a',
  fieldBorder: '#1b1a1840',
  inputFill: '#ffffffd9',
  placeholder: '#9a958c',
  primary: '#17171a',
  onPrimary: '#f6f4ef',
  warn: '#b4572f',
  good: '#2f7a4a',
  wash: '#00000008',
  tint: '#0000000d',
  chip: '#00000014',
  active: '#0000001a',
  outline: '#00000026',
  outlineStrong: '#00000033',
  glass: '#ffffffb3',
  glassSolid: '#fffffff5',
  scrim: '#0006',
  shadow: '#0002',
  track: '#00000026',
};
export const palettes: Record<Scheme, Palette> = { dark, light };

export const overArt = { text: '#f3f1ec', dim: '#d6d2ca', shade: '#000a', shadeDeep: '#000000e8', card: '#15151999', cardDeep: '#0a0a0bf5', chrome: '#171719aa', chip: '#0a0a0b99', badge: '#0a0a0ba0', still: '#ffffff59', rule: '#ffffff33', warn: '#e3a58b', sheen: ['#0a0a0b4d', '#0a0a0b8c'] as const, cover: ['#252328', '#15151b', '#29252a'] as const } as const;

/** "System" follows the phone; an unknown system scheme falls back to dark, the app's original look. */
export const resolveScheme = (choice: ThemeChoice, system: string | null | undefined): Scheme =>
  choice === 'system' ? (system === 'light' ? 'light' : 'dark') : choice;

/** The tree remounts to re-theme, but never while the player is up: a System flip (scheduled dark mode) waits until it closes. */
export const needsRemount = (shown: Scheme, wanted: Scheme, playerUp: boolean) => shown !== wanted && !playerUp;

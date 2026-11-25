import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { needsRemount, palettes, resolveScheme } from '../palette.ts';

const src = join(import.meta.dirname, '..');
const css = readFileSync(join(src, '../../../packages/browser-ui/styles.css'), 'utf8');
const lightBlock = css.match(/\[data-theme=light\]\{([^}]*)\}/)![1];
const web = (name: string) => lightBlock.match(new RegExp(`--${name}:(#[0-9a-fA-F]{3,8})`))?.[1].toLowerCase();

test('both palettes define the same tokens', () => {
  assert.deepEqual(Object.keys(palettes.light).sort(), Object.keys(palettes.dark).sort());
});

test('the light palette is the browser app light theme', () => {
  const light = palettes.light;
  assert.equal(light.ground, web('bg'));
  assert.equal(light.panel, '#ffffff');
  for (const [token, name] of [['text', 'text'], ['muted', 'muted'], ['dim', 'dim'], ['soft', 'soft'], ['primary', 'primary'], ['onPrimary', 'on-primary'], ['good', 'good'], ['warn', 'warn'], ['hairline', 'line']] as const) {
    assert.equal(light[token], web(name), token);
  }
});

test('System follows the phone; an unknown scheme keeps the original dark look', () => {
  assert.equal(resolveScheme('system', 'light'), 'light');
  assert.equal(resolveScheme('system', 'dark'), 'dark');
  assert.equal(resolveScheme('system', null), 'dark');
  assert.equal(resolveScheme('light', 'dark'), 'light');
  assert.equal(resolveScheme('dark', 'light'), 'dark');
});

// Screens must read tokens, and build style sheets with themed(), or they stay frozen on one scheme.
// NativePlayer is the exception: it draws over video and keeps the dark palette.
const frozen = new Set(['palette.ts', 'theme.ts', 'screens/NativePlayer.tsx']);
function files(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name), rel = base ? `${base}/${name}` : name;
    return statSync(path).isDirectory() ? files(path, rel) : /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [rel] : [];
  });
}
test('screens use theme tokens, not raw colours or frozen style sheets', () => {
  assert.ok(files(src).length > 8, 'source files found');
  for (const file of files(src).filter(name => !frozen.has(name))) {
    const text = readFileSync(join(src, file), 'utf8');
    const hex = [...text.matchAll(/^.*#[0-9a-fA-F]{3,8}\b.*$/gm)].filter(match => !/svg\.replaceAll\('#F3F1EC'/.test(match[0]));
    assert.deepEqual(hex.map(match => match[0].trim().slice(0, 80)), [], `${file} has raw hex colours`);
    assert.equal((text.match(/StyleSheet\.create\(/g) || []).length, (text.match(/themed\(\(\) => StyleSheet\.create\(/g) || []).length, `${file} builds a style sheet outside themed()`);
  }
});

test('the app re-themes by remounting, but never while the player is up', () => {
  assert.equal(needsRemount('dark', 'light', false), true);
  assert.equal(needsRemount('dark', 'light', true), false); // scheduled dark mode during playback
  assert.equal(needsRemount('light', 'light', false), false);
});

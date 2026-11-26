import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const code = ts.transpileModule(readFileSync(new URL('../components/TvFocus.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test('TV pressables keep accessibility when D-pad focus is disabled', () => {
  const modules: Record<string, unknown> = {
    react: { useState: (initial: boolean) => [initial, () => {}], forwardRef: (render: Function) => render },
    'react/jsx-runtime': { jsx: (type: unknown, props: object) => ({ type, props }) },
    'react-native': { Platform: { OS: 'android', isTV: true }, Pressable: 'Pressable', StyleSheet: { create: (styles: object) => styles } },
    '../theme': { colors: { primary: '#fff' }, themed: (create: () => object) => create() },
  };
  const context = { exports: {} as { FocusPressable: (props: object) => { type: string; props: { accessible: boolean; focusable: boolean } } },
    require: (name: string) => { assert.ok(modules[name], name); return modules[name]; } };
  vm.runInNewContext(code, context);

  const { FocusPressable } = context.exports;
  const enabled = FocusPressable({});
  assert.equal(enabled.type, 'Pressable');
  assert.equal(enabled.props.accessible, true);
  assert.equal(enabled.props.focusable, true);
  for (const props of [{ disabled: true }, { focusable: false }, { accessible: false }]) {
    const button = FocusPressable(props);
    assert.equal(button.props.accessible, true);
    assert.equal(button.props.focusable, false);
  }
});

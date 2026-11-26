import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '../components/TvFocus';
import { styles as t } from '../components/Matro';
import { colors, fonts, themed } from '../theme';
import { chrome } from './playerTheme';
import { holdDelay } from './playerView';

/** A round − / + button. A touch steps once at once, and holding it keeps stepping, faster the longer it is held. */
function StepButton({ label, glyph, onStep }: { label: string; glyph: string; onStep: () => void }) {
  const step = useRef(onStep), timer = useRef<ReturnType<typeof setTimeout> | null>(null), touched = useRef(false);
  step.current = onStep;
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => stop, []);
  const start = () => {
    touched.current = true; step.current(); stop();
    let count = 0;
    const repeat = () => { timer.current = setTimeout(() => { step.current(); count++; repeat(); }, holdDelay(count)); };
    repeat();
  };
  // A screen reader activates the button with a plain press and no touch, so that path steps once on its own.
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPressIn={start} onPressOut={() => { stop(); setTimeout(() => { touched.current = false; }, 0); }}
    onPress={() => { if (!touched.current) step.current(); }} style={({ pressed }) => [s.step, pressed && { backgroundColor: chrome.fillOn }]}><Text style={s.glyph}>{glyph}</Text></Pressable>;
}

export function HoldStepper({ label, value, minusLabel, plusLabel, onStep, onReset }: { label: string; value: string; minusLabel: string; plusLabel: string; onStep: (direction: -1 | 1) => void; onReset?: () => void }) {
  return <View style={s.row}>
    <View style={{ flex: 1 }}><Text style={t.muted}>{label}</Text>{onReset ? <Pressable accessibilityRole="button" accessibilityLabel={`Reset ${label.toLowerCase()}`} onPress={onReset} style={s.reset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 16 }}><Text style={[t.dim, { textDecorationLine: 'underline' }]}>Reset</Text></Pressable> : null}</View>
    <StepButton label={minusLabel} glyph="−" onStep={() => onStep(-1)} />
    <Text accessibilityLiveRegion="polite" style={s.value}>{value}</Text>
    <StepButton label={plusLabel} glyph="+" onStep={() => onStep(1)} />
  </View>;
}

const s = themed(() => StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: { width: 44, height: 44, borderRadius: 999, borderWidth: 1, borderColor: chrome.line, alignItems: 'center', justifyContent: 'center' },
  reset: { minHeight: 44, justifyContent: 'center' },
  glyph: { color: colors.text, fontFamily: fonts.medium, fontSize: 20, lineHeight: 24 },
  value: { minWidth: 64, textAlign: 'center', color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
}));

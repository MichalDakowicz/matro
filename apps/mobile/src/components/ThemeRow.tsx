import { Pressable, StyleSheet, Text, View } from 'react-native';
import { setThemeChoice, useThemeChoice } from '../lib/theme-choice';
import type { ThemeChoice } from '../palette';
import { colors, fonts, themed } from '../theme';
import { styles as t } from './Matro';

const options: { value: ThemeChoice; label: string }[] = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];

/** Same System / Light / Dark choice as the browser app's footer. */
export function ThemeRow() {
  const choice = useThemeChoice();
  return <View style={{ gap: 10 }}>
    <Text style={t.dim}>Theme</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={s.row}>
      {options.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: choice === option.value }} onPress={() => setThemeChoice(option.value)}
        style={({ pressed }) => [s.option, choice === option.value && { backgroundColor: colors.chip }, pressed && { opacity: .68 }]}>
        <Text style={s.label}>{option.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}

const s = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, height: 44, borderRadius: 999, borderWidth: 1, borderColor: colors.outline, backgroundColor: colors.wash, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.text, fontFamily: fonts.medium, fontSize: 13 },
}));

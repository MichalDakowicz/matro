import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { styles as t } from '../components/Matro';
import { colors, fonts, themed } from '../theme';

/** A pill choice with a 44 dp target. */
export function Chip({ label, selected, onPress, disabled, accessibilityLabel }: { label: string; selected?: boolean; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} accessibilityState={{ selected: !!selected, disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.chip, selected && s.chipOn, pressed && { opacity: .68 }, disabled && { opacity: .4 }]}><Text style={[s.chipLabel, selected && { color: colors.onPrimary }]}>{label}</Text></Pressable>;
}

export function SwitchRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <View style={s.switchRow}>
    <View style={{ flex: 1 }}><Text style={t.text}>{label}</Text>{hint ? <Text style={[t.dim, { marginTop: 3 }]}>{hint}</Text> : null}</View>
    <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ false: colors.hairlineStrong, true: colors.primary }} thumbColor={value ? colors.onPrimary : colors.muted} />
  </View>;
}

export const Section = ({ title, children }: { title: string; children: React.ReactNode }) => <View style={s.section}><Text style={s.sectionLabel}>{title}</Text>{children}</View>;
export const ChipRow = ({ children }: { children: React.ReactNode }) => <View style={s.chips}>{children}</View>;

const s = themed(() => StyleSheet.create({
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary }, chipLabel: { color: colors.text, fontFamily: fonts.medium, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 },
  section: { gap: 10, paddingTop: 14, marginTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline }, sectionLabel: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
}));

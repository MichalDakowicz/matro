import { forwardRef, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from './theme';

/** Page frame shared by the pre-WebView screens: kicker, big light title, lede, then the form. */
export function Page({ kicker, title, lede, children }: { kicker: string; title: string; lede: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[s.page, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.kicker}>{kicker}</Text>
        <Text style={s.title}>{title}</Text>
        <Text style={s.lede}>{lede}</Text>
        <View style={s.form}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export const Field = forwardRef<TextInput, TextInputProps>(function Field(props, ref) {
  return <TextInput ref={ref} placeholderTextColor={colors.placeholder} selectionColor={colors.primary} {...props} style={[s.field, props.style]} />;
});

export function PrimaryPill({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [s.pill, pressed && s.pressed, busy && s.busy]} accessibilityRole="button">
      {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={s.pillText}>{label}</Text>}
    </Pressable>
  );
}

export function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={s.textButton}>
      <Text style={s.textButtonText}>{label}</Text>
    </Pressable>
  );
}

export const ErrorLine = ({ text }: { text: string }) => (text ? <Text style={s.error} accessibilityRole="alert">{text}</Text> : null);

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ground },
  page: { paddingHorizontal: 28, flexGrow: 1 },
  kicker: { fontFamily: fonts.mono, fontSize: 12, color: colors.dim, letterSpacing: 0.4, marginBottom: 14 },
  title: { fontFamily: fonts.semibold, fontSize: 40, lineHeight: 42, letterSpacing: -1.6, color: colors.text },
  lede: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.muted, marginTop: 14, maxWidth: 420 },
  form: { gap: 12, marginTop: 28, maxWidth: 420 },
  field: {
    height: 56, borderRadius: 999, paddingHorizontal: 22, backgroundColor: colors.inputFill,
    borderWidth: 1, borderColor: colors.fieldBorder, color: colors.text, fontFamily: fonts.regular, fontSize: 17,
  },
  pill: { height: 52, borderRadius: 999, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  pillText: { fontFamily: fonts.medium, fontSize: 15, color: colors.onPrimary },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  busy: { opacity: 0.6 },
  textButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 4 },
  textButtonText: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  error: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.warn, paddingHorizontal: 6 },
});

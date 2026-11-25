import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTime } from '../../../../packages/core/client/library';
import { Pill, styles as t } from '../components/Matro';
import { colors, fonts } from '../theme';
import { chrome } from './playerTheme';
import { preparingLabel } from './playerView';

/** Whole seconds since `active` last turned on. The server reports no prepare progress, so elapsed time is what shows the wait is alive. */
function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!active) return;
    const started = Date.now(), timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

/** Loading is one glass line with elapsed time and Cancel. An error offers Try again and, quieter, Back. */
export function PlayerStatus({ busy, error, onRetry, onCancel }: { busy: boolean; error: string; onRetry: () => void; onCancel: () => void }) {
  const seconds = useElapsed(busy && !error);
  if (!busy && !error) return null;
  return <View pointerEvents="box-none" style={s.fill}>
    {error ? <View accessibilityRole="alert" style={s.card}>
      <Text style={[t.sectionTitle, { textAlign: 'center' }]}>Couldn’t play this file.</Text>
      <Text style={[t.muted, { textAlign: 'center' }]}>{error}</Text>
      <Pill label="Try again" primary onPress={onRetry} />
      <Pressable accessibilityRole="button" accessibilityLabel="Back to library" onPress={onCancel} style={s.back}><Text style={s.backLabel}>Back</Text></Pressable>
    </View> : <View style={s.line}>
      <ActivityIndicator color={colors.text} />
      <Text style={s.label}>{preparingLabel(formatTime(seconds))}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel and go back" onPress={onCancel} style={s.cancel}><Text style={s.cancelLabel}>Cancel</Text></Pressable>
    </View>}
  </View>;
}

const s = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  line: { minHeight: 52, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 18, paddingRight: 6, borderRadius: 999, backgroundColor: chrome.glass, borderWidth: 1, borderColor: chrome.glassLine },
  label: { flexShrink: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
  cancel: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: chrome.line, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { color: colors.text, fontFamily: fonts.medium, fontSize: 13 },
  card: { maxWidth: 360, alignItems: 'stretch', gap: 12, padding: 20, borderRadius: 22, backgroundColor: chrome.glass, borderWidth: 1, borderColor: chrome.glassLine },
  back: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, backLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14 },
});

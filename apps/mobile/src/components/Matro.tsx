import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Text as SvgText, SvgXml } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import icons from '../../../../packages/browser-ui/icons.json';
import brand from '../../../../packages/browser-ui/brand.json';
import { colors, fonts } from '../theme';

export type Glyph = keyof typeof icons;
export function Icon({ name, size = 20, color = colors.text }: { name: Glyph; size?: number; color?: string }) {
  return <SvgXml width={size} height={size} xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`} />;
}
export const Brand = ({ size = 34 }: { size?: number }) => <SvgXml xml={brand.svg} width={size} height={size} />;
export function SkipIcon({ back }: { back?: boolean }) {
  return <Svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={back ? 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4' : 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4'} /><SvgText x={12} y={15.4} textAnchor="middle" strokeWidth={0} fill={colors.text} fontSize={9} fontFamily={fonts.medium}>5</SvgText></Svg>;
}
export function IconButton({ name, label, onPress, active, disabled, size = 44, children }: { name?: Glyph; label: string; onPress: () => void; active?: boolean; disabled?: boolean; size?: number; children?: React.ReactNode }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active, disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={3} style={({ pressed }) => [styles.iconButton, { width: size, height: size }, active && styles.selected, pressed && styles.pressed, disabled && { opacity: .3 }]}>{children || (name && <Icon name={name} />)}</Pressable>;
}
export function Pill({ label, icon, onPress, primary, compact, disabled, style }: { label: string; icon?: Glyph; onPress: () => void; primary?: boolean; compact?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.pill, primary && styles.primary, compact && { height: 38, paddingHorizontal: 14 }, style, pressed && styles.pressed, disabled && { opacity: .4 }]}>{icon && <Icon name={icon} size={18} color={primary ? colors.onPrimary : colors.text} />}<Text style={[styles.pillLabel, primary && { color: colors.onPrimary }, compact && { fontSize: 12 }]}>{label}</Text></Pressable>;
}
export const MediaArt = memo(function MediaArt({ base, headers, path, title, style, children }: { base: string; headers: Record<string, string>; path?: string; title?: string; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const uri = path && (/^https?:\/\//i.test(path) ? path : base + (path.startsWith('/api/') ? path : '/api/' + path.replace(/^\//, '')));
  return <View style={[styles.art, style]}>
    {uri ? <Image source={{ uri, headers: uri.startsWith(base + '/') ? headers : {}, cache: 'force-cache' }} resizeMode="cover" style={StyleSheet.absoluteFill} /> : <LinearGradient colors={['#252328', '#15151b', '#29252a']} style={StyleSheet.absoluteFill}><Text numberOfLines={4} style={styles.fallback}>{title}</Text></LinearGradient>}
    {children}
  </View>;
});
export const ProgressBar = ({ value }: { value: number }) => <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(1, value)) * 100}%` }]} /></View>;
export const styles = StyleSheet.create({
  text: { color: colors.text, fontFamily: fonts.regular, fontSize: 14 }, muted: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  dim: { color: colors.dim, fontFamily: fonts.regular, fontSize: 12 }, heading: { color: colors.text, fontFamily: fonts.semibold, fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  sectionTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 18, letterSpacing: -.6 }, mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.dim },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, section: { marginBottom: 32 }, sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 16 },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderRadius: 999 }, selected: { backgroundColor: '#ffffff1f' }, pressed: { opacity: .68, transform: [{ scale: .97 }] },
  pill: { height: 50, borderRadius: 999, borderColor: '#ffffff24', borderWidth: 1, paddingHorizontal: 22, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: '#ffffff06' },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary }, pillLabel: { color: colors.text, fontFamily: fonts.medium, fontSize: 15 },
  art: { backgroundColor: colors.panel, overflow: 'hidden' }, fallback: { color: colors.text, fontFamily: fonts.semibold, fontSize: 22, letterSpacing: -.7, margin: 16, marginTop: 'auto', marginBottom: 22 },
  progress: { height: 3, width: '100%', backgroundColor: '#ffffff30', overflow: 'hidden', borderRadius: 2 }, progressFill: { height: '100%', backgroundColor: colors.primary }
});

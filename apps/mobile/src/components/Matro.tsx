import { memo, type ReactNode } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Text as SvgText, SvgXml } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import icons from '../../../../packages/browser-ui/icons.json';
import brand from '../../../../packages/browser-ui/brand.json';
import { colors, coverTint, fonts, radius, type } from '../theme';
import { useReduceMotion } from './Motion';

export type Glyph = keyof typeof icons;
export function Icon({ name, size = 20, color = colors.text }: { name: Glyph; size?: number; color?: string }) {
  return <SvgXml width={size} height={size} xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`} />;
}
export const Brand = ({ size = 34 }: { size?: number }) => <SvgXml xml={brand.svg} width={size} height={size} />;
export function SkipIcon({ back }: { back?: boolean }) {
  return <Svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={back ? 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4' : 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4'} /><SvgText x={12} y={15.4} textAnchor="middle" strokeWidth={0} fill={colors.text} fontSize={9} fontFamily={fonts.medium}>5</SvgText></Svg>;
}
/** Every control keeps a 44 dp touch area: anything drawn smaller is padded out with hitSlop. */
const slop = (height: number) => { const extra = Math.max(0, Math.ceil((44 - height) / 2)); return { top: extra, bottom: extra, left: extra, right: extra }; };
const pressed = (reduce: boolean) => reduce ? { opacity: .68 } : { opacity: .68, transform: [{ scale: .97 }] };

export function IconButton({ name, label, onPress, active, disabled, size = 44, children }: { name?: Glyph; label: string; onPress: () => void; active?: boolean; disabled?: boolean; size?: number; children?: ReactNode }) {
  const reduce = useReduceMotion();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active, disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={slop(size)} style={({ pressed: down }) => [styles.iconButton, { width: size, height: size }, active && styles.selected, down && pressed(reduce), disabled && { opacity: .3 }]}>{children || (name && <Icon name={name} />)}</Pressable>;
}
export function Pill({ label, accessibilityLabel = label, icon, onPress, primary, selected, compact, disabled, style }: { label: string; accessibilityLabel?: string; icon?: Glyph; onPress: () => void; primary?: boolean; selected?: boolean; compact?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  primary = primary || selected;
  const reduce = useReduceMotion();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={selected === undefined ? undefined : { selected, disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={compact ? slop(38) : undefined} style={({ pressed: down }) => [styles.pill, primary && styles.primary, compact && { height: 38, paddingHorizontal: 14 }, style, down && pressed(reduce), disabled && { opacity: .4 }]}>{icon && <Icon name={icon} size={18} color={primary ? colors.onPrimary : colors.text} />}<Text style={[styles.pillLabel, primary && { color: colors.onPrimary }, compact && { fontSize: 12 }]}>{label}</Text></Pressable>;
}
/** Filter / kind chip: warm white when selected, a quiet fill otherwise. */
export function Chip({ label, selected, onPress, small }: { label: string; selected?: boolean; onPress: () => void; small?: boolean }) {
  const reduce = useReduceMotion(), height = small ? 36 : 40;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} hitSlop={slop(height)} style={({ pressed: down }) => [styles.chip, { height }, selected && { backgroundColor: colors.chipSelected }, down && pressed(reduce)]}><Text style={[styles.chipLabel, small && { fontSize: 13 }, selected && { color: colors.onChipSelected }]}>{label}</Text></Pressable>;
}
/** Poster, still or backdrop. Without artwork it gets a warm cover tinted from the title; `quiet` leaves the title off (heroes print their own). */
export const MediaArt = memo(function MediaArt({ base, headers, path, title, style, quiet, sheen, children }: { base: string; headers: Record<string, string>; path?: string; title?: string; style?: StyleProp<ViewStyle>; quiet?: boolean; sheen?: boolean; children?: ReactNode }) {
  const uri = path && (/^https?:\/\//i.test(path) ? path : base + (path.startsWith('/api/') ? path : '/api/' + path.replace(/^\//, '')));
  return <View style={[styles.art, style]}>
    {uri ? <Image source={{ uri, headers: uri.startsWith(base + '/') ? headers : {}, cache: 'force-cache' }} resizeMode="cover" style={StyleSheet.absoluteFill} /> : <LinearGradient colors={coverTint(title)} style={StyleSheet.absoluteFill}>{quiet ? null : <Text numberOfLines={4} adjustsFontSizeToFit minimumFontScale={.6} style={styles.fallback}>{title}</Text>}</LinearGradient>}
    {sheen && <LinearGradient pointerEvents="none" colors={[colors.sheenHigh, colors.clear, colors.sheenLow]} locations={[0, .45, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
    {children}
  </View>;
});
export const ProgressBar = ({ value }: { value: number }) => <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(1, value)) * 100}%` }]} /></View>;

/** Bottom sheet on a scrim. Android Back and a tap outside both close it. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={`Close ${title}`} />
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.handle} />
      <View style={[styles.sectionHeading, { marginBottom: 12 }]}><Text accessibilityRole="header" style={[styles.sheetTitle, { flex: 1 }]}>{title}</Text><IconButton name="close" label={`Close ${title}`} onPress={onClose} /></View>
      <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </View>
  </Modal>;
}
/** One tappable row inside a sheet or list: icon, label, optional detail and a chevron when it opens something. */
export function Row({ icon, label, detail, onPress, destructive, chevron, last }: { icon?: Glyph; label: string; detail?: string; onPress: () => void; destructive?: boolean; chevron?: boolean; last?: boolean }) {
  const reduce = useReduceMotion();
  return <Pressable accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label} onPress={onPress} style={({ pressed: down }) => [styles.listRow, last && { borderBottomWidth: 0 }, down && pressed(reduce)]}>
    {icon && <Icon name={icon} size={20} color={destructive ? colors.warn : colors.text} />}
    <View style={{ flex: 1 }}><Text style={[styles.text, { fontSize: 15 }, destructive && { color: colors.warn }]}>{label}</Text>{detail ? <Text style={[styles.dim, { marginTop: 2 }]} numberOfLines={2}>{detail}</Text> : null}</View>
    {chevron && <Icon name="chevron" size={16} color={colors.dim} />}
  </Pressable>;
}
export const SectionLabel = ({ children }: { children: string }) => <Text style={styles.sectionLabel}>{children}</Text>;

export const styles = StyleSheet.create({
  text: { color: colors.text, fontFamily: fonts.regular, fontSize: 14 }, muted: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  dim: { color: colors.dim, fontFamily: fonts.regular, fontSize: 12 }, heading: { color: colors.text, fontFamily: fonts.semibold, ...type.page },
  display: { color: colors.text, fontFamily: fonts.semibold, ...type.display }, sheetTitle: { color: colors.text, fontFamily: fonts.semibold, ...type.sheet },
  sectionTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 18, letterSpacing: -.6 }, mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.dim },
  sectionLabel: { color: colors.dim, fontFamily: fonts.medium, fontSize: 12, letterSpacing: .3, textTransform: 'uppercase', marginTop: 18, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, section: { marginBottom: 32 }, sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 16 },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill }, selected: { backgroundColor: colors.hairlineStrong },
  pill: { height: 50, borderRadius: radius.pill, borderColor: colors.hairlineStrong, borderWidth: 1, paddingHorizontal: 22, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: colors.fill },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary }, pillLabel: { color: colors.text, fontFamily: fonts.medium, fontSize: 15 },
  chip: { borderRadius: radius.pill, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: colors.chip }, chipLabel: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
  art: { backgroundColor: colors.panel, overflow: 'hidden' }, fallback: { color: colors.text, fontFamily: fonts.semibold, fontSize: 20, letterSpacing: -.5, margin: 12, marginTop: 'auto', marginBottom: 16 },
  progress: { height: 3, width: '100%', backgroundColor: colors.track, overflow: 'hidden', borderRadius: 2 }, progressFill: { height: '100%', backgroundColor: colors.primary },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '88%', paddingHorizontal: 22, paddingTop: 10, backgroundColor: colors.ground, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, borderColor: colors.hairline },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: radius.pill, backgroundColor: colors.hairlineStrong, marginBottom: 10 },
  listRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.hairline },
});

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { Library } from '../lib/server';
import { colors, dock as dockSize, fonts, radius } from '../theme';
import { Brand, Icon, IconButton, Row, SectionLabel, Sheet, styles as t, type Glyph } from './Matro';
import { useReduceMotion } from './Motion';

/** Top of every screen: a fade from the ground colour so headings scrolling up never collide with the corner buttons. */
export const TopFade = ({ extra = 0 }: { extra?: number }) => {
  const insets = useSafeAreaInsets();
  return <LinearGradient pointerEvents="none" colors={[colors.fade, colors.clear]} style={[s.fade, { top: 0, height: insets.top + 76 + extra }]} />;
};
const BottomFade = () => {
  const insets = useSafeAreaInsets();
  return <LinearGradient pointerEvents="none" colors={[colors.clear, colors.fade]} style={[s.fade, { bottom: 0, height: insets.bottom + dockSize.height + 56, zIndex: 25 }]} />;
};

/** A faint static film grain over the whole screen (the web's body::after). Static, so reduce-motion needs nothing. */
export const Grain = () => <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={s.grain}><Image source={require('../../assets/grain.png')} resizeMode="repeat" style={StyleSheet.absoluteFill} /></View>;

/** True while the soft keyboard is up, so the dock can get out of the way. */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const subs = [Keyboard.addListener('keyboardDidShow', () => setOpen(true)), Keyboard.addListener('keyboardDidHide', () => setOpen(false))];
    return () => subs.forEach(sub => sub.remove());
  }, []);
  return open;
}

export function Corner({ username, canBack, onBack, onHome, onProfile }: { username?: string; canBack: boolean; onBack: () => void; onHome: () => void; onProfile: () => void }) {
  const insets = useSafeAreaInsets();
  return <>
    <TopFade />
    <View pointerEvents="box-none" style={[s.corner, { top: insets.top + 12 }]}>
      {canBack
        ? <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={s.glassButton}><Icon name="back" /></Pressable>
        : <Pressable onPress={onHome} accessibilityRole="button" accessibilityLabel="Matro, back to the library" style={s.brand}><Brand /></Pressable>}
      <Pressable onPress={onProfile} accessibilityRole="button" accessibilityLabel="Your profile" style={s.glassButton}><Text style={[t.text, { fontSize: 15, fontFamily: fonts.medium }]}>{(username || 'M').slice(0, 1).toUpperCase()}</Text></Pressable>
    </View>
  </>;
}

/** "Offline — showing saved titles · Reconnect", under the corner buttons while the server is unreachable. */
export function OfflinePill({ onReconnect }: { onReconnect: () => void }) {
  const insets = useSafeAreaInsets();
  return <View pointerEvents="box-none" style={[s.offline, { top: insets.top + 12 + 44 + 8 }]}>
    <View style={s.offlinePill} accessibilityLiveRegion="polite"><View style={s.offlineDot} /><Text style={[t.text, { fontSize: 13 }]} numberOfLines={1}>Offline · showing saved titles</Text>
      <Pressable onPress={onReconnect} accessibilityRole="button" accessibilityLabel="Reconnect to your server" hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }} style={s.reconnect}><Text style={[t.text, { fontSize: 13, fontFamily: fonts.semibold, color: colors.onChipSelected }]}>Reconnect</Text></Pressable></View>
  </View>;
}

export type DockTab = 'home' | 'search' | 'queue' | 'server';
const dockItems: { id: DockTab; label: string; icon: Glyph }[] = [{ id: 'home', label: 'Library', icon: 'movies' }, { id: 'search', label: 'Search', icon: 'search' }, { id: 'queue', label: 'Queue', icon: 'queue' }, { id: 'server', label: 'Server', icon: 'network' }];
/** The artboards' four-item dock: Library, Search, Queue, Server. The active item shows its label. */
export function Dock({ active, onChange, queued, hidden }: { active: DockTab; onChange: (tab: DockTab) => void; queued: number; hidden?: boolean }) {
  const insets = useSafeAreaInsets();
  if (hidden) return null;
  return <>
    <BottomFade />
    <View pointerEvents="box-none" style={[s.dockWrap, { bottom: insets.bottom + dockSize.bottom }]}>
      <View style={s.dock} accessibilityRole="tablist">{dockItems.map(item => {
        const on = active === item.id, count = item.id === 'queue' && queued ? ` (${queued})` : '';
        return <Pressable key={item.id} onPress={() => onChange(item.id)} accessibilityRole="tab" accessibilityLabel={item.label + count} accessibilityState={{ selected: on }} style={({ pressed }) => [s.dockItem, on ? s.dockOn : { flex: 1 }, pressed && { opacity: .65 }]}>
          <Icon name={item.icon} color={on ? colors.onPrimary : colors.soft} />
          {on && <Text numberOfLines={1} style={s.dockLabel}>{item.label}</Text>}
          {!on && !!count && <View style={s.dockBadge} />}
        </Pressable>;
      })}</View>
    </View>
  </>;
}

export type Notice = { id: number; text: string; action?: { label: string; run: () => void } };
/** A toast that clears itself (about 4 s, 7 s when it carries an action). Newer notices replace older ones. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined), next = useRef(0);
  const dismiss = useCallback(() => { clearTimeout(timer.current); setNotice(null); }, []);
  const show = useCallback((text: string, action?: Notice['action']) => {
    clearTimeout(timer.current); setNotice({ id: ++next.current, text, action });
    timer.current = setTimeout(() => setNotice(null), action ? 7000 : 4000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { notice, show, dismiss };
}
export function Toast({ notice, bottom, onDismiss }: { notice: Notice | null; bottom: number; onDismiss: () => void }) {
  const reduce = useReduceMotion();
  if (!notice) return null;
  return <View pointerEvents="box-none" style={[s.toastWrap, { bottom }]}>
    <Pressable key={notice.id} onPress={onDismiss} accessibilityLiveRegion="polite" accessibilityLabel={notice.text} style={({ pressed }) => [s.toast, pressed && !reduce && { opacity: .85 }]}>
      <Text style={[t.text, { flex: 1, fontSize: 14, lineHeight: 20 }]}>{notice.text}</Text>
      {notice.action && <Pressable onPress={() => { onDismiss(); notice.action!.run(); }} accessibilityRole="button" hitSlop={8} style={s.toastAction}><Text style={[t.text, { fontFamily: fonts.semibold, fontSize: 14 }]}>{notice.action.label}</Text></Pressable>}
    </Pressable>
  </View>;
}

type AccountProps = { visible: boolean; onClose: () => void; data: Library | null; base: string; offline: boolean; requests?: string; onGo: (tab: string) => void; onRefresh: () => void; onAbout: () => void; onServer: () => void; onSignOut: () => void };
/** Profile sheet in three groups: Library (where things are), Server (connection) and Account (about, sign out last). */
export function AccountSheet({ visible, onClose, data, base, offline, requests, onGo, onRefresh, onAbout, onServer, onSignOut }: AccountProps) {
  const go = (tab: string) => { onClose(); onGo(tab); };
  const confirm = (title: string, message: string, action: string, run: () => void) => Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: () => { onClose(); run(); } }], { cancelable: true });
  const admin = !offline && data?.user.role === 'admin';
  return <Sheet visible={visible} onClose={onClose} title="Your profile">
    <Text style={[t.text, { fontSize: 20 }]}>{data?.user.username}</Text>
    <Text style={t.muted}>{offline ? 'Offline' : admin ? 'Head account' : 'Viewer'} · {base.replace(/^https?:\/\//, '')}</Text>
    <View style={[t.row, { marginTop: 18, gap: 36 }]}>
      <View><Text style={s.stat}>{data?.items.length || 0}</Text><Text style={t.dim}>{data?.items.length === 1 ? 'File' : 'Files'}</Text></View>
      <View><Text style={s.stat}>{Object.values(data?.progress || {}).filter(p => p.completed).length}</Text><Text style={t.dim}>Watched</Text></View>
    </View>
    <SectionLabel>Library</SectionLabel>
    {data && <Row icon="download" label="Saved for offline" chevron onPress={() => go('offline')} />}
    {admin && <Row icon="folder" label="Folders" chevron onPress={() => go('folders')} />}
    {admin && <Row icon="arrows" label="Host downloads" detail="Find releases and add them to the server" chevron onPress={() => go('downloads')} />}
    {!offline && !!requests && <Row icon="requests" label={requests} chevron onPress={() => go('movie-requests')} />}
    <SectionLabel>Server</SectionLabel>
    <Row icon="refresh" label={offline ? 'Reconnect' : 'Refresh library'} onPress={() => { onClose(); onRefresh(); }} />
    <Row icon="network" label="Change server" detail={base.replace(/^https?:\/\//, '')} onPress={() => confirm('Change server?', 'Matro forgets this server address and asks for a new one. Titles saved on this device stay here.', 'Change server', onServer)} />
    <SectionLabel>Account</SectionLabel>
    <Row icon="file" label="About Matro" onPress={() => { onClose(); onAbout(); }} />
    <Row icon="close" label="Sign out" destructive last onPress={() => confirm('Sign out?', 'You will need your password to sign back in. Titles saved on this device stay here.', 'Sign out', onSignOut)} />
  </Sheet>;
}

/** What the old Help dialog said, as a normal sheet. */
export const AboutSheet = ({ visible, onClose, files }: { visible: boolean; onClose: () => void; files: number }) =>
  <Sheet visible={visible} onClose={onClose} title="About Matro">
    <Text style={[t.text, { lineHeight: 22 }]}>{files} {files === 1 ? 'file' : 'files'} in your library.</Text>
    <Text style={[t.muted, { marginTop: 12 }]}>Movies are prepared on your Matro server and played natively on this device.</Text>
    <Text style={[t.muted, { marginTop: 12 }]}>Metadata and artwork come from TMDB.</Text>
  </Sheet>;

const s = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, zIndex: 15 },
  grain: { ...StyleSheet.absoluteFill, opacity: .07, zIndex: 55, elevation: 26 },
  corner: { position: 'absolute', left: 14, right: 14, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 20 },
  glassButton: { width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.hairlineStrong, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },
  brand: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  offline: { position: 'absolute', left: 14, right: 14, alignItems: 'center', zIndex: 20 },
  offlinePill: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 5, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.hairlineStrong, backgroundColor: colors.glassStrong, maxWidth: '100%' },
  offlineDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.warn },
  reconnect: { height: 30, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.chipSelected, justifyContent: 'center' },
  dockWrap: { position: 'absolute', left: 14, right: 14, alignItems: 'center', zIndex: 30 },
  dock: { width: '100%', maxWidth: 420, height: dockSize.height, padding: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.dock, flexDirection: 'row', gap: 4, elevation: 12, boxShadow: '0 10px 30px #0006' },
  dockItem: { height: dockSize.item, borderRadius: radius.pill, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 },
  dockOn: { flex: 2.2, backgroundColor: colors.primary },
  dockLabel: { color: colors.onPrimary, fontFamily: fonts.semibold, fontSize: 14 },
  dockBadge: { position: 'absolute', top: 11, right: '28%', width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.text },
  toastWrap: { position: 'absolute', left: 18, right: 18, alignItems: 'center', zIndex: 60, elevation: 30 },
  toast: { width: '100%', maxWidth: 420, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 18, paddingRight: 12, minHeight: 52, borderRadius: radius.panel, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.hairlineStrong, boxShadow: '0 10px 30px #0006' },
  toastAction: { minHeight: 36, paddingHorizontal: 10, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.chip },
  stat: { color: colors.text, fontFamily: fonts.medium, fontSize: 28, letterSpacing: -1 },
});

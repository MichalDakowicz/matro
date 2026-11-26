import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, styles as t } from '../components/Matro';
import { colors, themed } from '../theme';
import { chrome } from './playerTheme';
import { useReduceMotion } from './useMotion';

/** The player's bottom sheet (a side panel in landscape): scrim, header with a labelled close button, and the content. */
export function PlayerSheet({ open, title, closeLabel, onClose, landscape, height, children }: { open: boolean; title: string; closeLabel: string; onClose: () => void; landscape: boolean; height: number; children: React.ReactNode }) {
  const insets = useSafeAreaInsets(), reduce = useReduceMotion();
  return <Modal visible={open} transparent animationType={reduce ? 'none' : 'slide'} supportedOrientations={['portrait', 'landscape']} presentationStyle="overFullScreen" onRequestClose={onClose}>
    <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close player panel" />
    <View style={[s.sheet, { paddingBottom: Math.max(16, insets.bottom + 12), maxHeight: landscape ? height - 20 : height * .78 }, landscape && { width: 360, left: undefined, top: 0, maxHeight: height, borderTopRightRadius: 0 }]}>
      <View style={t.sectionHeading}><Text style={t.sectionTitle}>{title}</Text><IconButton name="close" label={closeLabel} onPress={onClose} /></View>
      {children}
    </View>
  </Modal>;
}

const s = themed(() => StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: chrome.scrim },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: chrome.glassLine, paddingHorizontal: 18, paddingTop: 12 },
}));

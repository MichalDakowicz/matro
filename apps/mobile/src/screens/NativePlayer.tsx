import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, BackHandler, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import * as ScreenOrientation from 'expo-screen-orientation';
import { setStatusBarHidden } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import type { Item, Library } from '../lib/server';
import { episodeName, formatTime, languageName, metadataFor, nameFor } from '../../../../packages/core/client/library';
import { usePlayback } from '../player/usePlayback';
import { Icon, IconButton, MediaArt, Pill, SkipIcon, styles as t } from '../components/Matro';
import type { ArtProps } from '../components/LibraryParts';
import { colors, fonts } from '../theme';

type Props = ArtProps & { item: Item; data: Library; initialPosition?: number; queue: Item[]; onBack: () => void; onSelect: (item: Item) => void; onNext: () => void };
export default function NativePlayer({ base, headers, item, data, initialPosition, queue, onBack, onSelect, onNext }: Props) {
  const p = usePlayback({ base, data, item, initialPosition, onEnd: onNext });
  const [controls, setControls] = useState(true), [sheet, setSheet] = useState<'tracks' | 'queue' | null>(null), [scrub, setScrub] = useState<number | null>(null);
  const insets = useSafeAreaInsets(), { width, height } = useWindowDimensions(), landscape = width > height, opacity = useRef(new Animated.Value(1)).current;
  const dragging = useRef(false);
  const queueIndex = queue.findIndex(i => i.id === item.id), hasPrevious = queueIndex > 0, hasNext = queueIndex >= 0 && queueIndex < queue.length - 1;
  const duration = p.info?.duration || 0, shownPosition = scrub ?? p.position;
  const title = item.kind === 'show' ? episodeName(data, item) : nameFor(data, item);
  const leave = async () => { await p.persist().catch(() => {}); p.player.pause(); onBack(); };
  const toggleFullscreen = () => {
    setControls(true);
    if (landscape) void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    else void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  };
  useEffect(() => {
    const update = () => { setStatusBarHidden(landscape, 'fade'); if (Platform.OS === 'android') NavigationBar.setHidden(landscape); };
    update();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    return () => { subscription.remove(); setStatusBarHidden(false, 'fade'); if (Platform.OS === 'android') NavigationBar.setHidden(false); };
  }, [landscape]);
  useEffect(() => {
    // Unlocking alone leaves Android in the last forced orientation when the
    // user's system rotation lock is enabled. Restore the entry orientation first.
    const entry = Promise.all([ScreenOrientation.getOrientationAsync(), ScreenOrientation.getOrientationLockAsync()]);
    return () => {
      void entry.then(async ([orientation, lock]) => {
        if (lock !== ScreenOrientation.OrientationLock.DEFAULT && lock !== ScreenOrientation.OrientationLock.ALL) { await ScreenOrientation.lockAsync(lock); return; }
        const previous = orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ? ScreenOrientation.OrientationLock.LANDSCAPE_LEFT
          : orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT ? ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT
          : ScreenOrientation.OrientationLock.PORTRAIT_UP;
        await ScreenOrientation.lockAsync(previous);
        setTimeout(() => { void ScreenOrientation.lockAsync(lock).catch(() => {}); }, 400);
      }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (landscape) toggleFullscreen(); else void leave(); return true; });
    return () => sub.remove();
  }, [landscape, p.persist]);
  useEffect(() => { Animated.timing(opacity, { toValue: controls ? 1 : 0, duration: 180, useNativeDriver: true }).start(); }, [controls, opacity]);
  useEffect(() => { if (!p.playing || p.busy || sheet || scrub !== null || !controls) return; const timer = setTimeout(() => setControls(false), 3200); return () => clearTimeout(timer); }, [p.playing, p.busy, controls, sheet, scrub]);
  useEffect(() => { if (!p.playing || p.busy || p.error) setControls(true); }, [p.playing, p.busy, p.error]);
  const select = async (next: Item) => { setSheet(null); await p.persist().catch(() => {}); p.player.pause(); onSelect(next); };
  const skip = (delta: number) => { setControls(true); p.seek(p.position + delta); };
  const videoAspect = p.info?.video?.width && p.info.video.height ? p.info.video.width / p.info.video.height : 16 / 9;
  const pictureHeight = Math.min(height, width / videoAspect), captionBottom = Math.max((height - pictureHeight) / 2 + pictureHeight * .06, controls ? (landscape ? 110 : 225 + insets.bottom) : insets.bottom + 16);
  const allSubs = [...(p.info?.embedded || []), ...(p.info?.uploaded || []).map(track => ({ index: 10000 + track.id, language: track.language, title: track.name, text: true, codec: 'vtt' }))];
  const transport = <View style={[s.transport, landscape && { gap: 4 }]}>
    <IconButton name="prev" label="Previous in queue" disabled={!hasPrevious} size={landscape ? 40 : 46} onPress={() => void select(queue[queueIndex - 1])} />
    <IconButton label="Back 5 seconds" size={landscape ? 40 : 46} onPress={() => skip(-5)}><SkipIcon back /></IconButton>
    <IconButton name={p.playing ? 'pause' : 'play'} label={p.playing ? 'Pause' : 'Play'} size={landscape ? 48 : 60} onPress={() => { setControls(true); p.toggle(); }} />
    <IconButton label="Forward 5 seconds" size={landscape ? 40 : 46} onPress={() => skip(5)}><SkipIcon /></IconButton>
    <IconButton name="next" label="Next in queue" disabled={!hasNext} size={landscape ? 40 : 46} onPress={() => void select(queue[queueIndex + 1])} />
  </View>;
  const utilities = <View style={[s.utilities, landscape && { width: 'auto', gap: 10 }]}>
    <Pressable accessibilityLabel="Change playback speed" onPress={() => { setControls(true); p.changeSpeed(); }} style={s.speed}><Text style={t.text}>{p.rate}×</Text></Pressable>
    <IconButton name="tracks" label="Audio and subtitles" active={sheet === 'tracks'} onPress={() => { setControls(true); setSheet('tracks'); }} />
    <IconButton name="queue" label="Queue" active={sheet === 'queue'} onPress={() => { setControls(true); setSheet('queue'); }} />
    <IconButton name="fullscreen" label={landscape ? 'Exit fullscreen' : 'Fullscreen'} onPress={toggleFullscreen} />
  </View>;
  return <View style={s.fill}>
    <VideoView player={p.player} nativeControls={false} contentFit="contain" fullscreenOptions={{ enable: false }} style={StyleSheet.absoluteFill} />
    <Pressable style={StyleSheet.absoluteFill} onPress={() => setControls(!controls)} accessibilityLabel="Show or hide playback controls" />
    {p.caption ? <Text pointerEvents="none" style={[s.caption, { bottom: captionBottom, fontSize: 20 * p.subtitleSize, lineHeight: 27 * p.subtitleSize, maxWidth: landscape ? '80%' : '92%' }]}>{p.caption}</Text> : null}
    {p.busy || p.error ? <View pointerEvents="box-none" style={s.message}>{p.error ? <><Text style={[t.sectionTitle, { textAlign: 'center' }]}>Couldn’t play this file.</Text><Text style={[t.muted, { textAlign: 'center' }]}>{p.error}</Text><Pill label="Try again" onPress={p.retry} /></> : <><ActivityIndicator color={colors.text} /><Text style={t.dim}>Getting your file ready</Text><Text style={t.muted}>Preparing playback…</Text></>}</View> : null}
    <Animated.View pointerEvents={controls ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, { opacity }]}>
      <LinearGradient pointerEvents="none" colors={['#000c', 'transparent']} style={[s.topFade, { height: insets.top + 140 }]} />
      <View style={[s.top, { top: landscape ? 8 : insets.top + 12, left: Math.max(14, insets.left), right: Math.max(14, insets.right) }]}>
        <IconButton name="back" label="Back to library" onPress={() => void leave()} />
        <View style={{ flex: 1, gap: 4 }}><Text numberOfLines={1} style={s.playerTitle}>{title}</Text><Text numberOfLines={1} style={s.playerSubtitle}>{item.kind === 'show' ? `${nameFor(data, item)} · S${item.season} E${item.episode}` : `${item.format} · Movie`}</Text></View>
      </View>
      <LinearGradient pointerEvents="none" colors={['transparent', '#000e']} style={[s.bottomFade, { height: landscape ? 180 : 300 + insets.bottom }]} />
      <View style={[s.controls, { left: Math.max(14, insets.left), right: Math.max(14, insets.right), bottom: landscape ? Math.max(6, insets.bottom) : insets.bottom + 12 }]}>
        <View style={{ height: 34, justifyContent: 'center' }}>
          <View pointerEvents="none" style={s.bufferTrack}><View style={{ height: 3, width: `${duration ? Math.min(100, p.buffered / duration * 100) : 0}%`, backgroundColor: '#ffffff40' }} /></View>
          <Slider accessibilityLabel="Seek" minimumValue={0} maximumValue={duration || 1} value={shownPosition} minimumTrackTintColor={colors.primary} maximumTrackTintColor="#ffffff24" thumbTintColor={colors.primary} step={.1} style={{ height: 34, marginHorizontal: -13 }}
            onSlidingStart={value => { dragging.current = true; setControls(true); setScrub(value); }} onValueChange={value => { if (dragging.current) setScrub(value); }} onSlidingComplete={value => { dragging.current = false; setScrub(null); p.seek(value); }} />
        </View>
        <Text style={s.time}>{formatTime(shownPosition)}<Text style={{ color: '#ffffff4d' }}> / </Text>{formatTime(duration)}</Text>
        <View style={[s.controlRows, landscape && { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>{transport}{utilities}</View>
      </View>
    </Animated.View>
    <Modal visible={!!sheet} transparent animationType="slide" supportedOrientations={['portrait', 'landscape']} presentationStyle="overFullScreen" onRequestClose={() => setSheet(null)}>
      <Pressable style={s.scrim} onPress={() => setSheet(null)} accessibilityLabel="Close player panel" />
      <View style={[s.sheet, { paddingBottom: Math.max(16, insets.bottom + 12), maxHeight: landscape ? height - 20 : height * .78 }, landscape && { width: 360, left: undefined, top: 0, bottom: 0, maxHeight: height, borderTopRightRadius: 0 }]}>
        <View style={t.sectionHeading}><Text style={t.sectionTitle}>{sheet === 'tracks' ? 'Audio and subtitles' : 'Queue'}</Text><IconButton name="close" label={sheet === 'tracks' ? 'Close audio and subtitles' : 'Close queue'} onPress={() => setSheet(null)} /></View>
        {sheet === 'tracks' ? <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={s.panelLabel}>Audio</Text>
          {p.info?.audio.map(track => <Pressable key={track.index} onPress={() => p.chooseAudio(track.index)} accessibilityRole="radio" accessibilityState={{ checked: p.audio === track.index }} style={[s.track, p.audio === track.index && s.selectedTrack]}><View style={{ flex: 1 }}><Text style={[t.text, { fontFamily: fonts.medium }]}>{languageName(track.language)}</Text>{track.title ? <Text style={[t.dim, { marginTop: 3 }]}>{track.title}</Text> : null}<Text style={[t.dim, { fontSize: 11, marginTop: 4 }]}>{[track.codec?.toUpperCase(), track.channels ? `${track.channels} channels` : ''].filter(Boolean).join(' · ')}</Text></View>{p.audio === track.index && <Icon name="check" size={18} />}</Pressable>)}
          <Text style={[s.panelLabel, { marginTop: 22 }]}>Subtitles</Text>
          <Pressable onPress={() => p.chooseSubtitle(null)} accessibilityRole="radio" accessibilityState={{ checked: p.subtitle === null }} style={[s.track, p.subtitle === null && s.selectedTrack]}><Text style={[t.text, { flex: 1 }]}>Off</Text>{p.subtitle === null && <Icon name="check" size={18} />}</Pressable>
          {allSubs.map(track => <Pressable key={track.index} onPress={() => p.chooseSubtitle(track.index)} accessibilityRole="radio" accessibilityState={{ checked: p.subtitle === track.index }} style={[s.track, p.subtitle === track.index && s.selectedTrack]}><View style={{ flex: 1 }}><Text style={[t.text, { fontFamily: fonts.medium }]}>{languageName(track.language)}</Text>{track.title ? <Text style={[t.dim, { marginTop: 3 }]}>{track.title}</Text> : null}<Text style={[t.dim, { fontSize: 11, marginTop: 4 }]}>{track.codec?.toUpperCase()}</Text></View>{p.subtitle === track.index && <Icon name="check" size={18} />}</Pressable>)}
          <View style={[s.setting, { marginTop: 18 }]}><Text style={t.muted}>Subtitle delay</Text><View style={t.row}><IconButton label="Subtitles earlier" onPress={() => p.setDelay(p.delay - .1)}><Text style={t.text}>−</Text></IconButton><Text style={[t.mono, { minWidth: 50, textAlign: 'center' }]}>{p.delay >= 0 ? '+' : ''}{p.delay.toFixed(1)} s</Text><IconButton label="Subtitles later" onPress={() => p.setDelay(p.delay + .1)}><Text style={t.text}>+</Text></IconButton></View></View>
          <View style={[s.setting, { marginBottom: 18 }]}><Text style={t.muted}>Text size</Text><Slider accessibilityLabel="Subtitle size" style={{ width: 170, height: 40 }} minimumValue={.6} maximumValue={1.8} value={p.subtitleSize} minimumTrackTintColor={colors.primary} maximumTrackTintColor="#ffffff24" thumbTintColor={colors.primary} onSlidingComplete={p.setSubtitleSize} /></View>
        </ScrollView> : <FlatList data={queue} keyExtractor={entry => entry.id} showsVerticalScrollIndicator={false} renderItem={({ item: entry, index }) => <View>{entry.kind === 'show' && (index === 0 || queue[index - 1].season !== entry.season) ? <Text style={[s.panelLabel, { marginTop: 14 }]}>Season {entry.season}</Text> : null}<Pressable accessibilityLabel={`Play ${episodeName(data, entry)}`} onPress={() => void select(entry)} style={[s.queueRow, entry.id === item.id && s.selectedTrack]}><MediaArt base={base} headers={headers} path={metadataFor(data, entry).episodes?.[String(entry.season)]?.[String(entry.episode)]?.still || metadataFor(data, entry).backdrop || metadataFor(data, entry).poster} style={{ width: 88, height: 50, borderRadius: 6 }} /><View style={{ flex: 1, gap: 4 }}><Text style={[t.text, { fontSize: 13 }]} numberOfLines={2}>{entry.kind === 'show' ? `${entry.episode}. ${episodeName(data, entry)}` : nameFor(data, entry)}</Text><Text style={[t.dim, { fontSize: 11 }]}>{entry.id === item.id ? 'Now playing' : data.progress[entry.id]?.completed ? 'Watched' : entry.format}</Text></View>{entry.id === item.id && <Icon name="play" size={16} />}</Pressable></View>} />}
      </View>
    </Modal>
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' }, topFade: { position: 'absolute', top: 0, left: 0, right: 0 }, top: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8 }, playerTitle: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 }, playerSubtitle: { color: colors.dim, fontFamily: fonts.regular, fontSize: 12 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0 }, controls: { position: 'absolute' }, bufferTrack: { position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: '#ffffff18' }, time: { fontSize: 12, fontFamily: fonts.mono, color: colors.muted, fontVariant: ['tabular-nums'], marginTop: 1 },
  controlRows: { gap: 4, marginTop: 4 }, transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, utilities: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center' }, speed: { minWidth: 46, height: 44, justifyContent: 'center', alignItems: 'center' },
  message: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 }, caption: { position: 'absolute', alignSelf: 'center', color: colors.primary, fontFamily: fonts.medium, backgroundColor: '#0008', textAlign: 'center', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 3, textShadowColor: '#000', textShadowRadius: 3 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: '#0005' }, sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#121214', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: 18, paddingTop: 12 }, panelLabel: { fontSize: 14, color: colors.text, fontFamily: fonts.semibold, marginBottom: 10 }, track: { minHeight: 52, borderRadius: 9, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 }, selectedTrack: { backgroundColor: '#ffffff0e' }, setting: { borderTopWidth: 1, borderTopColor: colors.hairline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }, queueRow: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 8, borderRadius: 10, marginBottom: 5 }
});

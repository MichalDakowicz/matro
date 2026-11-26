import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, BackHandler, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { FocusPressable as Pressable, isAndroidTv } from '../components/TvFocus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isPictureInPictureSupported, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import * as ScreenOrientation from 'expo-screen-orientation';
import { setStatusBarHidden } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import type { Item, Library, Preferences } from '../lib/server';
import { episodeName, metadataFor, nameFor, subtitleTracks } from '../../../../packages/core/client/library';
import { usePlayback } from '../player/usePlayback';
import { usePinchToFill } from '../player/usePinchToFill';
import { useSubtitlePosition } from '../player/SubtitlePositionControls';
import { subtitleOffset } from '../player/subtitlePosition';
import { PlaybackSheet } from '../player/PlaybackSheet';
import { PlayerSheet } from '../player/PlayerSheet';
import { Transport, UtilityRow } from '../player/PlayerControls';
import { PlayerStatus } from '../player/PlayerStatus';
import { SeekBar } from '../player/SeekBar';
import { TracksSheet } from '../player/TracksSheet';
import { Chip, ChipRow } from '../player/sheetParts';
import { chrome, motion } from '../player/playerTheme';
import { captionLift, movieFacts, speedLabel, speeds } from '../player/playerView';
import { useGlide } from '../player/useMotion';
import { UpNextSheet } from '../player/UpNextSheet';
import { showCreditsNext } from '../player/playerTools';
import { parseSubtitleStyle, subtitleTextStyle } from '../player/subtitleStyle';
import { useBackgroundAudio } from '../player/useBackgroundAudio';
import { usePlayerGestures } from '../player/usePlayerGestures';
import { useSkipEditing } from '../player/useSkipEditing';
import { useSleepTimer } from '../player/useSleepTimer';
import { IconButton, Pill, ProgressBar } from '../components/Matro';
import type { ArtProps } from '../components/LibraryParts';
import { colors, fonts } from '../theme';
import type { SavedMedia } from '../lib/offline';

type Props = ArtProps & { item: Item; data: Library; initialPosition?: number; saved?: SavedMedia; offline?: boolean; queue: Item[]; onBack: () => void; onSelect: (item: Item) => void; onNext: () => void; onPreferences: (patch: Partial<Preferences>) => void; onQueue: (queue: Item[]) => void; onComplete: (item: Item) => void };
export default function NativePlayer({ base, headers, item, data, initialPosition, saved, offline, queue, onBack, onSelect, onNext, onPreferences, onQueue, onComplete }: Props) {
  // The timer ends playback at the end of the episode or after a set time. It reads the player lazily because the player is created after it.
  const sleep = useSleepTimer(() => { if (p.playing) p.toggle(); setControls(true); });
  const [background, setBackground] = useBackgroundAudio();
  const [supportsPiP] = useState(() => Platform.OS === 'android' && isPictureInPictureSupported());
  const videoView = useRef<VideoView>(null);
  const p = usePlayback({ base, data, item, initialPosition, saved, offline, background, supportsPiP, onEnd: () => { if (!sleep.stopAtEnd()) onNext(); } });
  const [controls, setControls] = useState(true), [sheet, setSheet] = useState<'tracks' | 'queue' | 'more' | 'speed' | null>(null), [scrub, setScrub] = useState<number | null>(null);
  const tapRef = useRef(() => {});
  const bitmap = !!p.info?.embedded.some(track => track.index === p.subtitle && track.bitmap);
  const { fit, indicator, stageTouches } = usePinchToFill(!!p.info?.video, bitmap, () => tapRef.current());
  const insets = useSafeAreaInsets(), { width, height } = useWindowDimensions(), landscape = width > height;
  const [subtitlePosition, setSubtitlePosition] = useSubtitlePosition();
  const [captionSize, setCaptionSize] = useState({ width: 0, height: 0 });
  const [headerEnd, setHeaderEnd] = useState(0), [controlsTop, setControlsTop] = useState<number | null>(null);
  const queueIndex = queue.findIndex(i => i.id === item.id), hasPrevious = queueIndex > 0, hasNext = queueIndex >= 0 && queueIndex < queue.length - 1;
  const duration = p.info?.duration || 0;
  const segment = p.markers.find(m => p.position >= m.start && p.position < m.end);
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
    if (isAndroidTv) return;
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
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (landscape && !isAndroidTv) toggleFullscreen(); else void leave(); return true; });
    return () => sub.remove();
  }, [landscape, p.persist]);
  useEffect(() => { if (isAndroidTv || !p.playing || p.busy || sheet || scrub !== null || !controls) return; const timer = setTimeout(() => setControls(false), 3200); return () => clearTimeout(timer); }, [p.playing, p.busy, controls, sheet, scrub]);
  useEffect(() => { if (!p.playing || p.busy || p.error) setControls(true); }, [p.playing, p.busy, p.error]);
  const select = async (next: Item) => { setSheet(null); await p.persist().catch(() => {}); p.player.pause(); onSelect(next); };
  const skip = (delta: number) => { setControls(true); p.seek(p.position + delta); };
  const enterPictureInPicture = async () => {
    const view = videoView.current;
    if (!view) return;
    p.pictureInPicture.request();
    try { await view.startPictureInPicture(); }
    catch {
      p.pictureInPicture.failed();
      Alert.alert('Picture-in-picture unavailable', 'Check the picture-in-picture permission in Android settings.');
    }
  };
  const gestures = usePlayerGestures({ stage: stageTouches, width, onTap: () => setControls(visible => !visible), seekBy: delta => p.seek(p.position + delta), volume: () => p.player.volume, setVolume: value => { p.player.volume = value; } });
  tapRef.current = gestures.tap;
  useEffect(() => { sleep.check(); }, [p.position, sleep.check]);
  const editing = useSkipEditing({ base, item, queue, markers: p.markers, position: p.position, duration: p.info?.duration || 0, applyMarkers: p.applyMarkers });
  const creditsNext = showCreditsNext(p.markers, p.position, p.info?.duration || 0, hasNext);
  const subStyle = parseSubtitleStyle(p.settings.subtitles), styled = p.settings.subtitles ? subtitleTextStyle(subStyle) : null;
  const changeSubtitleStyle = (change: Partial<typeof subStyle>) => setPreference({ subtitles: { ...(typeof p.settings.subtitles === 'object' ? p.settings.subtitles : {}), ...subStyle, ...change } });
  const setPreference = (patch: Partial<Preferences>) => { p.setPreference(patch); onPreferences(patch); };
  const changeQueue = (next: Item[]) => onQueue(next);
  const videoAspect = p.info?.video?.width && p.info.video.height ? p.info.video.width / p.info.video.height : 16 / 9;
  const pictureHeight = fit === 'cover' ? height : Math.min(height, width / videoAspect);
  // Captions and the Skip pill keep one place. They rise only when the controls (or the pills) would cover them, and glide on the player's curve.
  const controlsHeight = controlsTop !== null ? height - controlsTop : insets.bottom + 100;
  const pills = (segment ? 1 : 0) + (creditsNext ? 1 : 0), skipBottom = controlsHeight + 12, skipTop = height - skipBottom - pills * 50 - (pills > 1 ? 8 : 0);
  const captionTop = Math.max(insets.top + 12, controls ? headerEnd + 8 : 0);
  const pictureBottom = (height - pictureHeight) / 2 + pictureHeight * .06;
  const captionBottom = Math.max(insets.bottom + 16, pictureBottom);
  const captionLeft = insets.left + 12, captionRight = insets.right + 12;
  const captionWidth = Math.max(0, width - captionLeft - captionRight), captionHeight = Math.max(0, height - captionTop - captionBottom);
  const captionLineHeight = Math.min(27 * p.subtitleSize, Math.max(16, captionHeight / 2));
  const captionY = subtitleOffset(subtitlePosition.y, captionHeight, captionSize.height);
  const lift = captionLift(captionTop + captionY + captionSize.height, [controls && controlsTop !== null ? controlsTop - 8 : null, pills ? skipTop - 8 : null]);
  const captionShift = useGlide(-lift, motion.base), fade = useGlide(controls ? 1 : 0, motion.quick);
  const allSubs = p.info ? subtitleTracks(p.info) : [];
  const open = (panel: NonNullable<typeof sheet>) => { setControls(true); setSheet(panel); };
  const meta = metadataFor(data, item);
  const subtitle = item.kind === 'show' ? `${nameFor(data, item)} · S${item.season} E${item.episode}` : movieFacts({ year: meta.year, runtime: meta.runtime, duration, kind: item.kind });
  return <View style={s.fill}>
    <VideoView ref={videoView} player={p.player} nativeControls={false} contentFit={fit} fullscreenOptions={{ enable: false }} focusable={isAndroidTv ? false : undefined} style={StyleSheet.absoluteFill}
      allowsPictureInPicture={p.allowPiP} startsPictureInPictureAutomatically={p.autoPiP}
      onPictureInPictureStart={() => { p.pictureInPicture.started(); setSheet(null); }}
      onPictureInPictureStop={() => { p.pictureInPicture.stopped(); setControls(true); }} />
    {isAndroidTv ? (!controls && <View style={[s.showControls, { bottom: Math.max(16, insets.bottom) }]}><Pill label="Show controls" compact preferredFocus onPress={() => setControls(true)} /></View>)
      : <Pressable style={StyleSheet.absoluteFill} {...gestures.bind} accessibilityLabel="Show or hide playback controls" />}
    {p.caption && captionHeight >= captionLineHeight + 4 && <Animated.View pointerEvents="none" style={[s.captionArea, { top: captionTop, bottom: captionBottom, left: captionLeft, right: captionRight, transform: [{ translateY: captionShift }] }]}>
      <Text onLayout={({ nativeEvent: { layout } }) => setCaptionSize({ width: layout.width, height: layout.height })}
        numberOfLines={Math.floor((captionHeight - 4) / captionLineHeight)} style={[s.caption, styled, {
          transform: [{ translateX: subtitleOffset(subtitlePosition.x, captionWidth, captionSize.width) }, { translateY: captionY }],
          maxWidth: Math.min(captionWidth, width * (landscape ? .8 : .92)), fontSize: captionLineHeight * 20 / 27, lineHeight: captionLineHeight,
        }]}>{p.caption.trim()}</Text>
    </Animated.View>}
    {(!isAndroidTv || controls) && <Animated.View pointerEvents={controls ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, { opacity: isAndroidTv ? 1 : fade }]}>
      <LinearGradient pointerEvents="none" colors={[chrome.fadeStart, 'transparent']} style={[s.topFade, { height: insets.top + 120 }]} />
      <View onLayout={({ nativeEvent: { layout } }) => setHeaderEnd(layout.y + layout.height)} style={[s.top, { top: landscape ? 8 : insets.top + 12, left: Math.max(14, insets.left), right: Math.max(14, insets.right) }]}>
        <IconButton name="back" label="Back to library" onPress={() => void leave()} />
        <View style={{ flex: 1, gap: 4 }}><Text numberOfLines={1} style={s.playerTitle}>{title}</Text><Text numberOfLines={1} style={s.playerSubtitle}>{subtitle}</Text></View>
        {isAndroidTv ? <Pill label="Hide controls" compact onPress={() => setControls(false)} />
          : <IconButton name="fullscreen" label={landscape ? 'Exit fullscreen' : 'Fullscreen'} onPress={toggleFullscreen} />}
      </View>
      {!p.busy && !p.error ? <View pointerEvents="box-none" style={s.center}>
        <Transport playing={p.playing} hasPrevious={hasPrevious} hasNext={hasNext} landscape={landscape} onPrevious={() => void select(queue[queueIndex - 1])} onNext={() => void select(queue[queueIndex + 1])} onSkip={skip} onToggle={() => { setControls(true); p.toggle(); }} />
      </View> : null}
      <LinearGradient pointerEvents="none" colors={['transparent', chrome.fadeEnd]} style={[s.bottomFade, { height: (landscape ? 120 : 150) + insets.bottom }]} />
      <View onLayout={({ nativeEvent }) => setControlsTop(nativeEvent.layout.y)} style={[s.controls, { left: Math.max(14, insets.left), right: Math.max(14, insets.right), bottom: landscape ? Math.max(6, insets.bottom) : insets.bottom + 8 }]}>
        {isAndroidTv ? <View style={s.tvSeek}>
          <Pill label="−30 s" compact disabled={!duration} onPress={() => skip(-30)} />
          <View style={{ flex: 1 }}><ProgressBar onArt value={duration ? p.position / duration : 0} /></View>
          <Pill label="+30 s" compact disabled={!duration} onPress={() => skip(30)} />
        </View> : <SeekBar duration={duration} position={p.position} buffered={p.buffered} scrub={scrub} chapters={p.info?.chapters} markers={p.markers} frames={!offline && p.info?.video ? { base, headers, id: item.id } : null}
          onScrubStart={() => setControls(true)} onScrub={setScrub} onSeek={p.seek} />}
        <UtilityRow rate={p.rate} panel={sheet} landscape={landscape} onPanel={open} onPiP={p.allowPiP ? enterPictureInPicture : undefined} pipDisabled={p.busy || !!p.error} />
      </View>
    </Animated.View>}
    <PlayerStatus busy={p.busy} error={p.error} onRetry={p.retry} onCancel={() => void leave()} />
    {indicator || gestures.label ? <View pointerEvents="none" style={[s.fitIndicator, { top: landscape ? 62 : insets.top + 68 }]}>
      <Text accessibilityLiveRegion="polite" style={s.indicatorLabel}>{indicator || gestures.label}</Text>
    </View> : null}
    {pills ? <View style={{ position: 'absolute', right: Math.max(18, insets.right), bottom: skipBottom, gap: 8, alignItems: 'flex-end' }}>
      {creditsNext ? <Pill label="Next episode" primary onPress={() => void select(queue[queueIndex + 1])} /> : null}
      {segment ? <Pill label={`Skip ${segment.type}`} onPress={() => { setControls(true); p.seek(segment.end); }} /> : null}
    </View> : null}
    <PlayerSheet open={!!sheet} landscape={landscape} height={height} onClose={() => setSheet(null)}
      title={sheet === 'tracks' ? 'Audio and subtitles' : sheet === 'more' ? 'Playback' : sheet === 'speed' ? 'Playback speed' : 'Queue'}
      closeLabel={sheet === 'tracks' ? 'Close audio and subtitles' : sheet === 'more' ? 'Close playback settings' : sheet === 'speed' ? 'Close playback speed' : 'Close queue'}>
      {sheet === 'speed' ? <ChipRow>{speeds.map(rate => <Chip key={rate} label={speedLabel(rate)} accessibilityLabel={`Speed ${speedLabel(rate)}`} selected={p.rate === rate} onPress={() => { p.setSpeed(rate); setSheet(null); }} />)}</ChipRow>
        : sheet === 'tracks' ? <TracksSheet audio={p.info?.audio || []} audioIndex={p.audio} onAudio={p.chooseAudio} subtitles={allSubs} subtitleIndex={p.subtitle} onSubtitle={p.chooseSubtitle}
          diagnostics={p.diagnostics} qualities={p.qualities} quality={p.quality} onQuality={p.chooseQuality} audioDelay={p.audioDelay} onAudioDelay={p.setAudioDelay}
          delay={p.delay} onDelay={p.setDelay} size={p.subtitleSize} onSize={p.setSubtitleSize} bitmap={bitmap} position={subtitlePosition} onPosition={setSubtitlePosition} style={subStyle} onStyle={changeSubtitleStyle} />
        : sheet === 'more' ? <PlaybackSheet chapters={p.info?.chapters} markers={p.markers} position={p.position} isShow={item.kind === 'show'} canEdit={!offline} editing={editing}
          autoSkip={p.settings.autoSkip === true} onAutoSkip={value => setPreference({ autoSkip: value })} sleep={sleep.mode} onSleep={sleep.choose} background={background} onBackground={setBackground} onSeek={time => { setSheet(null); p.seek(time); }} />
        : <UpNextSheet base={base} headers={headers} data={data} item={item} queue={queue} autoplay={p.settings.autoplay !== false} canEdit={!offline} onAutoplay={value => setPreference({ autoplay: value })}
          onPlay={entry => void select(entry)} onComplete={onComplete} onRemove={entry => changeQueue(queue.filter(i => i.id !== entry.id))} onClearWatched={() => changeQueue(queue.filter(i => i.id === item.id || !data.progress[i.id]?.completed))} />}
    </PlayerSheet>
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: chrome.video }, topFade: { position: 'absolute', top: 0, left: 0, right: 0 }, top: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8 }, playerTitle: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 }, playerSubtitle: { color: colors.dim, fontFamily: fonts.regular, fontSize: 12 },
  tvSeek: { flexDirection: "row", alignItems: "center", gap: 12 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0 }, controls: { position: 'absolute' }, center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  fitIndicator: { position: 'absolute', alignSelf: 'center', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: chrome.glass, borderWidth: 1, borderColor: chrome.glassLine }, indicatorLabel: { color: colors.text, fontFamily: fonts.regular, fontSize: 14 },
  captionArea: { position: 'absolute', overflow: 'hidden' }, caption: { position: 'absolute', top: 0, left: 0, color: colors.primary, fontFamily: fonts.medium, backgroundColor: colors.inputFill, textAlign: 'center', includeFontPadding: false, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 3, textShadowColor: colors.ground, textShadowRadius: 3 },
});

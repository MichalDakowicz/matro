import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { formatTime } from '../../../../packages/core/client/library';
import type { Segment } from '../lib/server';
import { colors, fonts, themed } from '../theme';
import { chrome } from './playerTheme';
import type { Chapter } from './playerTools';
import { SeekBubble, SeekMarks, SeekPreview } from './SeekExtras';

type Props = {
  duration: number; position: number; buffered: number; scrub: number | null; chapters?: Chapter[]; markers: Segment[];
  /** Set when the server can draw a frame for the scrubbed time; otherwise the bubble shows the time alone. */
  frames: { base: string; headers: Record<string, string>; id: string } | null;
  onScrubStart: () => void; onScrub: (time: number | null) => void; onSeek: (time: number) => void;
};

/** One 44 dp row: elapsed time, the seeker, total time. Scrubbing raises a bubble (a frame when there is one) over the thumb. */
export function SeekBar({ duration, position, buffered, scrub, chapters, markers, frames, onScrubStart, onScrub, onSeek }: Props) {
  const [width, setWidth] = useState(0), dragging = useRef(false), shown = scrub ?? position;
  return <View style={s.row}>
    <Text style={[s.time, { textAlign: 'left' }]}>{formatTime(shown)}</Text>
    <View onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)} style={s.seeker}>
      {scrub !== null ? frames ? <SeekPreview base={frames.base} headers={frames.headers} id={frames.id} time={scrub} duration={duration} width={width} chapters={chapters} /> : <SeekBubble time={scrub} duration={duration} width={width} chapters={chapters} /> : null}
      <View pointerEvents="none" style={s.bufferTrack}><View style={{ height: 3, width: `${duration ? Math.min(100, buffered / duration * 100) : 0}%`, backgroundColor: chrome.buffer }} /></View>
      <SeekMarks duration={duration} chapters={chapters} markers={markers} />
      <Slider accessibilityLabel="Seek" accessibilityValue={{ text: `${formatTime(shown)} of ${formatTime(duration)}` }} minimumValue={0} maximumValue={duration || 1} value={shown} minimumTrackTintColor={colors.primary} maximumTrackTintColor={chrome.track} thumbTintColor={colors.primary} step={.1} style={s.slider}
        onSlidingStart={value => { dragging.current = true; onScrubStart(); onScrub(value); }} onValueChange={value => { if (dragging.current) onScrub(value); }} onSlidingComplete={value => { dragging.current = false; onScrub(null); onSeek(value); }} />
    </View>
    <Text style={[s.time, { textAlign: 'right' }]}>{formatTime(duration)}</Text>
  </View>;
}

const s = themed(() => StyleSheet.create({
  row: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  seeker: { flex: 1, height: 44, justifyContent: 'center' },
  slider: { height: 44, marginHorizontal: -13 },
  bufferTrack: { position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: chrome.fillOn },
  time: { width: 54, fontSize: 12, fontFamily: fonts.mono, color: colors.muted, fontVariant: ['tabular-nums'] },
}));

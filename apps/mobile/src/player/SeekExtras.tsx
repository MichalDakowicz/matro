import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { Segment } from '../lib/server';
import { formatTime } from '../../../../packages/core/client/library';
import { colors, fonts, themed } from '../theme';
import { chrome } from './playerTheme';
import { chapterIndex, framePath, type Chapter } from './playerTools';

const markerTint: Record<Segment['type'], string> = { intro: colors.good, recap: colors.warn, outro: colors.text };

/** Ticks for chapters and tinted ranges for intro, recap and outro, drawn over the seek track. */
export function SeekMarks({ duration, chapters, markers }: { duration: number; chapters?: Chapter[]; markers: Segment[] }) {
  if (!duration) return null;
  const at = (time: number) => `${Math.max(0, Math.min(100, time / duration * 100))}%` as const;
  return <View pointerEvents="none" style={s.marks}>
    {markers.map((marker, index) => <View key={`m${index}`} style={[s.range, { left: at(marker.start), width: `${Math.max(.6, (Math.min(marker.end, duration) - marker.start) / duration * 100)}%`, backgroundColor: markerTint[marker.type] }]} />)}
    {(chapters || []).slice(1).map((chapter, index) => <View key={`c${index}`} style={[s.tick, { left: at(chapter.start) }]} />)}
  </View>;
}

/** A time pill above the thumb while scrubbing, with the chapter name when there is one. Used when there is no frame to show. */
export function SeekBubble({ time, duration, width, chapters }: { time: number; duration: number; width: number; chapters?: Chapter[] }) {
  const [size, setSize] = useState(0), center = duration ? time / duration * width : 0, left = Math.max(0, Math.min(width - size, center - size / 2));
  const chapter = chapters?.[chapterIndex(chapters, time)];
  return <View pointerEvents="none" onLayout={({ nativeEvent }) => setSize(nativeEvent.layout.width)} style={[s.bubble, { left }]}>
    <Text style={s.previewTime}>{formatTime(time)}</Text>
    {chapter?.title ? <Text numberOfLines={1} style={s.previewChapter}>{chapter.title}</Text> : null}
  </View>;
}

/** A frame from the server above the seek bar while scrubbing, with the chapter name when there is one. */
export function SeekPreview({ base, headers, id, time, duration, width, chapters }: { base: string; headers: Record<string, string>; id: string; time: number; duration: number; width: number; chapters?: Chapter[] }) {
  // Dragging sends many values; only the last one settles into a request.
  const [settled, setSettled] = useState(time), [failed, setFailed] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSettled(time), 120); return () => clearTimeout(timer); }, [time]);
  useEffect(() => setFailed(false), [id]);
  const boxWidth = 168, center = duration ? time / duration * width : 0, left = Math.max(0, Math.min(width - boxWidth, center - boxWidth / 2));
  const chapter = chapters?.[chapterIndex(chapters, time)];
  return <View pointerEvents="none" style={[s.preview, { left, width: boxWidth }]}>
    {failed ? null : <Image accessibilityLabel="Preview frame" source={{ uri: base + framePath(id, settled), headers }} resizeMode="cover" onError={() => setFailed(true)} style={s.frame} />}
    <Text style={s.previewTime}>{formatTime(time)}</Text>
    {chapter?.title ? <Text numberOfLines={1} style={s.previewChapter}>{chapter.title}</Text> : null}
  </View>;
}

const s = themed(() => StyleSheet.create({
  marks: { position: 'absolute', left: 0, right: 0, height: 3, flexDirection: 'row' },
  range: { position: 'absolute', top: 0, height: 3, opacity: .85 },
  tick: { position: 'absolute', top: -4, width: 2, height: 11, borderRadius: 1, backgroundColor: chrome.tick },
  preview: { position: 'absolute', bottom: 48, alignItems: 'center', gap: 2, padding: 6, borderRadius: 14, backgroundColor: chrome.glass, borderWidth: 1, borderColor: chrome.glassLine },
  bubble: { position: 'absolute', bottom: 48, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: chrome.glass, borderWidth: 1, borderColor: chrome.glassLine },
  frame: { width: 156, height: 88, borderRadius: 8, backgroundColor: chrome.video },
  previewTime: { color: colors.text, fontFamily: fonts.mono, fontSize: 12 }, previewChapter: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11, maxWidth: 156 },
}));

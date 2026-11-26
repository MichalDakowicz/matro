import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable, isAndroidTv } from '../components/TvFocus';
import Slider from '@react-native-community/slider';
import { Icon, styles as t } from '../components/Matro';
import type { Track } from '../lib/server';
import { languageName } from '../../../../packages/core/client/library';
import { colors, fonts, themed } from '../theme';
import { HoldStepper } from './HoldStepper';
import { chrome } from './playerTheme';
import { delayLabel, previewFontSize, sizeLabel, trackName } from './playerView';
import { Chip, ChipRow, Section } from './sheetParts';
import { SubtitlePositionControls } from './SubtitlePositionControls';
import { SubtitleStyleControls } from './SubtitleStyleControls';
import { subtitleTextStyle, type SubtitleStyle } from './subtitleStyle';
import type { SubtitlePosition } from './subtitlePosition';

type Row = Pick<Track, 'index' | 'language' | 'title' | 'codec' | 'channels'>;
type Props = {
  audio: Row[]; audioIndex: number | null; onAudio: (index: number) => void;
  subtitles: Row[]; subtitleIndex: number | null; onSubtitle: (index: number | null) => void;
  delay: number; onDelay: (delay: number) => void; size: number; onSize: (size: number) => void; bitmap: boolean;
  diagnostics?: { mode: string; reason: string } | null;
  qualities: { id: string; label: string }[]; quality: string; onQuality: (id: string) => void;
  audioDelay: number; onAudioDelay: (delay: number) => void;
  position: SubtitlePosition; onPosition: (position: SubtitlePosition) => void; style: SubtitleStyle; onStyle: (change: Partial<SubtitleStyle>) => void;
};

function TrackRow({ track, position, selected, onPress }: { track: Row; position: number; selected: boolean; onPress: () => void }) {
  const detail = [track.codec?.toUpperCase(), track.channels ? `${track.channels} channels` : ''].filter(Boolean).join(' · ');
  return <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }} style={[s.track, selected && s.selected]}>
    <View style={{ flex: 1 }}><Text style={[t.text, { fontFamily: fonts.medium }]}>{trackName(track.language, position, languageName)}</Text>{track.title ? <Text style={[t.dim, { marginTop: 3 }]}>{track.title}</Text> : null}{detail ? <Text style={[t.dim, { fontSize: 11, marginTop: 4 }]}>{detail}</Text> : null}</View>
    {selected && <Icon name="check" size={18} />}
  </Pressable>;
}

/** Audio and Subtitles on their own tabs; delay, size, position and style sit under Subtitles, away from the audio list. */
export function TracksSheet({ audio, audioIndex, onAudio, subtitles, subtitleIndex, onSubtitle, delay, onDelay, size, onSize, bitmap, diagnostics, qualities, quality, onQuality, audioDelay, onAudioDelay, position, onPosition, style, onStyle }: Props) {
  const [tab, setTab] = useState<'audio' | 'subtitles'>('audio'), [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? size;
  return <View style={{ flexShrink: 1 }}>
    <View accessibilityRole="tablist" style={s.tabs}>
      {(['audio', 'subtitles'] as const).map(id => <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={[s.tab, tab === id && s.tabOn]}>
        <Text style={[s.tabLabel, tab === id && { color: colors.onPrimary }]}>{id === 'audio' ? 'Audio' : 'Subtitles'}</Text>
      </Pressable>)}
    </View>
    <ScrollView showsVerticalScrollIndicator={false}>
      {tab === 'audio' ? <>
        {diagnostics && <Section title={`Playback info · ${diagnostics.mode}`}><Text style={t.muted}>{diagnostics.reason}</Text></Section>}
        {qualities.length > 0 && <Section title="Quality"><ChipRow>{qualities.map(tier => <Chip key={tier.id} label={tier.label} selected={tier.id === quality} onPress={() => onQuality(tier.id)} />)}</ChipRow></Section>}
        {audio.length ? audio.map((track, index) => <TrackRow key={track.index} track={track} position={index + 1} selected={audioIndex === track.index} onPress={() => onAudio(track.index)} />) : <Text style={t.dim}>No audio tracks available.</Text>}
        <Section title="Audio timing"><HoldStepper label="Audio delay" value={delayLabel(audioDelay)} minusLabel="Audio earlier" plusLabel="Audio later" onStep={direction => onAudioDelay(audioDelay + direction * .1)} onReset={audioDelay ? () => onAudioDelay(0) : undefined} /></Section>
      </> : <>
        <Pressable onPress={() => onSubtitle(null)} accessibilityRole="radio" accessibilityState={{ checked: subtitleIndex === null }} style={[s.track, subtitleIndex === null && s.selected]}><Text style={[t.text, { flex: 1 }]}>Off</Text>{subtitleIndex === null && <Icon name="check" size={18} />}</Pressable>
        {subtitles.map((track, index) => <TrackRow key={track.index} track={track} position={index + 1} selected={subtitleIndex === track.index} onPress={() => onSubtitle(track.index)} />)}
        <Section title="Timing">
          <HoldStepper label="Subtitle delay" value={delayLabel(delay)} minusLabel="Subtitles earlier" plusLabel="Subtitles later" onStep={direction => onDelay(delay + direction * .1)} onReset={delay ? () => onDelay(0) : undefined} />
        </Section>
        <Section title="Size">
          <View style={s.sizeRow}>
            {isAndroidTv ? <HoldStepper label="Subtitle size" value={sizeLabel(size)} minusLabel="Decrease subtitle size" plusLabel="Increase subtitle size" onStep={direction => onSize(Math.max(.6, Math.min(1.8, size + direction * .1)))} /> : <><Slider accessibilityLabel="Subtitle size" accessibilityValue={{ text: sizeLabel(shown) }} style={{ flex: 1, height: 44 }} minimumValue={.6} maximumValue={1.8} step={.05} value={size} minimumTrackTintColor={colors.primary} maximumTrackTintColor={chrome.track} thumbTintColor={colors.primary}
              onValueChange={setDraft} onSlidingComplete={value => { setDraft(null); onSize(value); }} />
            <Text style={s.readout}>{sizeLabel(shown)}</Text></>}
          </View>
          <View style={s.preview}><Text style={[s.sample, subtitleTextStyle(style, colors.ground), { fontSize: previewFontSize(shown), lineHeight: Math.round(previewFontSize(shown) * 1.35) }]}>Sample caption</Text></View>
          {size !== 1 ? <ChipRow><Chip label="Reset size" onPress={() => { setDraft(null); onSize(1); }} /></ChipRow> : null}
        </Section>
        <Section title="Position">{bitmap ? <Text style={t.dim}>Position is available for text subtitles.</Text> : <SubtitlePositionControls position={position} onChange={onPosition} />}</Section>
        <Section title="Style"><SubtitleStyleControls style={style} onChange={onStyle} disabled={bitmap} /></Section>
        <View style={{ height: 18 }} />
      </>}
    </ScrollView>
  </View>;
}

const s = themed(() => StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: { flex: 1, minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: chrome.line, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary }, tabLabel: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
  track: { minHeight: 52, borderRadius: 9, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 }, selected: { backgroundColor: chrome.fill },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, readout: { width: 48, textAlign: 'right', color: colors.text, fontFamily: fonts.mono, fontSize: 13 },
  preview: { minHeight: 76, borderRadius: 12, backgroundColor: chrome.video, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, overflow: 'hidden' },
  sample: { color: colors.primary, fontFamily: fonts.medium, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 3, textAlign: 'center' },
}));

import { Pressable, ScrollView, Text, View } from 'react-native';
import { formatTime } from '../../../../packages/core/client/library';
import { styles as t } from '../components/Matro';
import { colors, fonts } from '../theme';
import type { Segment } from '../lib/server';
import { Chip, ChipRow, Section, SwitchRow } from './sheetParts';
import { chapterIndex, sleepModes, type Chapter, type SleepMode } from './playerTools';
import type { useSkipEditing } from './useSkipEditing';

type Editing = ReturnType<typeof useSkipEditing>;
type Props = {
  chapters?: Chapter[]; markers: Segment[]; position: number; isShow: boolean; canEdit: boolean;
  editing: Editing; autoSkip: boolean; onAutoSkip: (value: boolean) => void;
  sleep: SleepMode; onSleep: (mode: SleepMode) => void;
  background: boolean; onBackground: (value: boolean) => void;
  onSeek: (time: number) => void;
};

/** Chapters, skip-range editing, auto-skip, sleep timer and background audio: the "more" sheet of the native player. */
export function PlaybackSheet({ chapters, markers, position, isShow, canEdit, editing, autoSkip, onAutoSkip, sleep, onSleep, background, onBackground, onSeek }: Props) {
  const current = chapterIndex(chapters, position);
  return <ScrollView showsVerticalScrollIndicator={false}>
    {chapters?.length ? <Section title="Chapters">
      {chapters.map((chapter, index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={`Jump to ${chapter.title || `chapter ${index + 1}`} at ${formatTime(chapter.start)}`} onPress={() => onSeek(chapter.start)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, borderRadius: 10, backgroundColor: index === current ? '#ffffff0e' : 'transparent' }}>
        <Text style={[t.mono, { width: 52 }]}>{formatTime(chapter.start)}</Text><Text style={[t.text, { flex: 1 }]} numberOfLines={1}>{chapter.title || `Chapter ${index + 1}`}</Text>
      </Pressable>)}
    </Section> : null}

    <Section title="Skip segments">
      <SwitchRow label="Auto-skip intros and recaps" hint="Jumps past them while playing" value={autoSkip} onChange={onAutoSkip} />
      {markers.length ? markers.map((marker, index) => <View key={index} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={[t.text, { width: 56, textTransform: 'capitalize' }]}>{marker.type}</Text>
        <Text style={[t.mono, { flex: 1 }]}>{formatTime(marker.start)} – {formatTime(marker.end)} · {marker.source === 'automatic' ? 'Detected' : 'Manual'}</Text>
        <Chip label="Jump" accessibilityLabel={`Jump to ${marker.type} marker`} onPress={() => onSeek(marker.start)} />
        {canEdit ? <Chip label="Remove" accessibilityLabel={`Remove ${marker.type} marker`} disabled={editing.busy} onPress={() => void editing.remove(marker)} /> : null}
      </View>) : <Text style={t.dim}>No skip ranges for this file yet.</Text>}
      {canEdit ? editing.draft
        ? <View style={{ gap: 10 }}>
          <Text style={t.muted}>{editing.draft.type} starts at {formatTime(editing.draft.start)}. Seek to where it ends, then save.</Text>
          <ChipRow><Chip label="Save end here" selected disabled={editing.busy} onPress={() => void editing.saveEnd()} /><Chip label="Cancel" onPress={editing.cancel} /></ChipRow>
        </View>
        : <ChipRow>{editing.markerTypes.map(type => <Chip key={type} label={`Mark ${type} start`} onPress={() => editing.begin(type)} />)}</ChipRow>
        : <Text style={t.dim}>Marks can be edited while online.</Text>}
      {canEdit && isShow && markers.some(marker => marker.source === 'manual') ? <Chip label="Apply manual marks to this season" disabled={editing.busy} onPress={() => void editing.applyToSeason()} /> : null}
      {editing.status ? <Text accessibilityLiveRegion="polite" style={[t.dim, { color: colors.muted, fontFamily: fonts.regular }]}>{editing.status}</Text> : null}
    </Section>

    <Section title="Sleep timer">
      <ChipRow>{sleepModes.map(({ mode, label }) => <Chip key={mode} label={label} selected={sleep === mode} onPress={() => onSleep(mode)} />)}</ChipRow>
    </Section>

    <Section title="Background audio">
      <SwitchRow label="Keep playing with the screen off" hint="Shows a media notification. Off by default." value={background} onChange={onBackground} />
    </Section>
    <View style={{ height: 18 }} />
  </ScrollView>;
}

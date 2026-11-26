import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Item, Library } from '../lib/server';
import { episodeName, formatTime, metadataFor, nameFor } from '../../../../packages/core/client/library';
import { dayLabel, watchHistory } from '../../../../packages/core/client/watch-progress.js';
import { cleanEpisodeName, plural } from '../lib/text';
import { colors, fonts, radius, themed } from '../theme';
import { Chip, MediaArt, SectionLabel, styles as t } from '../components/Matro';
import type { ArtProps } from '../components/LibraryParts';

type Props = ArtProps & { data: Library; layout: { top: number; bottom: number }; onOpen: (item: Item) => void };
const PERIODS = [[7, 'Last 7 days'], [30, 'Last 30 days'], [0, 'All time']] as const;

/** What was played and when, newest first, from the same per-account progress that drives Continue watching. */
export default function HistoryScreen({ data, layout, onOpen, ...art }: Props) {
  const [days, setDays] = useState<number>(7);
  const rows = useMemo(() => watchHistory(data.items, data.progress, { since: days ? Date.now() - days * 864e5 : 0 }), [data.items, data.progress, days]);
  const artFor = (item: Item) => { const m = metadataFor(data, item); return m.episodes?.[String(item.season)]?.[String(item.episode)]?.still || m.backdrop || m.poster; };
  let last = '';
  return <ScrollView contentContainerStyle={{ paddingTop: layout.top + 76, paddingBottom: layout.bottom + 120, paddingHorizontal: 18 }} showsVerticalScrollIndicator={false}>
    <Text accessibilityRole="header" style={t.heading}>Watch history</Text>
    {rows.length > 0 && <Text style={[t.muted, { marginTop: 2 }]}>{plural(rows.length, 'item')} played</Text>}
    <View style={[t.row, { gap: 8, marginTop: 16 }]}>{PERIODS.map(([value, label]) => <Chip key={value} small label={label} selected={days === value} onPress={() => setDays(value)} />)}</View>
    {rows.map(({ item, entry, at }) => {
      const label = dayLabel(at), heading = label !== last ? <SectionLabel>{label}</SectionLabel> : null; last = label;
      const name = nameFor(data, item), title = item.kind === 'show' ? cleanEpisodeName(episodeName(data, item), name, item.episode) : name;
      const when = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const state = entry.completed ? 'Finished' : `Stopped at ${formatTime(entry.position)}`;
      return <View key={item.id}>{heading}
        <Pressable onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={`Open ${name}`} style={({ pressed }) => [s.row, pressed && { opacity: .7 }]}>
          <MediaArt {...art} quiet path={artFor(item)} title={name} style={{ width: 96, height: 54, borderRadius: radius.poster }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[t.dim, { fontFamily: fonts.medium }]} numberOfLines={1}>{item.kind === 'show' ? `${name} · S${item.season} E${item.episode}` : 'Movie'}</Text>
            <Text style={[t.text, { fontSize: 15, fontFamily: fonts.semibold }]} numberOfLines={1}>{title}</Text>
            <Text style={t.dim}>{when} · {state}</Text>
          </View>
        </Pressable>
      </View>;
    })}
    {!rows.length && <View style={s.empty}><Text style={[t.muted, { textAlign: 'center' }]}>{days ? 'Nothing played in this period.' : 'Your watch history is empty.'}</Text></View>}
  </ScrollView>;
}
const s = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 6 },
  empty: { marginTop: 24, padding: 24, alignItems: 'center', borderRadius: radius.sheet, backgroundColor: colors.fill },
}));

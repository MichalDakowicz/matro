import { Pressable, StyleSheet, Text, View } from 'react-native';
import { plural } from '../lib/text';
import { seedText, type ReleaseGroup } from '../lib/release-groups';
import { colors, fonts } from '../theme';
import { MediaArt, Pill, styles as t } from './Matro';
import type { ArtProps } from './LibraryParts';

export type DiscoveryView = { heading: string; groups: ReleaseGroup[]; pending: boolean; searched: boolean; warnings: string[]; error: string; limit: number; posters: Record<string, string> };
type Props = ArtProps & { view: DiscoveryView; cardWidth: number; onOpen: (group: ReleaseGroup) => void; onRetry: () => void; onMore: () => void };

/** Release groups from Prowlarr and the anime sources, as the web Downloads page shows them: one card per title, TMDB poster when it has one. */
export default function ReleaseCards({ base, headers, view, cardWidth, onOpen, onRetry, onMore }: Props) {
  const shown = view.groups.slice(0, view.limit), problem = view.error || view.warnings.join(' ');
  return <View style={{ marginTop: 26 }}>
    <View style={[t.sectionHeading, { marginBottom: 4 }]}><Text accessibilityRole="header" style={t.sectionTitle}>{view.heading}</Text>{view.searched && <Text style={t.dim}>{plural(view.groups.length, 'title')}</Text>}</View>
    {problem ? <View style={[t.row, { marginBottom: 10 }]}><Text accessibilityRole="alert" style={[t.muted, { color: colors.warn, flex: 1 }]}>{problem}</Text><Pill label="Retry" compact onPress={onRetry} /></View> : null}
    {shown.length ? <View style={s.grid}>{shown.map(group => {
      const best = group.releases[0];
      return <Pressable key={group.key} accessibilityRole="button" accessibilityLabel={`Open ${group.title}`} onPress={() => onOpen(group)} style={{ width: cardWidth, marginBottom: 22 }}>
        <MediaArt base={base} headers={headers} path={view.posters[group.key]} title={group.title} sheen style={{ width: cardWidth, height: cardWidth * 1.5, borderRadius: 8 }} />
        <Text numberOfLines={1} style={s.name}>{group.title}</Text>
        <Text numberOfLines={2} style={[t.dim, { fontSize: 11, marginTop: 3 }]}>{[group.year, plural(group.releases.length, 'release'), seedText(best.seeds)].filter(Boolean).join(' · ')}</Text>
      </Pressable>;
    })}</View> : <Text style={[t.muted, { marginVertical: 14 }]}>{view.pending ? 'Loading releases…' : view.searched ? 'No matching releases from these sources.' : 'Browse the most seeded releases or search a title.'}</Text>}
    {view.groups.length > view.limit && <Pill label="Show more titles" compact onPress={onMore} style={{ alignSelf: 'flex-start', marginBottom: 14 }} />}
  </View>;
}
const s = StyleSheet.create({ grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, name: { color: colors.text, fontFamily: fonts.medium, fontSize: 12.5, marginTop: 8 } });

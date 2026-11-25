import { FlatList, Pressable, Text, View } from 'react-native';
import { episodeName, metadataFor, nameFor } from '../../../../packages/core/client/library';
import { Icon, IconButton, MediaArt, styles as t } from '../components/Matro';
import type { Item, Library } from '../lib/server';
import type { ArtProps } from '../components/LibraryParts';
import { colors, fonts } from '../theme';
import { Chip, SwitchRow } from './sheetParts';

type Props = ArtProps & { data: Library; item: Item; queue: Item[]; autoplay: boolean; canEdit: boolean; onAutoplay: (value: boolean) => void; onPlay: (item: Item) => void; onRemove: (item: Item) => void; onComplete: (item: Item) => void; onClearWatched: () => void };

/** The queue sheet: play an entry, mark it watched, take it out, clear what is watched, and the autoplay switch. */
export function UpNextSheet({ base, headers, data, item, queue, autoplay, canEdit, onAutoplay, onPlay, onRemove, onComplete, onClearWatched }: Props) {
  const watched = (entry: Item) => !!data.progress[entry.id]?.completed;
  return <View style={{ flexShrink: 1 }}>
    <SwitchRow label="Autoplay next" hint="Plays the next episode when one ends" value={autoplay} onChange={onAutoplay} />
    {canEdit && queue.some(entry => watched(entry) && entry.id !== item.id) ? <Chip label="Clear watched" onPress={onClearWatched} /> : null}
    <FlatList data={queue} keyExtractor={entry => entry.id} showsVerticalScrollIndicator={false} renderItem={({ item: entry, index }) => {
      const label = entry.kind === 'show' ? episodeName(data, entry) : nameFor(data, entry), now = entry.id === item.id;
      return <View>
        {entry.kind === 'show' && (index === 0 || queue[index - 1].season !== entry.season) ? <Text style={{ fontSize: 14, color: colors.text, fontFamily: fonts.semibold, marginTop: 14, marginBottom: 10 }}>Season {entry.season}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, marginBottom: 5, backgroundColor: now ? '#ffffff0e' : 'transparent' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Play ${label}`} onPress={() => onPlay(entry)} style={{ flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center', padding: 8, minHeight: 58 }}>
            <MediaArt base={base} headers={headers} path={metadataFor(data, entry).episodes?.[String(entry.season)]?.[String(entry.episode)]?.still || metadataFor(data, entry).backdrop || metadataFor(data, entry).poster} style={{ width: 88, height: 50, borderRadius: 6 }} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[t.text, { fontSize: 13 }]} numberOfLines={2}>{entry.kind === 'show' ? `${entry.episode}. ${label}` : label}</Text>
              <Text style={[t.dim, { fontSize: 11 }]}>{now ? 'Now playing' : watched(entry) ? 'Watched' : entry.format}</Text>
            </View>
            {now && <Icon name="play" size={16} />}
          </Pressable>
          {canEdit && !now ? <>
            <IconButton name="check" label={`${watched(entry) ? 'Mark unwatched' : 'Mark watched'}: ${label}`} active={watched(entry)} onPress={() => onComplete(entry)} />
            <IconButton name="close" label={`Remove ${label} from the queue`} onPress={() => onRemove(entry)} />
          </> : null}
        </View>
      </View>;
    }} />
  </View>;
}

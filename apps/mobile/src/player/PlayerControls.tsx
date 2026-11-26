import { StyleSheet, Text, View } from 'react-native';
import { IconButton, SkipIcon, styles as t } from '../components/Matro';
import { isAndroidTv } from '../components/TvFocus';
import { colors, fonts, themed } from '../theme';
import { DOUBLE_TAP_SECONDS } from './playerTools';
import { speedLabel } from './playerView';

type Panel = 'tracks' | 'queue' | 'more' | 'speed' | null;

/** Previous, back 10 s, play, forward 10 s, next, centred over the picture. Skip matches double-tap. */
export function Transport({ playing, hasPrevious, hasNext, landscape, onPrevious, onNext, onSkip, onToggle }: { playing: boolean; hasPrevious: boolean; hasNext: boolean; landscape: boolean; onPrevious: () => void; onNext: () => void; onSkip: (seconds: number) => void; onToggle: () => void }) {
  const side = landscape ? 44 : 48;
  return <View pointerEvents="box-none" style={s.transport}>
    <IconButton name="prev" label="Previous in queue" disabled={!hasPrevious} size={side} onPress={onPrevious} />
    <IconButton label={`Back ${DOUBLE_TAP_SECONDS} seconds`} size={side} onPress={() => onSkip(-DOUBLE_TAP_SECONDS)}><SkipIcon back seconds={DOUBLE_TAP_SECONDS} /></IconButton>
    <IconButton name={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} size={landscape ? 56 : 64} preferredFocus={isAndroidTv} onPress={onToggle} />
    <IconButton label={`Forward ${DOUBLE_TAP_SECONDS} seconds`} size={side} onPress={() => onSkip(DOUBLE_TAP_SECONDS)}><SkipIcon seconds={DOUBLE_TAP_SECONDS} /></IconButton>
    <IconButton name="next" label="Next in queue" disabled={!hasNext} size={side} onPress={onNext} />
  </View>;
}

/** The one utility row: speed, audio and subtitles, queue, playback sheet. Icons only; each carries a screen-reader label. */
export function UtilityRow({ rate, panel, landscape, onPanel, onPiP, pipDisabled }: { rate: number; panel: Panel; landscape: boolean; onPanel: (panel: Exclude<Panel, null>) => void; onPiP?: () => void; pipDisabled?: boolean }) {
  return <View style={[s.utilities, landscape && { justifyContent: 'flex-end', gap: 12 }]}>
    <IconButton label={`Playback speed, ${speedLabel(rate)}`} active={panel === 'speed'} onPress={() => onPanel('speed')}><Text style={[t.text, s.rate]}>{speedLabel(rate)}</Text></IconButton>
    <IconButton name="tracks" label="Audio and subtitles" active={panel === 'tracks'} onPress={() => onPanel('tracks')} />
    <IconButton name="queue" label="Queue" active={panel === 'queue'} onPress={() => onPanel('queue')} />
    {onPiP && <IconButton name="pictureInPicture" label="Picture-in-picture" disabled={pipDisabled} onPress={onPiP} />}
    <IconButton name="more" label="Playback settings" active={panel === 'more'} onPress={() => onPanel('more')} />
  </View>;
}

const s = themed(() => StyleSheet.create({
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  utilities: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rate: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
}));

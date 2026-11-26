import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { Pill, styles as t } from '../components/Matro';
import { colors, themed } from '../theme';
import { parseSubtitlePosition, subtitlePresets, type SubtitlePosition } from './subtitlePosition';

const key = 'matro.subtitlePosition';

export function useSubtitlePosition() {
  const [position, setPosition] = useState(subtitlePresets.Bottom);
  const edited = useRef(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(key).then(saved => {
      if (active && !edited.current) setPosition(parseSubtitlePosition(saved));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const update = (next: SubtitlePosition) => {
    edited.current = true;
    setPosition(next);
    void AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
  };
  return [position, update] as const;
}

export function SubtitlePositionControls({ position, onChange }: { position: SubtitlePosition; onChange: (position: SubtitlePosition) => void }) {
  return <View style={s.settings}>
    <View style={s.row}>
      <Text style={t.muted}>Position</Text>
      <Pressable onPress={() => onChange(subtitlePresets.Bottom)} accessibilityRole="button" hitSlop={12}>
        <Text style={t.text}>Reset position</Text>
      </Pressable>
    </View>
    <View style={t.row}>
      {Object.entries(subtitlePresets).map(([label, preset]) => <Pill key={label} label={label} compact primary={position.x === preset.x && position.y === preset.y} onPress={() => onChange(preset)} />)}
    </View>
    {([['x', 'Horizontal'], ['y', 'Vertical']] as const).map(([axis, label]) => <View key={axis} style={s.row}>
      <Text style={t.muted}>{label}</Text>
      <Slider accessibilityLabel={`${label} subtitle position`} style={s.slider} minimumValue={0} maximumValue={100} step={1} value={position[axis]}
        minimumTrackTintColor={colors.primary} maximumTrackTintColor={colors.hairline} thumbTintColor={colors.primary}
        onValueChange={value => onChange({ ...position, [axis]: value })} />
    </View>)}
  </View>;
}

const s = themed(() => StyleSheet.create({
  settings: { gap: 6, borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: 12, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slider: { width: 170, height: 44 },
}));

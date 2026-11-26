import { Text, View } from 'react-native';
import { styles as t } from '../components/Matro';
import { Chip, ChipRow } from './sheetParts';
import { subtitleBackgrounds, subtitleEdges, subtitleFonts, type SubtitleStyle } from './subtitleStyle';

/** Font, background box, weight and edge for text subtitles. Size and position have their own controls. */
export function SubtitleStyleControls({ style, onChange, disabled }: { style: SubtitleStyle; onChange: (change: Partial<SubtitleStyle>) => void; disabled?: boolean }) {
  if (disabled) return <Text style={[t.dim, { marginBottom: 16 }]}>Style is available for text subtitles.</Text>;
  const group = (label: string, children: React.ReactNode) => <View style={{ gap: 8, marginBottom: 12 }}><Text style={t.muted}>{label}</Text><ChipRow>{children}</ChipRow></View>;
  return <View>
    {group('Font', subtitleFonts.map(font => <Chip key={font.id} label={font.label} accessibilityLabel={`Subtitle font ${font.label}`} selected={style.font === font.id} onPress={() => onChange({ font: font.id })} />))}
    {group('Background', subtitleBackgrounds.map(box => <Chip key={box.id} label={box.label} accessibilityLabel={`Subtitle background ${box.label}`} selected={style.background === box.id} onPress={() => onChange({ background: box.id })} />))}
    {group('Text', [<Chip key="bold" label="Bold" selected={style.bold} onPress={() => onChange({ bold: !style.bold })} />, <Chip key="italic" label="Italic" selected={style.italic} onPress={() => onChange({ italic: !style.italic })} />,
      ...subtitleEdges.map(edge => <Chip key={edge.id} label={edge.id === 'none' ? 'No edge' : edge.label} accessibilityLabel={`Subtitle edge ${edge.label}`} selected={style.edge === edge.id} onPress={() => onChange({ edge: edge.id })} />)])}
  </View>;
}

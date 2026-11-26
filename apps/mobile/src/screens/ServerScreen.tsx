import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { connect, ServerError, type Status } from '../lib/server';
import { loadServerHistory, removeServerFromHistory } from '../lib/storage';
import { serverHost } from '../lib/server-history';
import { IconButton } from '../components/Matro';
import { ErrorLine, Field, Page, PrimaryPill } from '../ui';
import { colors, fonts, themed } from '../theme';

type Props = { initial?: string; notice?: string; onConnected: (base: string, status: Status) => void };

/** First screen: where is your Matro server. */
export default function ServerScreen({ initial = '', notice = '', onConnected }: Props) {
  const [address, setAddress] = useState(initial);
  const [error, setError] = useState(notice);
  const [hint, setHint] = useState(notice ? 'Check the address below, or pick a server you used before.' : '');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => { void loadServerHistory().then(setHistory); }, []);

  async function go(target = address) {
    setError(''); setHint('');
    setBusy(true);
    try {
      const { base, status } = await connect(target);
      onConnected(base, status);
    } catch (e) {
      if (e instanceof ServerError && (e.status || /^Enter your server/.test(e.message))) {
        setError(e.message);
        if (/^Server answered \d+\.$/.test(e.message)) setHint('This does not look like a Matro server. Check the address.');
      } else {
        setError("Couldn't reach a Matro server at that address.");
        setHint('Check the address and that this phone can reach it. A local address like 192.168.1.5:8484 needs the same Wi-Fi as the server.');
      }
    } finally {
      setBusy(false);
    }
  }

  const forget = (base: string) => { setHistory(list => list.filter(entry => entry !== base)); void removeServerFromHistory(base); };

  return (
    <Page kicker="Matro · receiver" title="Connect to your server." lede="Enter the address of your Matro server, like matro.example.com or 192.168.1.5:8484.">
      <Field
        value={address}
        onChangeText={setAddress}
        placeholder="matro.example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        textContentType="URL"
        returnKeyType="go"
        onSubmitEditing={() => void go()}
        accessibilityLabel="Server address"
      />
      <ErrorLine text={error} hint={hint} />
      <PrimaryPill label="Connect" onPress={() => void go()} busy={busy} />
      {history.length > 0 && <View style={s.history}>
        <Text style={s.label}>Recent servers</Text>
        {history.map(base => <View key={base} style={s.row}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Connect to ${serverHost(base)}`} disabled={busy} onPress={() => { setAddress(serverHost(base)); void go(base); }} style={({ pressed }) => [s.entry, pressed && { opacity: .68 }]}>
            <Text style={s.host} numberOfLines={1}>{serverHost(base)}</Text>
          </Pressable>
          <IconButton name="close" size={44} label={`Forget ${serverHost(base)}`} onPress={() => forget(base)} />
        </View>)}
      </View>}
    </Page>
  );
}

const s = themed(() => StyleSheet.create({
  history: { marginTop: 20, gap: 4 },
  label: { fontFamily: fonts.mono, fontSize: 12, color: colors.dim, letterSpacing: 0.4, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.hairline },
  entry: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  host: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
}));

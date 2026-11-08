import { useState } from 'react';
import { connect, ServerError, type Status } from '../lib/server';
import { ErrorLine, Field, Page, PrimaryPill } from '../ui';

type Props = { initial?: string; notice?: string; onConnected: (base: string, status: Status) => void };

/** First screen: where is your Matro server. */
export default function ServerScreen({ initial = '', notice = '', onConnected }: Props) {
  const [address, setAddress] = useState(initial);
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);

  async function go() {
    setError('');
    setBusy(true);
    try {
      const { base, status } = await connect(address);
      onConnected(base, status);
    } catch (e) {
      setError(e instanceof ServerError ? e.message : "Couldn't reach a Matro server at that address.");
    } finally {
      setBusy(false);
    }
  }

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
        onSubmitEditing={go}
        accessibilityLabel="Server address"
      />
      <ErrorLine text={error} />
      <PrimaryPill label="Connect" onPress={go} busy={busy} />
    </Page>
  );
}

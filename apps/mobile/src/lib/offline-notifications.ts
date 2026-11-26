import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Notifications from 'expo-notifications';
import { requestAlertKind } from './movie-request-alerts';

const channelId = 'offline-downloads';
// Progress lives in a native foreground service: Android freezes a backgrounded app within seconds,
// which silently kills a plain JS download. Without the module (iOS, old builds) there is no progress notification.
type KeepAlive = { show(title: string, text: string, percent: number): boolean; hide(): void };
const keepAlive = Platform.OS === 'android' ? requireOptionalNativeModule<KeepAlive>('MatroKeepAlive') : null;
type Row = { title: string; text: string; percent: number };
const rows = new Map<string, Row>();
let shown = '', holds = 0;
let permission: Promise<boolean> | undefined;

Notifications.setNotificationHandler({
  handleNotification: async notification => {
    const request = notification.request.content.data?.kind === requestAlertKind;
    return { shouldShowBanner: request, shouldShowList: true, shouldPlaySound: request, shouldSetBadge: false };
  },
});
function allowed() {
  permission ??= (async () => {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(channelId, {
      name: 'Offline downloads', importance: Notifications.AndroidImportance.LOW, showBadge: false,
    });
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    // Earlier builds posted sticky per-title notifications that outlived their downloads.
    if (granted) {
      const stale = (await Notifications.getPresentedNotificationsAsync()).filter(n => n.request.identifier.startsWith('matro-offline-matro:'));
      await Promise.all(stale.map(n => Notifications.dismissNotificationAsync(n.request.identifier)));
    }
    return granted;
  })().catch(() => false);
  return permission;
}
function render() {
  if (!rows.size && !holds) { shown = ''; keepAlive?.hide(); return; }
  if (!rows.size) { const idle = JSON.stringify(['Saving offline', 'Getting the next title ready…', -1]); if (idle !== shown) { shown = idle; keepAlive?.show('Saving offline', 'Getting the next title ready…', -1); } return; }
  const list = [...rows.values()], [first] = list;
  const [title, text, percent] = list.length === 1 ? [`Saving ${first.title}`, first.text, first.percent] : [`Saving ${list.length} titles`, list.map(row => row.title).join(', '), list.every(row => row.percent >= 0) ? Math.round(list.reduce((sum, row) => sum + row.percent, 0) / list.length) : -1];
  const next = JSON.stringify([title, text, percent]);
  if (next === shown) return;
  shown = next; keepAlive?.show(title, text, percent);
}
const result = (identifier: string, title: string, body: string) => void allowed().then(async ok => {
  if (ok) await Notifications.scheduleNotificationAsync({ identifier, content: { title, body }, trigger: Platform.OS === 'android' ? { channelId } : null });
}).catch(() => {});

// A queue of downloads holds the service open so it survives the gap between one title and the next.
export function holdService() { holds++; render(); return () => { holds = Math.max(0, holds - 1); render(); }; }

export function offlineNotice(key: string, title: string) {
  const update = (text: string, percent: number) => { void allowed(); rows.set(key, { title, text, percent }); render(); };
  const clear = () => { rows.delete(key); render(); };
  return {
    // `fraction` is the server's transcode progress (0-1), or null when it is not known.
    preparing(fraction: number | null) { update(fraction === null ? 'Preparing on the server…' : `Preparing on the server · ${Math.round(fraction * 100)}%`, fraction === null ? -1 : Math.round(fraction * 100)); },
    progress(have: number, total: number) { update(total ? `${Math.min(99, Math.floor(have / total * 100))}%` : 'Starting…', total ? Math.min(99, Math.floor(have / total * 100)) : -1); },
    done() { clear(); result('matro-offline-result-' + key, `${title} is ready offline`, 'Saved on this device.'); },
    failed(reason: string) { clear(); result('matro-offline-result-' + key, `Could not finish saving ${title}`, reason); },
    dismiss: clear,
  };
}

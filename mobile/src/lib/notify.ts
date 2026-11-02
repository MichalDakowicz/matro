import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { noticeText, parseDownloadMessage } from './downloadNotice';

const CHANNEL = 'downloads';
let ready: Promise<boolean> | null = null;

// Quiet, no sound or banner pop-up on every update: it only sits in the shade and changes its text.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

function setup(): Promise<boolean> {
  ready ??= (async () => {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Offline downloads', importance: Notifications.AndroidImportance.LOW, vibrationPattern: [0], showBadge: false });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    return (await Notifications.requestPermissionsAsync()).granted;
  })().catch(() => false);
  return ready;
}

/** Shows or updates the notification for a "dl:" message from the web page. Anything else is ignored. */
export async function onDownloadMessage(raw: string): Promise<void> {
  const message = parseDownloadMessage(raw);
  if (!message) return;
  const identifier = `dl-${message.id}`;
  const text = noticeText(message);
  if (!text) { await Notifications.dismissNotificationAsync(identifier).catch(() => {}); return; }
  if (!(await setup())) return;
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { ...text, sticky: message.state === 'saving', autoDismiss: message.state !== 'saving', priority: Notifications.AndroidNotificationPriority.LOW },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  }).catch(() => {});
}

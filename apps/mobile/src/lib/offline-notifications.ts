import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const channelId = 'offline-downloads';
let permission: Promise<boolean> | undefined;
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});
function allowed() {
  permission ??= (async () => {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(channelId, {
      name: 'Offline downloads', importance: Notifications.AndroidImportance.LOW, showBadge: false,
    });
    const current = await Notifications.getPermissionsAsync();
    return current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  })().catch(() => false);
  return permission;
}
export function offlineNotice(key: string, title: string) {
  const identifier = 'matro-offline-' + key;
  let lastPercent = -1, writes = Promise.resolve();
  const run = (fn: () => Promise<unknown>) => { writes = writes.then(async () => { if (await allowed()) await fn(); }).catch(() => {}); };
  const show = (heading: string, body: string, saving: boolean) => run(async () => {
    await Notifications.scheduleNotificationAsync({
      identifier, content: { title: heading, body, sticky: saving, autoDismiss: !saving },
      trigger: Platform.OS === 'android' ? { channelId } : null,
    });
  });
  return {
    progress(have: number, total: number) {
      const percent = total ? Math.min(99, Math.floor(have / total * 100)) : 0;
      if (percent === lastPercent || percent > 0 && percent < lastPercent + 5) return;
      lastPercent = percent; show(`Saving ${title}`, total ? `${percent}%` : 'Preparing download…', true);
    },
    done() { show(`${title} is ready offline`, 'Saved on this device.', false); },
    dismiss() { if (lastPercent >= 0) run(() => Notifications.dismissNotificationAsync(identifier)); },
  };
}

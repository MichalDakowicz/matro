import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palettes } from '../palette';
import * as Notifications from 'expo-notifications';
import { registerMovieRequestDevice, ServerError, testMovieRequestAlert, unregisterMovieRequestDevice } from './server';

const storageKey = (base: string) => `matro.movie-request-device:${base}`;
export const requestAlertKind = 'matro.movie-request';

export async function forgetMovieRequestAlerts(base: string, unregister = false) {
  const key = storageKey(base);
  if (unregister && await AsyncStorage.getItem(key)) {
    await unregisterMovieRequestDevice(base).catch(() => {});
  }
  await AsyncStorage.removeItem(key);
}

async function deviceToken() {
  const token = await Notifications.getDevicePushTokenAsync();
  if (token.type !== 'android' || typeof token.data !== 'string') throw new Error('Android could not register this phone for push alerts.');
  return token.data;
}

export function useMovieRequestAlerts(base: string, available: boolean) {
  const supported = available && Platform.OS === 'android';
  const [enabled, setEnabled] = useState(false), [ready, setReady] = useState(false), [opened, setOpened] = useState(0);
  const registration = useRef<string | null>(null);
  const lastAlert = useRef<string | null>(null);
  const updates = useRef<Promise<unknown>>(Promise.resolve());

  function update(action: () => Promise<void>) {
    const pending = updates.current.then(action);
    updates.current = pending.catch(() => {});
    return pending;
  }

  async function register(token: string) {
    const result = await registerMovieRequestDevice(base, token);
    await AsyncStorage.setItem(storageKey(base), result.registration);
    registration.current = result.registration;
    setEnabled(true);
  }

  function openResponse(response: Notifications.NotificationResponse | null) {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const alert = response.notification.request;
    if (alert.content.data?.kind !== requestAlertKind || !registration.current ||
        alert.content.data.registration !== registration.current || alert.identifier === lastAlert.current) return;
    lastAlert.current = alert.identifier;
    setOpened(value => value + 1);
    Notifications.clearLastNotificationResponse();
  }

  useEffect(() => {
    if (!supported) return;
    let active = true;
    const responses = Notifications.addNotificationResponseReceivedListener(openResponse);
    const tokens = Notifications.addPushTokenListener(token => {
      if (token.type === 'android' && typeof token.data === 'string') {
        const value = token.data;
        void update(async () => { if (active && registration.current) await register(value); }).catch(() => {});
      }
    });
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(storageKey(base));
        if (!active) return;
        registration.current = saved;
        setEnabled(!!saved);
        const response = await Notifications.getLastNotificationResponseAsync();
        if (!active) return;
        openResponse(response);
        if (!saved) return;
        const permission = await Notifications.getPermissionsAsync();
        if (permission.granted) {
          const token = await deviceToken();
          await update(async () => { if (active && registration.current) await register(token); });
        }
      } catch { /* A manual reconnect remains available if the device or server is offline. */ }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; responses.remove(); tokens.remove(); };
  }, [base, supported]);

  return {
    supported, ready, enabled, opened,
    enable: () => update(async () => {
      await Notifications.setNotificationChannelAsync('movie-requests', {
        name: 'Movie requests', importance: Notifications.AndroidImportance.HIGH, lightColor: palettes.dark.text, sound: 'default',
      });
      const current = await Notifications.getPermissionsAsync();
      if (!current.granted && (!current.canAskAgain || !(await Notifications.requestPermissionsAsync()).granted)) {
        throw new Error('Allow Matro notifications in Android settings to receive movie request alerts.');
      }
      await register(await deviceToken());
    }),
    disable: () => update(async () => {
      await unregisterMovieRequestDevice(base);
      await forgetMovieRequestAlerts(base);
      registration.current = null;
      setEnabled(false);
    }),
    test: async () => {
      try { await testMovieRequestAlert(base); }
      catch (error) {
        if (error instanceof ServerError && error.status === 409) {
          await forgetMovieRequestAlerts(base);
          registration.current = null;
          setEnabled(false);
        }
        throw error;
      }
    },
  };
}

export type MovieRequestAlerts = ReturnType<typeof useMovieRequestAlerts>;

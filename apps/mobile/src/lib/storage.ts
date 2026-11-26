import AsyncStorage from '@react-native-async-storage/async-storage';
import { knownQuality } from '../../../../packages/core/client/quality.js';
import { createProgressRecovery } from '../../../../packages/core/client/recovery';

const KEY = 'matro.server';

export const loadServer = (): Promise<string | null> => AsyncStorage.getItem(KEY).catch(() => null);
export const saveServer = (base: string) => AsyncStorage.setItem(KEY, base).catch(() => {});
export const forgetServer = () => AsyncStorage.removeItem(KEY).catch(() => {});
// Stream quality is a per-device choice (a phone and a TV on the same account want different tiers).
export const loadQuality = (): Promise<string> => AsyncStorage.getItem('matro.quality').then(value => knownQuality(value), () => 'original');
export const saveQuality = (quality: string) => AsyncStorage.setItem('matro.quality', quality).catch(() => {});
export const progressRecovery = createProgressRecovery(AsyncStorage);
export const recoveryScope = (base: string, user: { id: number; username: string }) => `${base}:account:${user.id}:${user.username}`;

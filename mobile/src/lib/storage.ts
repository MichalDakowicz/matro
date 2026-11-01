import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'matro.server';

export const loadServer = (): Promise<string | null> => AsyncStorage.getItem(KEY).catch(() => null);
export const saveServer = (base: string) => AsyncStorage.setItem(KEY, base).catch(() => {});
export const forgetServer = () => AsyncStorage.removeItem(KEY).catch(() => {});

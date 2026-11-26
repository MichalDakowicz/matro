import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { boostMillibels, MAX_VOLUME } from './volume';

type Boost = { setGain(player: VideoPlayer, millibels: number): Promise<void>; release(): Promise<void> };
// Android only. iOS, web and APKs built before the module keep the volume at 100% or below.
const boost = Platform.OS === 'android' ? requireOptionalNativeModule<Boost>('MatroVolumeBoost') : null;

export const maxVolume = boost ? MAX_VOLUME : 1;
export const setBoost = (player: VideoPlayer, percent: number) => { void boost?.setGain(player, boostMillibels(percent)).catch(() => {}); };
export const releaseBoost = () => { void boost?.release().catch(() => {}); };

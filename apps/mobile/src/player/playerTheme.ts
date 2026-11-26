import { Easing } from 'react-native';
export { playerChrome as chrome } from '../palette';

/** One curve and two durations for everything that moves in the player. */
export const motion = { curve: Easing.bezier(.2, .75, .15, 1), base: 320, quick: 200 } as const;

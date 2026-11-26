// Kept free of React Native imports so node tests can read it.

/** The design's backdrop blur, `backdrop-filter: blur(18px)`, in dp. */
export const GLASS_BLUR_DP = 18;

type Device = { os: string; version: number | string; tv: boolean; highContrast: boolean; powerSave: boolean };
/**
 * Real blur needs Android 12+ (RenderEffect); below that expo-blur's fallback is slow or a flat tint.
 * TV, high text contrast (Android's nearest to "reduce transparency") and battery saver keep the solid fill.
 */
export const canBlur = ({ os, version, tv, highContrast, powerSave }: Device) =>
  os === 'android' && Number(version) >= 31 && !tv && !highContrast && !powerSave;

/**
 * expo-blur props for a blur whose Gaussian sigma is `dp` at this screen density.
 * Android: radius px = intensity / blurReductionFactor x 4 (BlurView's scale), and sigma = 0.57735 x radius + 0.5.
 * Intensity stays at 1 so expo's own tint overlay is about 0 % alpha and the Glass fill alone sets the colour.
 */
export function blurProps(density: number, dp = GLASS_BLUR_DP) {
  const radius = (dp * density - .5) / .57735;
  return { intensity: 1, blurReductionFactor: 4 / radius };
}

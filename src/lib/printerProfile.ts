import type { Settings } from '../types';

/** Common nozzle sizes in mm */
export const NOZZLE_SIZES = [0.2, 0.4, 0.6, 0.8] as const;

/**
 * Returns valid layer heights for a given nozzle diameter.
 * Range: 25%-75% of nozzle in 0.04mm increments.
 */
export function getLayerHeightOptions(nozzle: number): number[] {
  const min = Math.round(nozzle * 0.25 / 0.04) * 0.04;
  const max = Math.round(nozzle * 0.75 / 0.04) * 0.04;
  const opts: number[] = [];
  for (let h = min; h <= max + 0.001; h += 0.04) {
    opts.push(Math.round(h * 100) / 100);
  }
  return opts;
}

/** Round a value to the nearest multiple of layerHeight */
export function snapToLayerHeight(value: number, layerH: number): number {
  if (layerH <= 0) return value;
  const snapped = Math.round(value / layerH) * layerH;
  return Math.round(snapped * 100) / 100;
}

/** Returns effective (snapped) Z dimensions if snapToLayer is enabled */
export function getEffectiveDimensions(settings: Settings): {
  surfaceHeight: number;
  baseHeight: number;
  chamferDepth: number;
} {
  if (!settings.snapToLayer) {
    return {
      surfaceHeight: settings.surfaceHeight,
      baseHeight: settings.baseHeight,
      chamferDepth: settings.chamferDepth,
    };
  }
  const lh = settings.layerHeight;
  return {
    surfaceHeight: Math.max(lh, snapToLayerHeight(settings.surfaceHeight, lh)),
    baseHeight: Math.max(lh, snapToLayerHeight(settings.baseHeight, lh)),
    chamferDepth: Math.max(lh, snapToLayerHeight(settings.chamferDepth, lh)),
  };
}

/**
 * Computes the chamfer overhang angle in degrees from horizontal.
 * Lower angle = more printable without supports.
 */
export function computeChamferAngle(
  chamferDepthMm: number,
  chamferWidthPx: number,
  pixelSizeMm: number
): number {
  const run = chamferWidthPx * pixelSizeMm;
  if (run <= 0) return 90;
  return Math.atan2(chamferDepthMm, run) * (180 / Math.PI);
}

/** Max chamfer depth (mm) that keeps the angle at or below maxAngle degrees */
export function maxChamferDepthForAngle(
  chamferWidthPx: number,
  pixelSizeMm: number,
  maxAngle: number
): number {
  const run = chamferWidthPx * pixelSizeMm;
  return Math.round(run * Math.tan(maxAngle * Math.PI / 180) * 100) / 100;
}

/** Minimum wall thickness for reliable FDM printing (1.5x nozzle) */
export function getMinWallThickness(nozzle: number): number {
  return nozzle * 1.5;
}

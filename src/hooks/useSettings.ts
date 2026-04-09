import { useState, useCallback } from 'react';
import type { Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  maxWidth: 1024,
  numColors: 8,
  surfaceHeight: 5,
  baseHeight: 2,
  chamferDepth: 2,
  chamferWidth: 3,
  smoothing: 1.0,
  minRegion: 20,
  modelWidth: 100,
  bgTolerance: 30,
  removeBg: true,
  cutThrough: false,
  hollow: false,
  mirrorX: false,
  faceDown: false,
  highlightSmall: true,
  paletteMode: 'pick',
  nozzleDiameter: 0.4,
  layerHeight: 0.20,
  snapToLayer: true,
  minFeatureRetention: 0.5,
  amsSlots: 0,
  fitClearance: 0.10,
  mergeSmallPieces: 0,
  detailSize: 0.4,
  highlightThinWalls: false,
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  return { settings, updateSetting, setSettings };
}

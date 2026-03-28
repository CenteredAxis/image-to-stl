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
  highlightSmall: true,
  paletteMode: 'pick',
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  return { settings, updateSetting, setSettings };
}

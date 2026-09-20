import { useEffect, useState } from 'react';
import {
  NORMALIZATION_OPTIONS,
  type ChartDisplaySettings,
  type NormalizationMode,
} from './chartNormalization';
import type { ComparisonScale } from './comparison';

const STORAGE_KEY = 'replay-chart-display:v1';
type Preferences = ChartDisplaySettings & { configured: boolean };
const defaults: Preferences = {
  normalization: 'price',
  scale: 'linear',
  window: 50,
  configured: false,
};

function restore(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (value && typeof value === 'object') {
      return {
        normalization: NORMALIZATION_OPTIONS.some(
          (option) => option.value === value.normalization,
        )
          ? value.normalization
          : defaults.normalization,
        scale: value.scale === 'log' ? 'log' : 'linear',
        window:
          Number.isInteger(value.window) &&
          value.window >= 2 &&
          value.window <= 500
            ? value.window
            : defaults.window,
        configured: value.configured !== false,
      };
    }
    const legacy = JSON.parse(
      localStorage.getItem('replay-benchmark:v1') || 'null',
    );
    // Earlier versions only applied these display choices with an active benchmark.
    if (
      typeof legacy?.ticker === 'string' &&
      legacy.ticker &&
      ['price', 'percent', 'indexed'].includes(legacy.normalization)
    ) {
      return {
        ...defaults,
        normalization: legacy.normalization,
        scale: legacy.scale === 'log' ? 'log' : 'linear',
        configured: true,
      };
    }
  } catch {
    // Damaged or unavailable storage leaves the standalone chart usable.
  }
  return defaults;
}

export function useChartDisplay() {
  const [preferences, setPreferences] = useState<Preferences>(restore);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [preferences]);

  return {
    ...preferences,
    saved,
    setNormalization: (normalization: NormalizationMode) =>
      setPreferences((previous) => ({
        ...previous,
        normalization,
        configured: true,
      })),
    setScale: (scale: ComparisonScale) =>
      setPreferences((previous) => ({ ...previous, scale, configured: true })),
    setWindow: (window: number) => {
      if (Number.isInteger(window) && window >= 2 && window <= 500)
        setPreferences((previous) => ({
          ...previous,
          window,
          configured: true,
        }));
    },
    enableComparisonDefaults: () =>
      setPreferences((previous) =>
        previous.configured
          ? previous
          : { ...previous, normalization: 'percent' },
      ),
    reset: () => setPreferences({ ...defaults, configured: true }),
  };
}

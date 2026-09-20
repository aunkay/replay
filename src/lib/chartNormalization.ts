import type { Candle } from './engine';
import {
  computeComparison,
  type ComparisonResult,
  type ComparisonScale,
} from './comparison';

export type NormalizationMode =
  'price' | 'percent' | 'indexed' | 'ratio' | 'logReturn' | 'zscore' | 'minmax';

export type ChartDisplaySettings = {
  normalization: NormalizationMode;
  scale: ComparisonScale;
  window: number;
};

export type NormalizationStatistics = {
  mean: number;
  deviation: number;
  min: number;
  max: number;
  count: number;
};

export type NormalizationContext = {
  normalization: NormalizationMode;
  scale: ComparisonScale;
  anchorPrice: number | null;
  anchorTime: number | null;
  statistics: NormalizationStatistics | null;
};

export type NormalizedView = {
  display: NormalizationContext;
  comparison: ComparisonResult | null;
  notice: string | null;
  sampleCount: number;
};

export const NORMALIZATION_OPTIONS: {
  value: NormalizationMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'price',
    label: 'Price',
    description:
      'Original base prices; comparison tickers are rebased to the same starting price.',
  },
  {
    value: 'percent',
    label: 'Percentage',
    description:
      'Percentage price change from the first revealed base candle, or first shared candle when comparing.',
  },
  {
    value: 'indexed',
    label: 'Indexed to 100',
    description:
      'All tickers start at 100, using the first shared candle when comparisons are available.',
  },
  {
    value: 'ratio',
    label: 'Ratio to start',
    description:
      'Price divided by its starting price. A ratio of 1.25 means a 25% gain.',
  },
  {
    value: 'logReturn',
    label: 'Log return (%)',
    description:
      '100 × natural log of price / starting price, displayed with logarithmic price spacing.',
  },
  {
    value: 'zscore',
    label: 'Z-score',
    description:
      'Distance from the trailing-window mean in population standard deviations. Benchmark statistics use the same shared timestamps.',
  },
  {
    value: 'minmax',
    label: 'Min–max (0–100)',
    description:
      'Trailing-window minimum is 0 and maximum is 100. Earlier prices outside the window can fall outside 0–100.',
  },
];

const validClose = (bar: Candle) =>
  Number.isFinite(bar.time) && Number.isFinite(bar.close) && bar.close > 0;

function statistics(values: number[]): NormalizationStatistics | null {
  if (!values.length) return null;
  const count = values.length;
  // Divide before summing and before taking the norm to avoid intermediate
  // overflow for large but valid prices. The final deviation is population SD.
  const mean = values.reduce((total, value) => total + value / count, 0);
  const divisor = Math.sqrt(count);
  const deviation = Math.hypot(
    ...values.map((value) => (value - mean) / divisor),
  );
  return {
    mean,
    deviation,
    min: Math.min(...values),
    max: Math.max(...values),
    count,
  };
}

/**
 * Keep candle, drawing and trading coordinates in original base-price units.
 * All reference values come from the supplied revealed prefix. Statistical
 * views use one current trailing window for both instruments, so their history
 * is rescaled as that window advances; it is never computed from future bars.
 */
export function computeNormalizedView(
  base: Candle[],
  benchmark: Candle[] | null,
  settings: ChartDisplaySettings,
): NormalizedView {
  const comparison =
    benchmark === null ? null : computeComparison(base, benchmark);
  const available = base.filter(validClose);
  const benchmarkByTime = new Map(
    (benchmark ?? []).filter(validClose).map((bar) => [bar.time, bar.close]),
  );
  const shared = comparison?.anchor
    ? available.filter((bar) => benchmarkByTime.has(bar.time))
    : [];
  const length = Number.isFinite(settings.window)
    ? Math.max(2, Math.min(500, Math.floor(settings.window)))
    : 50;
  const samples = (shared.length ? shared : available).slice(-length);
  const normalization = NORMALIZATION_OPTIONS.some(
    (option) => option.value === settings.normalization,
  )
    ? settings.normalization
    : 'price';
  const statistical = normalization === 'zscore' || normalization === 'minmax';
  const baseStatistics = statistical
    ? statistics(samples.map((bar) => bar.close))
    : null;
  const benchmarkStatistics =
    statistical && shared.length
      ? statistics(samples.map((bar) => benchmarkByTime.get(bar.time)!))
      : null;
  const display: NormalizationContext = {
    normalization,
    scale:
      normalization === 'logReturn'
        ? 'log'
        : statistical
          ? 'linear'
          : settings.scale === 'log'
            ? 'log'
            : 'linear',
    anchorPrice: comparison?.anchor?.baseClose ?? available[0]?.close ?? null,
    anchorTime: comparison?.anchor?.time ?? available[0]?.time ?? null,
    statistics: baseStatistics,
  };
  const result: NormalizedView = {
    display,
    comparison,
    notice: null,
    sampleCount: samples.length,
  };
  if (!statistical) return result;

  const label = normalization === 'zscore' ? 'Z-score' : 'Min–max';
  const fallback = (reason: string): NormalizedView => ({
    ...result,
    display: { ...display, normalization: 'price', scale: 'linear' },
    notice: `${label} ${reason} Showing price instead.`,
  });
  if (!baseStatistics || samples.length < 2) {
    return fallback(
      `needs at least 2 ${shared.length ? 'matching ' : ''}revealed candles.`,
    );
  }
  if (
    baseStatistics.max === baseStatistics.min ||
    baseStatistics.deviation === 0 ||
    !Number.isFinite(baseStatistics.mean) ||
    !Number.isFinite(baseStatistics.deviation)
  ) {
    return fallback('cannot normalize a zero-range base window.');
  }
  if (
    benchmarkStatistics &&
    (benchmarkStatistics.max === benchmarkStatistics.min ||
      benchmarkStatistics.deviation === 0 ||
      !Number.isFinite(benchmarkStatistics.mean) ||
      !Number.isFinite(benchmarkStatistics.deviation))
  ) {
    return fallback('cannot normalize a zero-range benchmark window.');
  }
  if (!comparison?.anchor || !benchmarkStatistics) return result;

  const points = comparison.points.flatMap((point) => {
    const price = benchmarkByTime.get(point.time)!;
    const value =
      normalization === 'zscore'
        ? baseStatistics.mean +
          baseStatistics.deviation *
            ((price - benchmarkStatistics.mean) / benchmarkStatistics.deviation)
        : baseStatistics.min +
          (baseStatistics.max - baseStatistics.min) *
            ((price - benchmarkStatistics.min) /
              (benchmarkStatistics.max - benchmarkStatistics.min));
    // Affine statistical alignment can legitimately put older benchmark prices
    // below zero in raw base coordinates. They remain valid on the linear axis.
    return Number.isFinite(value) ? [{ time: point.time, value }] : [];
  });
  return { ...result, comparison: { ...comparison, points } };
}

/** Display conversion only: it never alters candles, order prices or anchors. */
export function normalizationValue(
  rawPrice: number,
  context: NormalizationContext,
): number {
  if (!Number.isFinite(rawPrice)) return NaN;
  if (context.normalization === 'price') return rawPrice;
  const stats = context.statistics;
  if (context.normalization === 'zscore') {
    return stats &&
      Number.isFinite(stats.mean) &&
      Number.isFinite(stats.deviation) &&
      stats.deviation > 0
      ? (rawPrice - stats.mean) / stats.deviation
      : NaN;
  }
  if (context.normalization === 'minmax') {
    return stats &&
      Number.isFinite(stats.min) &&
      Number.isFinite(stats.max) &&
      stats.max > stats.min
      ? ((rawPrice - stats.min) / (stats.max - stats.min)) * 100
      : NaN;
  }
  const anchor = context.anchorPrice;
  if (anchor === null || !Number.isFinite(anchor) || anchor <= 0) return NaN;
  switch (context.normalization) {
    case 'percent':
      return 100 * (rawPrice / anchor - 1);
    case 'indexed':
      return (rawPrice / anchor) * 100;
    case 'ratio':
      return rawPrice / anchor;
    case 'logReturn':
      return rawPrice > 0 ? 100 * (Math.log(rawPrice) - Math.log(anchor)) : NaN;
  }
}

export function normalizationLabel(
  rawPrice: number,
  context: NormalizationContext,
): string {
  const value = normalizationValue(rawPrice, context);
  if (!Number.isFinite(value)) return '—';
  const digits = context.normalization === 'ratio' ? 4 : 2;
  const displayed = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  const percent =
    context.normalization === 'percent' ||
    context.normalization === 'logReturn';
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    ...(percent ? { signDisplay: 'exceptZero' as const } : {}),
  }).format(displayed);
  return `${formatted}${percent ? '%' : ''}`;
}

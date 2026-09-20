import { describe, expect, it } from 'vitest';
import type { Candle } from './engine';
import { computeComparison } from './comparison';
import {
  computeNormalizedView,
  normalizationLabel,
  normalizationValue,
  NORMALIZATION_OPTIONS,
  type ChartDisplaySettings,
  type NormalizationContext,
  type NormalizationMode,
} from './chartNormalization';

const bars = (prices: number[], times?: number[]): Candle[] =>
  prices.map((close, i) => ({
    time: times?.[i] ?? i + 1,
    close,
    open: close,
    high: close,
    low: close,
    volume: 100,
  }));
const settings = (
  normalization: NormalizationMode,
  window = 50,
): ChartDisplaySettings => ({ normalization, scale: 'linear', window });
const valueList = (values: number[], context: NormalizationContext) =>
  values.map((value) => normalizationValue(value, context));
function expectValues(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10));
}

describe('standalone normalization', () => {
  it('offers the seven requested modes with user-facing names', () => {
    expect(NORMALIZATION_OPTIONS.map((option) => option.value)).toEqual([
      'price',
      'percent',
      'indexed',
      'ratio',
      'logReturn',
      'zscore',
      'minmax',
    ]);
    expect(NORMALIZATION_OPTIONS.map((option) => option.label)).toEqual([
      'Price',
      'Percentage',
      'Indexed to 100',
      'Ratio to start',
      'Log return (%)',
      'Z-score',
      'Min–max (0–100)',
    ]);
  });

  it.each([
    ['price', [50, 60, 40]],
    ['percent', [0, 20, -20]],
    ['indexed', [100, 120, 80]],
    ['ratio', [1, 1.2, 0.8]],
    ['logReturn', [0, 100 * Math.log(1.2), 100 * Math.log(0.8)]],
  ] as const)(
    '%s transforms prices from the first revealed base candle without a benchmark',
    (mode, expected) => {
      const view = computeNormalizedView(
        bars([50, 60, 40]),
        null,
        settings(mode),
      );
      expect(view.comparison).toBeNull();
      expect(view.notice).toBeNull();
      expect(view.display.anchorPrice).toBe(50);
      expect(view.display.anchorTime).toBe(1);
      expect(view.display.statistics).toBeNull();
      expectValues(valueList([50, 60, 40], view.display), [...expected]);
    },
  );

  it('computes population z-scores from the trailing revealed observations', () => {
    const view = computeNormalizedView(
      bars([100, 10, 20, 30]),
      null,
      settings('zscore', 3),
    );
    const deviation = Math.sqrt(200 / 3);
    expect(view.sampleCount).toBe(3);
    expect(view.display.statistics).toMatchObject({
      mean: 20,
      min: 10,
      max: 30,
      count: 3,
    });
    expect(view.display.statistics!.deviation).toBeCloseTo(deviation, 10);
    expectValues(valueList([10, 20, 30, 100], view.display), [
      -10 / deviation,
      0,
      10 / deviation,
      80 / deviation,
    ]);
  });

  it('maps window extrema to 0 and 100 while allowing earlier prices outside that range', () => {
    const view = computeNormalizedView(
      bars([100, 10, 20, 30]),
      null,
      settings('minmax', 3),
    );
    expectValues(valueList([10, 20, 30, 100], view.display), [0, 50, 100, 450]);
  });

  it('uses logarithmic spacing for log returns and linear spacing for statistics', () => {
    expect(
      computeNormalizedView(bars([10, 20]), null, settings('logReturn')).display
        .scale,
    ).toBe('log');
    for (const normalization of ['zscore', 'minmax'] as const) {
      expect(
        computeNormalizedView(bars([10, 20]), null, {
          ...settings(normalization),
          scale: 'log',
        }).display.scale,
      ).toBe('linear');
    }
    expect(
      computeNormalizedView(bars([10, 20]), null, {
        ...settings('percent'),
        scale: 'log',
      }).display.scale,
    ).toBe('log');
  });

  it('bounds the rolling window to 2–500 with a default of 50 for nonfinite input', () => {
    const market = bars(Array.from({ length: 600 }, (_, i) => i + 1));
    for (const [window, count] of [
      [0, 2],
      [-1, 2],
      [3.9, 3],
      [1000, 500],
      [NaN, 50],
      [Infinity, 50],
    ]) {
      expect(
        computeNormalizedView(market, null, settings('zscore', window))
          .sampleCount,
      ).toBe(count);
    }
  });
});

describe('statistical benchmark alignment', () => {
  const base = bars([10, 1000, 20, 900, 30], [1, 2, 3, 4, 5]);
  const benchmark = bars([100, 9999, 120, 140, 20_000], [1, 2.5, 3, 5, 6]);

  it.each(['zscore', 'minmax'] as const)(
    '%s uses the same trailing shared timestamps for both instruments',
    (mode) => {
      const view = computeNormalizedView(base, benchmark, settings(mode, 3));
      expect(view.sampleCount).toBe(3);
      expect(view.display.statistics).toMatchObject({
        mean: 20,
        min: 10,
        max: 30,
        count: 3,
      });
      expectValues(
        view.comparison!.points.map((point) => point.value),
        [10, 20, 30],
      );
      expect(view.comparison!.points.map((point) => point.time)).toEqual([
        1, 3, 5,
      ]);
      expect(view.comparison!.anchor).toEqual({
        time: 1,
        baseClose: 10,
        benchmarkClose: 100,
      });
      expect(view.comparison!.latest).toEqual(
        computeComparison(base, benchmark).latest,
      );
      expect(view.comparison!.latest!.baseReturn).toBe(200);
      expect(view.comparison!.latest!.benchmarkReturn).toBeCloseTo(40, 10);
    },
  );

  it('z-score maps a benchmark with a different distribution using its own population deviation', () => {
    const view = computeNormalizedView(
      bars([10, 20, 30]),
      bars([100, 100, 130]),
      settings('zscore'),
    );
    const baseDeviation = Math.sqrt(200 / 3);
    const benchmarkDeviation = Math.sqrt(200);
    const mapped = [
      20 - (baseDeviation * 10) / benchmarkDeviation,
      20 - (baseDeviation * 10) / benchmarkDeviation,
      20 + (baseDeviation * 20) / benchmarkDeviation,
    ];
    expectValues(
      view.comparison!.points.map((point) => point.value),
      mapped,
    );
    expectValues(
      mapped.map((value) => normalizationValue(value, view.display)),
      [-1 / Math.sqrt(2), -1 / Math.sqrt(2), Math.sqrt(2)],
    );
  });

  it.each(['zscore', 'minmax'] as const)(
    '%s retains valid negative raw benchmark coordinates for older out-of-window prices',
    (mode) => {
      const view = computeNormalizedView(
        bars([100, 10, 20]),
        bars([1, 100, 110]),
        settings(mode, 2),
      );
      expectValues(
        view.comparison!.points.map((point) => point.value),
        [-89, 10, 20],
      );
      expect(view.comparison!.points[0].value).toBeLessThan(0);
      expect(view.display.scale).toBe('linear');
      expect(view.notice).toBeNull();
    },
  );

  it.each(['price', 'percent', 'indexed', 'ratio', 'logReturn'] as const)(
    '%s preserves raw rebased benchmark points and common starting anchors',
    (mode) => {
      const earlyBase = bars([50, 60, 80], [0, 1, 2]);
      const common = bars([100, 150], [1, 2]);
      const view = computeNormalizedView(earlyBase, common, settings(mode));
      expect(view.display.anchorPrice).toBe(60);
      expect(view.display.anchorTime).toBe(1);
      expect(view.comparison).toEqual(computeComparison(earlyBase, common));
      expect(view.comparison!.points).toEqual([
        { time: 1, value: 60 },
        { time: 2, value: 90 },
      ]);
    },
  );

  it('normalizes the base independently before the benchmark first appears in replay', () => {
    const view = computeNormalizedView(
      bars([10, 20], [1, 2]),
      bars([100, 120], [3, 4]),
      settings('minmax'),
    );
    expect(view.display.anchorPrice).toBe(10);
    expect(view.sampleCount).toBe(2);
    expect(view.comparison).toEqual({ anchor: null, latest: null, points: [] });
    expectValues(valueList([10, 20], view.display), [0, 100]);
    expect(view.notice).toBeNull();
  });
});

describe('statistical warm-up and flat-window fallbacks', () => {
  it.each(['zscore', 'minmax'] as const)(
    '%s falls back to price/linear with fewer than two revealed observations',
    (mode) => {
      for (const prices of [[], [100]]) {
        const view = computeNormalizedView(bars(prices), null, {
          ...settings(mode),
          scale: 'log',
        });
        expect(view.display.normalization).toBe('price');
        expect(view.display.scale).toBe('linear');
        expect(view.notice).toContain('at least 2');
        expect(view.sampleCount).toBe(prices.length);
      }
    },
  );

  it.each(['zscore', 'minmax'] as const)(
    '%s requires two shared observations when a benchmark has started',
    (mode) => {
      const view = computeNormalizedView(
        bars([10, 20, 30]),
        bars([100, 200], [3, 5]),
        settings(mode),
      );
      expect(view.sampleCount).toBe(1);
      expect(view.notice).toContain('matching');
      expect(view.display.normalization).toBe('price');
      expect(view.comparison!.points).toEqual([{ time: 3, value: 30 }]);
    },
  );

  it.each(['zscore', 'minmax'] as const)(
    '%s keeps ordinary rebased benchmark prices when either statistics window is flat',
    (mode) => {
      for (const [basePrices, benchmarkPrices, subject] of [
        [[10, 10], [100, 120], 'base'],
        [[10, 20], [100, 100], 'benchmark'],
      ] as const) {
        const base = bars([...basePrices]),
          benchmark = bars([...benchmarkPrices]);
        const view = computeNormalizedView(base, benchmark, settings(mode));
        expect(view.display.normalization).toBe('price');
        expect(view.display.scale).toBe('linear');
        expect(view.notice).toContain(`zero-range ${subject}`);
        expect(view.comparison).toEqual(computeComparison(base, benchmark));
      }
    },
  );

  it('allows ordinary percentage and ratio views on a single or flat baseline', () => {
    for (const mode of ['percent', 'ratio'] as const) {
      const view = computeNormalizedView(
        bars([100]),
        bars([50]),
        settings(mode),
      );
      expect(view.display.normalization).toBe(mode);
      expect(view.notice).toBeNull();
    }
  });
});

describe('causality and display formatting', () => {
  it.each(NORMALIZATION_OPTIONS)(
    '$value never reads unrevealed benchmark prices or mutates source candles',
    ({ value: mode }) => {
      const base = bars([10, 11, 14, 20, 30, 90]);
      const benchmark = bars([50, 52, 53, 60, 65, 150]);
      const before = structuredClone({ base, benchmark });
      const prefix = base.slice(0, 4);
      const original = computeNormalizedView(
        prefix,
        benchmark,
        settings(mode, 3),
      );
      const future = benchmark.map((bar) =>
        bar.time > 4 ? { ...bar, close: 1_000_000 } : bar,
      );
      expect(computeNormalizedView(prefix, future, settings(mode, 3))).toEqual(
        original,
      );
      expect(
        computeNormalizedView(prefix, benchmark.slice(0, 4), settings(mode, 3)),
      ).toEqual(original);
      expect(
        original.comparison!.points.every((point) => point.time <= 4),
      ).toBe(true);
      expect({ base, benchmark }).toEqual(before);
    },
  );

  it('slides the statistical window using only newly revealed candles', () => {
    const base = bars([10, 20, 30, 100]);
    const earlier = computeNormalizedView(
      base.slice(0, 3),
      null,
      settings('minmax', 2),
    );
    const later = computeNormalizedView(base, null, settings('minmax', 2));
    expect(earlier.display.statistics).toMatchObject({
      min: 20,
      max: 30,
      mean: 25,
    });
    expect(later.display.statistics).toMatchObject({
      min: 30,
      max: 100,
      mean: 65,
    });
    expect(normalizationValue(30, earlier.display)).toBe(100);
    expect(normalizationValue(30, later.display)).toBe(0);
  });

  it('keeps valid large-price normalization finite without intermediate overflow', () => {
    const base = bars([1e307, 2e307]);
    const indexed = computeNormalizedView(base, null, settings('indexed'));
    const minmax = computeNormalizedView(base, null, settings('minmax'));
    const zscore = computeNormalizedView(base, null, settings('zscore'));
    expect(normalizationValue(2e307, indexed.display)).toBe(200);
    expect(normalizationValue(2e307, minmax.display)).toBe(100);
    expect(normalizationValue(2e307, zscore.display)).toBeCloseTo(1, 10);
    expect(zscore.notice).toBeNull();
  });

  it('formats ratio to four decimals, signed returns, and all other values to two decimals', () => {
    const context = (mode: NormalizationMode) =>
      computeNormalizedView(bars([50, 60]), null, settings(mode)).display;
    expect(normalizationLabel(60, context('percent'))).toBe('+20.00%');
    expect(normalizationLabel(40, context('percent'))).toBe('-20.00%');
    expect(normalizationLabel(50, context('percent'))).toBe('0.00%');
    expect(normalizationLabel(60, context('indexed'))).toBe('120.00');
    expect(normalizationLabel(60, context('ratio'))).toBe('1.2000');
    expect(normalizationLabel(60, context('logReturn'))).toBe('+18.23%');
    expect(normalizationLabel(40, context('logReturn'))).toBe('-22.31%');
    expect(normalizationLabel(60, context('zscore'))).toBe('1.00');
    expect(normalizationLabel(60, context('minmax'))).toBe('100.00');
    expect(normalizationLabel(1234.5, context('price'))).toBe('1,234.50');
  });

  it('guards invalid log-return prices and suppresses negative zero labels', () => {
    const context = computeNormalizedView(
      bars([50, 60]),
      null,
      settings('logReturn'),
    ).display;
    for (const value of [0, -1, NaN, Infinity]) {
      expect(Number.isNaN(normalizationValue(value, context))).toBe(true);
      expect(normalizationLabel(value, context)).toBe('—');
    }
    expect(normalizationLabel(50 - Number.EPSILON * 50, context)).toBe('0.00%');
    expect(normalizationLabel(50, { ...context, anchorPrice: null })).toBe('—');
    expect(normalizationLabel(50, { ...context, anchorPrice: 0 })).toBe('—');
  });
});

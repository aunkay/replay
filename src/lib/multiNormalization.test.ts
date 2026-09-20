import { expect, it } from 'vitest';
import { computeMultiNormalizedView } from './multiNormalization';
import {
  normalizationValue,
  type NormalizationMode,
} from './chartNormalization';
import type { Candle } from './engine';

const bars = (
  values: number[],
  times = values.map((_, index) => index + 1),
): Candle[] =>
  values.map((close, index) => ({
    time: times[index],
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
const base = bars([100, 110, 140, 160, 180]);
const comparisons = [
  bars([200, 210, 220, 230, 250]),
  bars([50, 80, 100], [2, 3, 5]),
  bars([10, 20, 25], [1, 2, 5]),
  bars([500, 480, 440, 400, 350]),
];
for (const mode of [
  'price',
  'percent',
  'indexed',
  'ratio',
  'logReturn',
  'zscore',
  'minmax',
] as NormalizationMode[]) {
  it(`aligns four comparisons with one shared ${mode} baseline/window`, () => {
    const result = computeMultiNormalizedView(base, comparisons, {
      normalization: mode,
      scale: 'linear',
      window: 3,
    });
    expect(result.display.anchorTime).toBe(2);
    expect(result.display.anchorPrice).toBe(110);
    expect(result.sampleCount).toBe(2);
    expect(result.notice).toBeNull();
    expect(result.comparisons).toHaveLength(4);
    for (let index = 0; index < comparisons.length; index++) {
      const actual = result.comparisons[index]!;
      expect(actual.points.map((point) => point.time)).toEqual([2, 5]);
      const first = comparisons[index].find((bar) => bar.time === 2)!.close;
      const last = comparisons[index].find((bar) => bar.time === 5)!.close;
      const ratio = last / first;
      const expected =
        mode === 'price'
          ? ratio * 110
          : mode === 'percent'
            ? (ratio - 1) * 100
            : mode === 'indexed'
              ? ratio * 100
              : mode === 'ratio'
                ? ratio
                : mode === 'logReturn'
                  ? 100 * Math.log(ratio)
                  : mode === 'zscore'
                    ? Math.sign(last - first)
                    : last > first
                      ? 100
                      : 0;
      expect(
        normalizationValue(actual.points.at(-1)!.value, result.display),
      ).toBeCloseTo(expected, 8);
      expect(actual.latest!.baseReturn).toBeCloseTo((180 / 110 - 1) * 100);
      expect(actual.latest!.benchmarkReturn).toBeCloseTo((ratio - 1) * 100);
    }
  });
}
it('waits for an all-ticker shared candle without reading ahead', () => {
  const result = computeMultiNormalizedView(base.slice(0, 1), comparisons, {
    normalization: 'percent',
    scale: 'linear',
    window: 3,
  });
  expect(result.notice).toContain('Waiting');
  expect(result.display.anchorTime).toBe(1);
  for (const comparison of result.comparisons)
    expect(comparison?.points).toEqual([]);
});
it('preserves slot identities and handles empty slots and removal', () => {
  const result = computeMultiNormalizedView(
    base,
    [null, comparisons[1], null, comparisons[3]],
    { normalization: 'percent', scale: 'linear', window: 3 },
  );
  expect(result.comparisons[0]).toBeNull();
  expect(result.comparisons[2]).toBeNull();
  expect(result.comparisons[1]!.points.map((point) => point.time)).toEqual([
    2, 3, 5,
  ]);
});
it('falls back consistently when one statistical comparison is flat', () => {
  const result = computeMultiNormalizedView(
    base,
    [comparisons[0], bars([5, 5, 5, 5, 5])],
    { normalization: 'zscore', scale: 'log', window: 3 },
  );
  expect(result.display.normalization).toBe('price');
  expect(result.display.scale).toBe('linear');
  expect(result.notice).toContain('zero-range benchmark');
  expect(result.comparisons[0]!.points.at(-1)!.value).toBe(125);
  expect(result.comparisons[1]!.points.at(-1)!.value).toBe(100);
});

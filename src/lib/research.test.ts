import { expect, it } from 'vitest';
import { monteCarlo, runResearch } from './research';
import { defaultStrategy } from './strategy';
const bars = Array.from({ length: 160 }, (_, i) => ({
  time: 1704067200 + i * 86400,
  open: 100 + Math.sin(i / 5) * 10,
  high: 112,
  low: 88,
  close: 100 + Math.sin(i / 5) * 10,
  volume: 1000,
}));
const options = {
  mode: 'walk-forward' as const,
  trainBars: 80,
  testBars: 20,
  simulations: 100,
  seed: 42,
};
it('walk-forward windows are non-overlapping and selections cannot see test prices', () => {
  const strategy = defaultStrategy(),
    parameters = [{ path: 'stopPct', values: [1, 2] }];
  const original = runResearch(strategy, bars, parameters, options);
  expect('folds' in original && original.folds).toHaveLength(4);
  if (!original.folds) throw new Error('Expected folds');
  expect(original.folds[1].testStart).toBeGreaterThan(
    original.folds[0].testEnd,
  );
  const changed = runResearch(
    strategy,
    bars.map((b, i) =>
      i < 80
        ? b
        : {
            ...b,
            open: b.open * 2,
            high: b.high * 2,
            low: b.low * 2,
            close: b.close * 2,
          },
    ),
    parameters,
    options,
  );
  if (!changed.folds) throw new Error('Expected folds');
  expect(changed.folds[0].winner).toEqual(original.folds[0].winner);
  expect(changed.folds[0].candidates).toEqual(original.folds[0].candidates);
  expect(original.totalPnl).toBeCloseTo(
    original.folds.reduce((n, f) => n + f.metrics.totalPnl, 0),
  );
});
it('Monte Carlo is reproducible and reports empty and constant outcomes', () => {
  expect(monteCarlo([10, -20, 30], 1000, 100, 12)).toEqual(
    monteCarlo([10, -20, 30], 1000, 100, 12),
  );
  expect(monteCarlo([], 1000, 100, 12).percentiles).toBeNull();
  expect(
    monteCarlo([10], 1000, 100, 12).percentiles?.map((p) => p.pnl),
  ).toEqual([10, 10, 10]);
  expect(monteCarlo([-10], 1000, 100, 12).lossProbability).toBe(1);
  expect(() => monteCarlo([], 1000, 0, 12)).toThrow();
});

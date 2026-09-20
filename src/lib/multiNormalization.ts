import type { Candle } from './engine';
import type { ComparisonResult } from './comparison';
import {
  computeNormalizedView,
  type ChartDisplaySettings,
  type NormalizedView,
} from './chartNormalization';

export type MultiNormalizedView = NormalizedView & {
  comparisons: (ComparisonResult | null)[];
};

/** All active comparisons share one baseline and statistical sample window. */
export function computeMultiNormalizedView(
  base: Candle[],
  benchmarks: (Candle[] | null)[],
  settings: ChartDisplaySettings,
): MultiNormalizedView {
  const loaded = benchmarks.filter((bars): bars is Candle[] => bars !== null);
  if (loaded.length <= 1) {
    const view = computeNormalizedView(base, loaded[0] ?? null, settings);
    return {
      ...view,
      comparisons: benchmarks.map((bars) =>
        bars === null ? null : view.comparison,
      ),
    };
  }
  const times = loaded.map(
    (bars) =>
      new Set(
        bars
          .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
          .map((bar) => bar.time),
      ),
  );
  const shared = base.filter((bar) => times.every((set) => set.has(bar.time)));
  if (!shared.length) {
    const view = computeNormalizedView(base, null, settings);
    const empty = { anchor: null, latest: null, points: [] };
    return {
      ...view,
      comparison: empty,
      comparisons: benchmarks.map((bars) => (bars === null ? null : empty)),
      notice:
        'Waiting for a revealed candle shared by all comparison tickers. The base chart keeps its independent display until then.',
    };
  }
  let views = benchmarks.map((bars) =>
    bars === null ? null : computeNormalizedView(shared, bars, settings),
  );
  const fallback = views.find((view) => view?.notice);
  if (fallback) {
    // A flat/insufficient window in any instrument falls back consistently for
    // every line rather than mixing prices and statistical units on one axis.
    views = benchmarks.map((bars) =>
      bars === null
        ? null
        : computeNormalizedView(shared, bars, {
            ...settings,
            normalization: 'price',
            scale: 'linear',
          }),
    );
  }
  const first = views.find((view): view is NormalizedView => view !== null)!;
  return {
    ...first,
    notice: fallback?.notice ?? null,
    comparisons: views.map((view) => view?.comparison ?? null),
  };
}

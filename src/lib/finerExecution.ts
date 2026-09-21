import {
  advanceBar,
  advanceWithSubBars,
  type Candle,
  type TradingState,
} from './engine';
import { isValidMarketData, type MarketData } from './data';
import { candleDuration } from './timeframes';
export function finerBarsForCandle(
  base: Candle,
  nextTime: number | undefined,
  market: MarketData,
): Candle[] {
  const end = base.endTime ?? nextTime;
  if (!end) return [];
  const duration = candleDuration(market.bars);
  let lo = 0,
    hi = market.bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (market.bars[mid].time < base.time) lo = mid + 1;
    else hi = mid;
  }
  const selected: Candle[] = [];
  for (let i = lo; i < market.bars.length && market.bars[i].time < end; i++) {
    const b = market.bars[i];
    if ((b.endTime ?? b.time + duration) > end || b.complete === false)
      return [];
    selected.push(b);
  }
  if (selected.length < 2) return [];
  const close = (a: number, b: number) =>
    Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-6;
  // Reconciliation catches missing or incompatible finer history. Never mix
  // adjusted/unadjusted snapshots or infer an unseen intrabar path.
  if (
    !close(selected[0].open, base.open) ||
    !close(selected.at(-1)!.close, base.close) ||
    !close(Math.max(...selected.map((b) => b.high)), base.high) ||
    !close(Math.min(...selected.map((b) => b.low)), base.low) ||
    !close(
      selected.reduce((n, b) => n + b.volume, 0),
      base.volume,
    )
  )
    return [];
  return selected;
}
export function validateFiner(base: MarketData, finer: MarketData) {
  if (
    !isValidMarketData(finer) ||
    finer.bars.length > 100000 ||
    base.ticker !== finer.ticker ||
    base.currency !== finer.currency ||
    base.adjusted !== finer.adjusted ||
    candleDuration(finer.bars) >= candleDuration(base.bars)
  )
    throw new Error(
      'Choose finer candles for the same ticker, currency and price adjustment.',
    );
  if (
    !base.bars.some(
      (b, i) => finerBarsForCandle(b, base.bars[i + 1]?.time, finer).length,
    )
  )
    throw new Error(
      'No complete finer-candle windows reconcile with this dataset. Check range, prices and volume.',
    );
}
export function advanceExecution(
  state: TradingState,
  bar: Candle,
  nextTime?: number,
  finer?: MarketData,
  protectionAtOpen = false,
) {
  const candles = finer ? finerBarsForCandle(bar, nextTime, finer) : [];
  const next = candles.length
    ? advanceWithSubBars(state, bar, candles)
    : advanceBar(state, bar, protectionAtOpen);
  return finer
    ? {
        ...next,
        executionCoverage: {
          fine: (state.executionCoverage?.fine ?? 0) + (candles.length ? 1 : 0),
          fallback:
            (state.executionCoverage?.fallback ?? 0) + (candles.length ? 0 : 1),
        },
      }
    : next;
}

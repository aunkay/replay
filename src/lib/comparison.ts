import type { MarketData } from './data';
import type { Candle } from './engine';

export type ComparisonNormalization = 'percent' | 'indexed' | 'price';
export type ComparisonScale = 'linear' | 'log';
export type ComparisonResult = {
  anchor: { time: number; baseClose: number; benchmarkClose: number } | null;
  points: { time: number; value: number }[];
  latest: {
    time: number;
    baseClose: number;
    benchmarkClose: number;
    baseReturn: number;
    benchmarkReturn: number;
  } | null;
};

type OriginalRequest = { start?: string; end?: string; period?: string };
// Kept structural so legacy MarketData objects need no request metadata.
type RequestedMarket = MarketData & { request?: OriginalRequest };

const positive = (value: number) => Number.isFinite(value) && value > 0;
const validClose = (bar: Candle) =>
  Number.isFinite(bar.time) && positive(bar.close);

/**
 * Rebase a benchmark onto the base price at the first exact shared timestamp.
 * The caller supplies only revealed base candles. No value is filled across a
 * missing timestamp, and benchmark-only or unrevealed candles never contribute.
 * Raw positive prices preserve chart coordinates, logarithmic scales and trades;
 * percentage/indexed modes change display labels, never the stored candles.
 */
export function computeComparison(
  baseBars: Candle[],
  benchmarkBars: Candle[],
): ComparisonResult {
  const benchmarks = new Map(
    benchmarkBars.filter(validClose).map((bar) => [bar.time, bar.close]),
  );
  const result: ComparisonResult = { anchor: null, points: [], latest: null };
  let previousTime = -Infinity;
  for (const base of baseBars) {
    if (!validClose(base) || base.time <= previousTime) continue;
    const benchmarkClose = benchmarks.get(base.time);
    if (benchmarkClose === undefined) continue;
    const anchor = result.anchor ?? {
      time: base.time,
      baseClose: base.close,
      benchmarkClose,
    };
    const value = (benchmarkClose / anchor.benchmarkClose) * anchor.baseClose;
    const baseReturn = (base.close / anchor.baseClose - 1) * 100;
    const benchmarkReturn = (benchmarkClose / anchor.benchmarkClose - 1) * 100;
    if (
      ![value, baseReturn, benchmarkReturn].every(Number.isFinite) ||
      value <= 0
    )
      continue;
    result.anchor = anchor;
    result.points.push({ time: base.time, value });
    result.latest = {
      time: base.time,
      baseClose: base.close,
      benchmarkClose,
      baseReturn,
      benchmarkReturn,
    };
    previousTime = base.time;
  }
  return result;
}

/** Convert a raw chart price to a display unit using the same base anchor. */
export function comparisonValue(
  price: number,
  anchorBase: number,
  normalization: ComparisonNormalization,
): number {
  if (!Number.isFinite(price)) return NaN;
  if (normalization === 'price') return price;
  if (!positive(anchorBase)) return NaN;
  const ratio = price / anchorBase;
  return normalization === 'percent' ? (ratio - 1) * 100 : ratio * 100;
}

export function comparisonLabel(
  price: number,
  anchorBase: number,
  normalization: ComparisonNormalization,
): string {
  const value = comparisonValue(price, anchorBase, normalization);
  if (!Number.isFinite(value)) return '—';
  // Suppress negative zero caused by normalizing prices at floating precision.
  const displayed = Math.abs(value) < 0.005 ? 0 : value;
  return `${displayed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${normalization === 'percent' ? '%' : ''}`;
}

const DAY = 86_400_000;
function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}
function utcDay(time: number) {
  const value = Math.floor((time * 1000) / DAY) * DAY;
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime()))
    throw new Error(
      'The loaded market has invalid candle dates. Reload market data before comparing.',
    );
  return value;
}
const dateLabel = (milliseconds: number) =>
  new Date(milliseconds).toISOString().slice(0, 10);

/**
 * Yahoo start is inclusive and end is exclusive:
 * https://ranaroussi.github.io/yfinance/reference/api/yfinance.download.html
 * Preserve original custom cutoffs where available, including partial weekly
 * or monthly candles. Legacy datasets need enough end coverage for an entire
 * aggregate bar, capped at the snapshot's fetched UTC day. Intraday timestamps
 * select dates only; computeComparison still demands exact candle alignment.
 */
export function benchmarkRequest(
  base: MarketData,
  ticker: string,
): Record<string, string> {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!normalizedTicker) throw new Error('Enter a benchmark ticker.');
  if (!base.bars.length)
    throw new Error('Load market data before adding a benchmark.');
  const first = utcDay(base.bars[0].time);
  const last = utcDay(base.bars.at(-1)!.time);
  if (first > last)
    throw new Error(
      'The loaded market has invalid candle dates. Reload market data before comparing.',
    );
  const requested = (base as RequestedMarket).request;
  if (
    calendarDate(requested?.start) &&
    calendarDate(requested?.end) &&
    requested.start < requested.end &&
    requested.start <= dateLabel(first) &&
    requested.end > dateLabel(last)
  ) {
    return {
      ticker: normalizedTicker,
      interval: base.interval,
      start: requested.start,
      end: requested.end,
    };
  }

  let end = last + DAY;
  if (base.interval === '1wk') end = last + 7 * DAY;
  // yfinance's multiday resampling uses 5D, not five exchange sessions.
  if (base.interval === '5d') end = last + 5 * DAY;
  if (base.interval === '1mo' || base.interval === '3mo') {
    const date = new Date(last);
    end = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + (base.interval === '1mo' ? 1 : 3),
      1,
    );
  }
  const fetched = Date.parse(base.fetchedAt);
  if (Number.isFinite(fetched)) {
    const snapshotEnd = Math.floor(fetched / DAY) * DAY + DAY;
    // Corrupt legacy metadata must not truncate a candle we demonstrably have.
    end = Math.max(last + DAY, Math.min(end, snapshotEnd));
  }
  return {
    ticker: normalizedTicker,
    interval: base.interval,
    start: dateLabel(first),
    end: dateLabel(end),
  };
}

/** Dataset identity, independent of replay cursor, chart mode and annotations. */
export function marketComparisonKey(base: MarketData): string {
  const request = (base as RequestedMarket).request;
  return JSON.stringify([
    base.source,
    base.ticker,
    base.interval,
    base.fetchedAt,
    base.bars[0]?.time ?? null,
    base.bars.at(-1)?.time ?? null,
    base.bars.length,
    base.adjusted,
    base.currency,
    typeof request?.start === 'string' ? request.start : null,
    typeof request?.end === 'string' ? request.end : null,
    typeof request?.period === 'string' ? request.period : null,
  ]);
}

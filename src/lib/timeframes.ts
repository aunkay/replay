import type { Candle } from './engine';
export const RULE_INTERVALS = {
  '1m': 60,
  '2m': 120,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '60m': 3600,
  '90m': 5400,
  '1d': 86400,
  '5d': 432000,
  '1mo': 2592000,
  '3mo': 7776000,
  '1wk': 604800,
} as const;
export type RuleInterval = keyof typeof RULE_INTERVALS;
export function candleDuration(bars: Candle[]) {
  const durations = bars
    .slice(0, 1000)
    .map((b, i) =>
      b.endTime && b.endTime > b.time
        ? b.endTime - b.time
        : i
          ? b.time - bars[i - 1].time
          : Infinity,
    )
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  return durations[Math.floor(durations.length / 2)] ?? 1;
}
/** UTC aligned aggregation. No bucket is visible before its scheduled close. */
export function aggregateTimeframe(
  bars: Candle[],
  interval: RuleInterval,
): Candle[] {
  const duration = candleDuration(bars),
    seconds = RULE_INTERVALS[interval];
  if (seconds < duration || (seconds < 86400 && seconds % duration !== 0))
    throw new Error(
      'Rule interval must be at least the base interval and align with its candles. Load a finer base interval.',
    );
  const groups = new Map<number, Candle>();
  const shift = interval === '1wk' ? 345600 : 0; // Monday 00:00 UTC
  for (const b of bars) {
    let time = Math.floor((b.time - shift) / seconds) * seconds + shift,
      endTime = time + seconds;
    if (interval === '1mo' || interval === '3mo') {
      const date = new Date(b.time * 1000),
        months = interval === '1mo' ? 1 : 3;
      const month = Math.floor(date.getUTCMonth() / months) * months;
      time = Date.UTC(date.getUTCFullYear(), month, 1) / 1000;
      endTime = Date.UTC(date.getUTCFullYear(), month + months, 1) / 1000;
    }
    if ((b.endTime ?? b.time + duration) > endTime)
      throw new Error(
        'Base candles cross a selected rule timeframe boundary. Load a finer base interval.',
      );
    const old = groups.get(time);
    if (old) {
      old.high = Math.max(old.high, b.high);
      old.low = Math.min(old.low, b.low);
      old.close = b.close;
      old.volume += b.volume;
    } else
      groups.set(time, {
        time,
        endTime,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      });
  }
  // Do not use a possibly truncated first bucket as a complete higher candle.
  const result = [...groups.values()];
  if (result[0] && bars[0].time > result[0].time) result.shift();
  return result;
}

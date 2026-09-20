import type { Candle } from './engine';

export const READABLE_CANDLE_SPACING = 5;
export const CHART_RIGHT_PADDING = 6;

/** Keep the linked ending instant, but bound candle density on finer intervals. */
export function linkedLogicalRange(
  bars: Candle[],
  from: number,
  to: number,
  width: number,
) {
  if (
    !bars.length ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from > to ||
    to < bars[0].time ||
    from > bars.at(-1)!.time
  )
    return null;
  const lowerBound = (time: number) => {
    let low = 0,
      high = bars.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (bars[mid].time < time) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const first = lowerBound(from);
  const after = lowerBound(to);
  const last =
    after < bars.length && bars[after].time === to ? after : after - 1;
  if (last < first) return null;
  const capacity = Math.max(
    10,
    Math.floor(width / READABLE_CANDLE_SPACING) - CHART_RIGHT_PADDING,
  );
  const count = Math.max(10, Math.min(capacity, last - first + 1));
  return {
    from: Math.max(-2, last - count + 1),
    to: last + (last === bars.length - 1 ? CHART_RIGHT_PADDING : 0),
  };
}

/** Visible chart times are candle opens, whereas replay advances through closes. */
export function linkedEndingTime(
  bar: Candle | undefined,
  time: number,
  fallbackEnd?: number,
) {
  return Math.max(time, (bar?.endTime ?? fallbackEnd ?? time + 1) - 1);
}

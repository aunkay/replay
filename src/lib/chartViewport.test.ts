import { expect, it } from 'vitest';
import { linkedEndingTime, linkedLogicalRange } from './chartViewport';
const bars = Array.from({ length: 1000 }, (_, i) => ({
  time: i * 300,
  endTime: (i + 1) * 300,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1,
}));
it('links through the source candle close so the daily session remains visible', () => {
  expect(linkedEndingTime({ ...bars[0], endTime: 72000 }, 0)).toBe(71999);
  expect(linkedEndingTime(undefined, 300)).toBe(300);
  expect(linkedEndingTime({ ...bars[0], endTime: undefined }, 0, 72000)).toBe(
    71999,
  );
});
it('caps dense intraday ranges with readable candles while retaining their right edge', () => {
  const range = linkedLogicalRange(bars, 0, 299999, 300)!;
  expect(range.to).toBe(1005);
  expect(300 / (range.to - range.from + 1)).toBeGreaterThanOrEqual(5);
  expect(range.to).toBeGreaterThan(bars.length - 1);
});
it('uses the last eligible candle and gives a sparse range context without future candles', () => {
  expect(linkedLogicalRange(bars, 600, 1499, 500)).toEqual({
    from: -2,
    to: 4,
  });
  expect(linkedLogicalRange(bars, -600, -1, 500)).toBeNull();
  expect(linkedLogicalRange(bars, 500000, 600000, 500)).toBeNull();
  expect(linkedLogicalRange(bars, NaN, 1000, 500)).toBeNull();
});

it('reattaches a panned viewport with the same zoom and fixed right margin', async () => {
  const { followReplayRange } = await import('./chartViewport');
  expect(followReplayRange(100, { from: 10, to: 50 })).toEqual({
    from: 65,
    to: 105,
  });
  expect(followReplayRange(101, { from: 65, to: 105 })).toEqual({
    from: 66,
    to: 106,
  });
  expect(followReplayRange(0, null)).toBeNull();
});

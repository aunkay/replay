import { expect, it } from 'vitest';
import { aggregateTimeframe } from './timeframes';
import { createRuleEvaluator, type Rule } from './strategy';
import type { Candle } from './engine';
const bars: Candle[] = Array.from({ length: 30 }, (_, i) => ({
  time: i * 60,
  endTime: (i + 1) * 60,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
  volume: 10,
}));
it('aggregates OHLCV and only reveals higher values at their close', () => {
  const higher = aggregateTimeframe(bars, '5m');
  expect(higher[0]).toEqual({
    time: 0,
    endTime: 300,
    open: 100,
    high: 105,
    low: 99,
    close: 104,
    volume: 50,
  });
  const rule: Rule = {
    join: 'and',
    conditions: [
      {
        left: { kind: 'price', field: 'close', interval: '5m' },
        op: 'gt',
        right: { kind: 'constant', value: 103 },
      },
    ],
  };
  const matches = createRuleEvaluator(bars);
  expect(matches(rule, 3)).toBe(false);
  expect(matches(rule, 4)).toBe(true);
  const altered = bars.map((b, i) =>
    i < 5 ? b : { ...b, open: 999, high: 1000, low: 998, close: 999 },
  );
  expect(createRuleEvaluator(altered)(rule, 4)).toBe(matches(rule, 4));
});
it('higher indicator warm-up and offsets count higher candles', () => {
  const rule: Rule = {
    join: 'and',
    conditions: [
      {
        left: {
          kind: 'indicator',
          indicator: 'sma',
          period: 2,
          interval: '5m',
          offset: 1,
        },
        op: 'gt',
        right: { kind: 'constant', value: 100 },
      },
    ],
  };
  const matches = createRuleEvaluator(bars);
  expect(matches(rule, 13)).toBe(false);
  expect(matches(rule, 14)).toBe(true);
});
it('crossovers fire on the base candle that completes the higher candle', () => {
  const rule: Rule = {
    join: 'and',
    conditions: [
      {
        left: { kind: 'price', field: 'close', interval: '5m' },
        op: 'crossUp',
        right: { kind: 'constant', value: 106 },
      },
    ],
  };
  const matches = createRuleEvaluator(bars);
  expect(matches(rule, 8)).toBe(false);
  expect(matches(rule, 9)).toBe(true);
  expect(matches(rule, 10)).toBe(false);
});
it('rejects finer and non-aligned timeframes instead of inventing data', () => {
  expect(() =>
    aggregateTimeframe(
      bars.map((b) => ({ ...b, time: b.time * 2, endTime: b.endTime! * 2 })),
      '1m',
    ),
  ).toThrow(/finer/);
  expect(() =>
    aggregateTimeframe(
      bars.map((b) => ({ ...b, time: b.time * 2, endTime: b.endTime! * 2 })),
      '5m',
    ),
  ).toThrow(/align/);
});
it('calendar months close on the actual month boundary', () => {
  const start = Date.parse('2025-01-01T00:00:00Z') / 1000;
  const daily = Array.from({ length: 40 }, (_, i) => ({
    time: start + i * 86400,
    endTime: start + (i + 1) * 86400,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 10,
  }));
  const rule: Rule = {
    join: 'and',
    conditions: [
      {
        left: { kind: 'price', field: 'close', interval: '1mo' },
        op: 'gt',
        right: { kind: 'constant', value: 125 },
      },
    ],
  };
  const matches = createRuleEvaluator(daily);
  expect(matches(rule, 29)).toBe(false);
  expect(matches(rule, 30)).toBe(true);
});

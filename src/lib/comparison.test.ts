import { describe, expect, it } from 'vitest';
import type { MarketData } from './data';
import type { Candle } from './engine';
import {
  benchmarkRequest,
  comparisonLabel,
  comparisonValue,
  computeComparison,
  marketComparisonKey,
} from './comparison';

const day = (value: string) => Date.parse(value) / 1000;
const candle = (time: number, close: number): Candle => ({
  time,
  close,
  open: close,
  high: close,
  low: close,
  volume: 100,
});
function market(
  interval = '1d',
  dates = ['2025-01-02', '2025-01-03'],
): MarketData & {
  request?: { start?: string; end?: string; period?: string };
} {
  return {
    ticker: 'AAPL',
    name: 'Apple',
    currency: 'USD',
    exchange: 'NASDAQ',
    interval,
    source: 'yfinance',
    adjusted: true,
    fetchedAt: '2026-09-19T10:00:00Z',
    range: { start: dates[0], end: dates.at(-1)! },
    warnings: [],
    bars: dates.map((date, i) => candle(day(date), 100 + 10 * i)),
  };
}

describe('comparison rebasing', () => {
  it('compares percentage returns for instruments with unequal starting prices', () => {
    const base = [candle(1, 50), candle(2, 60), candle(3, 55)];
    const benchmark = [candle(1, 200), candle(2, 210), candle(3, 180)];
    const result = computeComparison(base, benchmark);
    expect(result.anchor).toEqual({
      time: 1,
      baseClose: 50,
      benchmarkClose: 200,
    });
    expect(result.points).toEqual([
      { time: 1, value: 50 },
      { time: 2, value: 52.5 },
      { time: 3, value: 45 },
    ]);
    expect(result.latest).toMatchObject({
      time: 3,
      baseClose: 55,
      benchmarkClose: 180,
    });
    expect(result.latest!.baseReturn).toBeCloseTo(10, 12);
    expect(result.latest!.benchmarkReturn).toBeCloseTo(-10, 12);
  });

  it('anchors at the first exact overlap and does not carry prices across gaps', () => {
    const base = [
      candle(1, 10),
      candle(2, 20),
      candle(3, 30),
      candle(5, 40),
      candle(6, 50),
    ];
    const benchmark = [
      candle(0, 999),
      candle(2, 100),
      candle(4, 300),
      candle(5, 150),
      candle(7, 700),
    ];
    const result = computeComparison(base, benchmark);
    expect(result.anchor).toEqual({
      time: 2,
      baseClose: 20,
      benchmarkClose: 100,
    });
    expect(result.points).toEqual([
      { time: 2, value: 20 },
      { time: 5, value: 30 },
    ]);
    expect(result.latest).toEqual({
      time: 5,
      baseClose: 40,
      benchmarkClose: 150,
      baseReturn: 100,
      benchmarkReturn: 50,
    });
  });

  it('keeps the same anchor and historical output as each candle is revealed', () => {
    const base = Array.from({ length: 8 }, (_, i) => candle(i, 100 + i * 10));
    const benchmark = Array.from({ length: 12 }, (_, i) =>
      candle(i + 2, 50 + i * 5),
    );
    const full = computeComparison(base, benchmark);
    for (let length = 0; length <= base.length; length++) {
      const result = computeComparison(base.slice(0, length), benchmark);
      expect(result.points).toEqual(
        full.points.filter((point) => point.time < length),
      );
      if (length <= 2)
        expect(result).toEqual({ anchor: null, points: [], latest: null });
      else expect(result.anchor).toEqual(full.anchor);
    }
    const original = computeComparison(base.slice(0, 4), benchmark);
    const modifiedFuture = benchmark.map((bar) =>
      bar.time > 3 ? { ...bar, close: 1_000_000 } : bar,
    );
    expect(computeComparison(base.slice(0, 4), modifiedFuture)).toEqual(
      original,
    );
  });

  it('requires exact intraday timestamps, including different market opening times', () => {
    const base = [
      candle(day('2025-01-02T14:30:00Z'), 100),
      candle(day('2025-01-02T15:30:00Z'), 110),
    ];
    const benchmark = [
      candle(day('2025-01-02T14:00:00Z'), 200),
      candle(day('2025-01-02T15:00:00Z'), 220),
    ];
    expect(computeComparison(base, benchmark)).toEqual({
      anchor: null,
      points: [],
      latest: null,
    });
  });

  it('handles an empty series or no overlap without manufacturing a baseline', () => {
    for (const [base, benchmark] of [
      [[], []],
      [[candle(1, 10)], []],
      [[], [candle(1, 10)]],
      [[candle(1, 10)], [candle(2, 20)]],
    ]) {
      expect(computeComparison(base, benchmark)).toEqual({
        anchor: null,
        points: [],
        latest: null,
      });
    }
  });

  it('omits invalid prices and numeric overflow while leaving both source arrays unchanged', () => {
    const base = [candle(1, 0), candle(2, 100), candle(3, NaN), candle(4, 125)];
    const benchmark = [
      candle(1, 50),
      candle(2, 200),
      candle(3, Infinity),
      candle(4, 250),
    ];
    const before = structuredClone({ base, benchmark });
    const result = computeComparison(base, benchmark);
    expect(result.points).toEqual([
      { time: 2, value: 100 },
      { time: 4, value: 125 },
    ]);
    expect({ base, benchmark }).toEqual(before);
    const extreme = computeComparison(
      [candle(1, 1e300), candle(2, 1e300)],
      [candle(1, 1e-100), candle(2, 1e300)],
    );
    expect(extreme.points).toEqual([{ time: 1, value: 1e300 }]);
    expect(extreme.latest?.time).toBe(1);
  });
});

describe('comparison display units', () => {
  it('formats percent, indexed-to-100, and raw rebased price without changing coordinates', () => {
    expect(comparisonValue(55, 50, 'percent')).toBeCloseTo(10, 12);
    expect(comparisonValue(55, 50, 'indexed')).toBeCloseTo(110, 12);
    expect(comparisonValue(55, 50, 'price')).toBe(55);
    expect(comparisonLabel(55, 50, 'percent')).toBe('10.00%');
    expect(comparisonLabel(45, 50, 'percent')).toBe('-10.00%');
    expect(comparisonLabel(55, 50, 'indexed')).toBe('110.00');
    expect(comparisonLabel(1234.5, 50, 'price')).toBe('1,234.50');
    expect(comparisonLabel(50, 50, 'percent')).toBe('0.00%');
    expect(comparisonLabel(50, 50, 'indexed')).toBe('100.00');
  });

  it('does not render invalid normalization anchors or negative zero', () => {
    expect(comparisonLabel(50, 0, 'percent')).toBe('—');
    expect(comparisonLabel(NaN, 50, 'price')).toBe('—');
    expect(comparisonLabel(50 - Number.EPSILON * 50, 50, 'percent')).toBe(
      '0.00%',
    );
    expect(comparisonLabel(25, 0, 'price')).toBe('25.00');
  });
});

describe('benchmark history request coverage', () => {
  it('normalizes tickers and includes the final daily candle with an exclusive end', () => {
    expect(benchmarkRequest(market(), ' spy ')).toEqual({
      ticker: 'SPY',
      interval: '1d',
      start: '2025-01-02',
      end: '2025-01-04',
    });
  });

  it('uses UTC dates for hourly histories across calendar and DST boundaries', () => {
    expect(
      benchmarkRequest(
        market('60m', ['2025-03-29T23:30:00Z', '2025-03-31T00:30:00Z']),
        'MSFT',
      ),
    ).toEqual({
      ticker: 'MSFT',
      interval: '60m',
      start: '2025-03-29',
      end: '2025-04-01',
    });
  });

  it.each([
    ['1wk', ['2025-01-06', '2025-01-13'], '2025-01-20'],
    ['5d', ['2025-01-06', '2025-01-11'], '2025-01-16'],
    ['1mo', ['2024-01-01', '2024-02-01'], '2024-03-01'],
    ['1mo', ['2024-11-01', '2024-12-01'], '2025-01-01'],
    ['3mo', ['2024-08-01', '2024-11-01'], '2025-02-01'],
  ])('covers the last %s aggregate period', (interval, dates, end) => {
    expect(
      benchmarkRequest(market(interval as string, dates as string[]), 'SPY')
        .end,
    ).toBe(end);
  });

  it('caps an unfinished aggregate period at the base snapshot UTC day', () => {
    const base = market('1mo', ['2025-01-01', '2025-02-01']);
    base.fetchedAt = '2025-02-14T18:00:00Z';
    expect(benchmarkRequest(base, 'SPY').end).toBe('2025-02-15');
  });

  it('preserves the exact custom weekly cutoff, including a partially sampled final week', () => {
    const base = market('1wk', ['2025-01-06', '2025-01-13']);
    base.request = { start: '2025-01-04', end: '2025-01-15' };
    expect(benchmarkRequest(base, 'SPY')).toEqual({
      ticker: 'SPY',
      interval: '1wk',
      start: '2025-01-04',
      end: '2025-01-15',
    });
  });

  it('preserves an original partial monthly range rather than extending to month end', () => {
    const base = market('1mo', ['2025-01-01', '2025-02-01']);
    base.request = { start: '2025-01-01', end: '2025-02-03' };
    expect(benchmarkRequest(base, 'SPY').end).toBe('2025-02-03');
  });

  it.each([
    { start: '2025-01-02' },
    { start: '2025-01-02', end: '2025-02-30' },
    { start: '2025-01-04', end: '2025-01-02' },
    { start: '2025-01-02', end: '2025-01-03' },
    { start: '2025-01-03', end: '2025-01-10' },
    { start: '2025-01-02T00:00:00Z', end: '2025-01-04' },
    { period: '1y' },
  ])(
    'derives dates when original metadata is invalid, incomplete or inconsistent: %j',
    (request) => {
      const base = market();
      base.request = request;
      expect(benchmarkRequest(base, 'SPY')).toEqual({
        ticker: 'SPY',
        interval: '1d',
        start: '2025-01-02',
        end: '2025-01-04',
      });
    },
  );

  it('refuses empty input and malformed candle dates with a useful error', () => {
    expect(() => benchmarkRequest({ ...market(), bars: [] }, 'SPY')).toThrow(
      'Load market data',
    );
    expect(() => benchmarkRequest(market(), '  ')).toThrow('benchmark ticker');
    expect(() =>
      benchmarkRequest({ ...market(), bars: [candle(NaN, 100)] }, 'SPY'),
    ).toThrow('invalid candle dates');
  });
});

describe('comparison cache identity', () => {
  it('is stable for copied data and distinguishes market, interval, fetch, bounds and request cutoffs', () => {
    const base = market();
    const key = marketComparisonKey(base);
    expect(marketComparisonKey(structuredClone(base))).toBe(key);
    for (const modified of [
      { ...base, source: 'demo' as const },
      { ...base, ticker: 'MSFT' },
      { ...base, interval: '60m' },
      { ...base, fetchedAt: '2026-09-19T11:00:00Z' },
      {
        ...base,
        bars: [
          { ...base.bars[0], time: base.bars[0].time - 86400 },
          base.bars[1],
        ],
      },
      {
        ...base,
        bars: [
          base.bars[0],
          { ...base.bars[1], time: base.bars[1].time + 86400 },
        ],
      },
      { ...base, adjusted: false },
      { ...base, currency: 'EUR' },
      { ...base, request: { start: '2025-01-01', end: '2025-01-05' } },
      { ...base, request: { period: '1y' } },
    ])
      expect(marketComparisonKey(modified)).not.toBe(key);
    expect(marketComparisonKey({ ...base, name: 'Updated display name' })).toBe(
      key,
    );
  });
});

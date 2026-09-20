import { expect, it } from 'vitest';
import { createDemo } from './data';
import { panelMarketRequest } from './panelMarket';
const now = Date.parse('2026-09-21T10:00:00Z');
const market = {
  ...createDemo(),
  request: { start: '2025-01-01', end: '2026-09-22' },
};
it('clips daily history to the independent intraday retention window', () => {
  expect(panelMarketRequest(market, 'AAPL', '5m', now)).toEqual({
    ticker: 'AAPL',
    interval: '5m',
    start: '2026-07-24',
    end: '2026-09-22',
  });
  expect(panelMarketRequest(market, 'AAPL', '2m', now).start).toBe(
    '2026-07-24',
  );
  expect(panelMarketRequest(market, 'AAPL', '1m', now).start).toBe(
    '2026-09-15',
  );
});
it('preserves supported explicit ranges and chooses independent rolling periods', () => {
  expect(
    panelMarketRequest(
      { ...market, request: { start: '2026-09-01', end: '2026-09-10' } },
      'SPY',
      '5m',
      now,
    ).start,
  ).toBe('2026-09-01');
  expect(
    panelMarketRequest(
      { ...market, request: { period: '5y' } },
      'AAPL',
      '2m',
      now,
    ),
  ).toEqual({ ticker: 'AAPL', interval: '2m', period: '1mo' });
  expect(panelMarketRequest(market, 'AAPL', '1d', now).start).toBe(
    '2025-01-01',
  );
});
it('explains unavailable historical intraday data rather than requesting unrelated future candles', () => {
  expect(() =>
    panelMarketRequest(
      { ...market, request: { start: '2024-01-01', end: '2024-02-01' } },
      'AAPL',
      '5m',
      now,
    ),
  ).toThrow('Different chart intervals are supported');
});

it('aligns rolling requests with the actual base snapshot, including history older than one month', () => {
  const m = {
    ...market,
    source: 'yfinance' as const,
    request: { period: '1y' },
    bars: [
      { ...market.bars[0], time: Date.parse('2025-09-21') / 1000 },
      { ...market.bars[1], time: Date.parse('2026-09-18') / 1000 },
    ],
  };
  expect(panelMarketRequest(m, 'AAPL', '5m', now)).toEqual({
    ticker: 'AAPL',
    interval: '5m',
    start: '2026-07-24',
    end: '2026-09-19',
  });
});

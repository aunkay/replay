import { expect, it } from 'vitest';
import { advanceExecution, validateFiner } from './finerExecution';
import { createAccount, advanceBar, submitOrder, type Candle } from './engine';
import { createDemo, type MarketData } from './data';
import { isValidSession } from './session';
const candle = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle => ({ time, open, high, low, close, volume: 10, endTime: time + 60 });
const small = [
  candle(300, 100, 106, 99, 105),
  candle(360, 105, 110, 104, 108),
  candle(420, 108, 109, 100, 101),
  candle(480, 101, 102, 90, 95),
  candle(540, 95, 101, 94, 100),
];
const parent = {
  time: 300,
  endTime: 600,
  open: 100,
  high: 110,
  low: 90,
  close: 100,
  volume: 50,
};
const base = {
  ...createDemo(),
  interval: '5m',
  bars: [{ ...parent, time: 0, endTime: 300, high: 101, low: 99 }, parent],
};
const fine: MarketData = { ...base, interval: '1m', bars: small };
it('uses a reconciled finer path to resolve target before stop and saves valid base ledger', () => {
  validateFiner(base, fine);
  let account = advanceBar(
    createAccount({ initialCapital: 10000, commissionBps: 0, slippageBps: 0 }),
    base.bars[0],
  );
  account = submitOrder(
    account,
    {
      side: 'buy',
      type: 'market',
      quantity: 10,
      stopLoss: 95,
      takeProfit: 107,
    },
    base.bars[0],
  );
  const conservative = advanceExecution(account, parent);
  expect(conservative.cash).toBe(9950);
  const precise = advanceExecution(account, parent, undefined, fine);
  expect(precise.cash).toBe(10070);
  expect(precise.orders.find((o) => o.role === 'takeProfit')).toMatchObject({
    status: 'filled',
    filledAt: 300,
    executionTime: 360,
  });
  expect(
    isValidSession({
      market: base,
      cursor: 1,
      startCursor: 0,
      account: precise,
      finerMarket: fine,
    }),
  ).toBe(true);
});
it('falls back rather than trusting missing finer volume', () => {
  const account = advanceBar(
    createAccount({ initialCapital: 10000, commissionBps: 0, slippageBps: 0 }),
    base.bars[0],
  );
  const result = advanceExecution(account, parent, undefined, {
    ...fine,
    bars: small.slice(1),
  });
  expect(result.executionCoverage).toEqual({ fine: 0, fallback: 1 });
});
it('strategy entries protect the first finer candle and preserve target-before-stop ordering', async () => {
  const { defaultStrategy, runStrategy } = await import('./strategy');
  const strategy = {
    ...defaultStrategy(),
    quantity: 10,
    stopPct: 5,
    targetPct: 7,
    config: { initialCapital: 10000, commissionBps: 0, slippageBps: 0 },
    longEntry: {
      join: 'and' as const,
      conditions: [
        {
          left: { kind: 'constant' as const, value: 1 },
          op: 'gt' as const,
          right: { kind: 'constant' as const, value: 0 },
        },
      ],
    },
    executionMarket: fine,
  };
  const result = runStrategy(strategy, base.bars);
  expect(result.metrics.totalPnl).toBe(70);
  expect(result.account.executionCoverage?.fine).toBe(1);
});
it('Live uses reconciled finer fills and never applies the same candle twice', async () => {
  const { initializeLive, applyLiveTick } = await import('./liveEngine');
  const market = {
    ...base,
    bars: base.bars.map((b) => ({ ...b, complete: true })),
  };
  const initialized = initializeLive(
    { ...market, bars: market.bars.slice(0, 1) },
    { initialCapital: 10000, commissionBps: 0, slippageBps: 0 },
  );
  const state = {
    ...initialized,
    finerMarket: fine,
    account: submitOrder(
      initialized.account,
      {
        side: 'buy',
        type: 'market',
        quantity: 10,
        stopLoss: 95,
        takeProfit: 107,
      },
      market.bars[0],
    ),
  };
  const result = applyLiveTick(state, market, [], 0, [], {
    ...fine,
    bars: small.map((b) => ({ ...b, complete: true })),
  });
  expect(result.session.account.cash).toBe(10070);
  expect(result.session.account.executionCoverage).toEqual({
    fine: 1,
    fallback: 0,
  });
  expect(isValidSession(result.session)).toBe(true);
  expect(applyLiveTick(result.session, market, [], 0).session.account).toEqual(
    result.session.account,
  );
});

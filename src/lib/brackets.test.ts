import { describe, expect, it } from 'vitest';
import {
  advanceBar,
  createAccount,
  submitOrder,
  closePosition,
  editBracket,
  type Candle,
} from './engine';
import { sizeByRisk } from './risk';
import { closedTrades, analyzeTrades } from './analytics';
import { defaultStrategy, runStrategy, optimizeStrategy } from './strategy';
const config = { initialCapital: 10000, commissionBps: 0, slippageBps: 0 };
const bar = (
  time: number,
  open = 100,
  high = 110,
  low = 90,
  close = 100,
): Candle => ({ time, open, high, low, close, volume: 10 });
describe('protection', () => {
  it('stop wins an ambiguous candle and cancels the target', () => {
    let s = submitOrder(
      createAccount(config),
      {
        side: 'buy',
        type: 'market',
        quantity: 10,
        stopLoss: 95,
        takeProfit: 105,
      },
      bar(1),
    );
    s = advanceBar(s, bar(2));
    expect(s.position.quantity).toBe(0);
    expect(s.cash).toBe(9950);
    expect(s.orders.find((o) => o.role === 'stopLoss')).toMatchObject({
      status: 'filled',
      ambiguous: true,
    });
    expect(s.orders.find((o) => o.role === 'takeProfit')?.status).toBe(
      'cancelled',
    );
  });
  it('short protection and gaps are reduce-only', () => {
    let s = submitOrder(
      createAccount(config),
      {
        side: 'sell',
        type: 'market',
        quantity: 10,
        stopLoss: 105,
        takeProfit: 95,
      },
      bar(1),
    );
    s = advanceBar(s, bar(2, 110, 115, 108, 112));
    expect(s.cash).toBe(9900);
    expect(s.position.quantity).toBe(0);
  });
  it('intrabar entry may hit a conservative stop but not an earlier target', () => {
    let s = submitOrder(
      createAccount(config),
      {
        side: 'buy',
        type: 'limit',
        price: 98,
        quantity: 10,
        stopLoss: 94,
        takeProfit: 104,
      },
      bar(1),
    );
    s = advanceBar(s, bar(2, 100, 110, 96, 100));
    expect(s.position.quantity).toBe(10);
    s = advanceBar(s, bar(3, 100, 106, 99, 104));
    expect(s.position.quantity).toBe(0);
  });
  it('manual close cancels exits and edits are prospective', () => {
    let s = submitOrder(
      createAccount(config),
      { side: 'buy', type: 'market', quantity: 10 },
      bar(1),
    );
    s = editBracket(s, 95, 105, bar(1));
    s = closePosition(s, bar(1));
    s = advanceBar(s, bar(2));
    expect(s.position.quantity).toBe(0);
    expect(s.orders.filter((o) => o.status === 'pending')).toHaveLength(0);
  });
  it('rejects invalid protection', () =>
    expect(
      submitOrder(
        createAccount(config),
        { side: 'buy', type: 'market', quantity: 1, stopLoss: 110 },
        bar(1),
      ).orders[0].status,
    ).toBe('rejected'));
});
it('risk rounds down and includes costs', () => {
  const r = sizeByRisk({
    entry: 100,
    stop: 95,
    side: 'buy',
    budget: 100,
    buyingPower: 10000,
    step: 1,
    config: { ...config, commissionBps: 10, slippageBps: 10 },
  });
  expect(r.quantity).toBeLessThan(20);
  expect(r.risk).toBeLessThanOrEqual(100);
});
it('flat-to-flat ledger allocates partial closes and reversal fees', () => {
  let s = submitOrder(
    createAccount({ ...config, commissionBps: 10 }),
    { side: 'buy', type: 'market', quantity: 10 },
    bar(1),
  );
  s = submitOrder(
    s,
    { side: 'sell', type: 'market', quantity: 5 },
    bar(2, 110, 110, 110, 110),
  );
  s = closePosition(s, bar(3, 120, 120, 120, 120));
  const t = closedTrades(s.orders);
  expect(t).toHaveLength(1);
  expect(t[0].pnl).toBeCloseTo(s.cash - 10000);
  expect(analyzeTrades(t).count).toBe(1);
});
it('strategy results are deterministic and optimization keeps a test holdout', () => {
  const bars = Array.from({ length: 160 }, (_, i) =>
    bar(i + 1, 100 + Math.sin(i / 8) * 10, 112, 88, 100 + Math.sin(i / 8) * 10),
  );
  const strategy = defaultStrategy();
  expect(runStrategy(strategy, bars)).toEqual(runStrategy(strategy, bars));
  const r = optimizeStrategy(strategy, bars, [
    { path: 'stopPct', values: [1, 2] },
  ]);
  expect(r.candidates).toHaveLength(2);
  expect(r.boundary).toBe(112);
});

it('trade episodes follow fill chronology, not pending-order submission order', () => {
  let state = submitOrder(
    createAccount(config),
    { side: 'buy', type: 'limit', quantity: 2, price: 80 },
    bar(1),
  );
  state = submitOrder(
    state,
    { side: 'buy', type: 'market', quantity: 1 },
    bar(2),
  );
  state = closePosition(state, bar(3, 105, 105, 105, 105));
  state = advanceBar(state, bar(4, 85, 90, 75, 85));
  state = closePosition(state, bar(5, 90, 90, 90, 90));
  const trades = closedTrades(state.orders);
  expect(trades.map((t) => t.pnl)).toEqual([5, 20]);
  expect(trades.reduce((sum, t) => sum + t.pnl, 0)).toBeCloseTo(
    state.cash - config.initialCapital,
  );
});

it('changing holdout prices cannot change training scores or selection', () => {
  const bars = Array.from({ length: 160 }, (_, i) =>
    bar(i + 1, 100 + Math.sin(i / 8) * 10, 112, 88, 100 + Math.sin(i / 8) * 10),
  );
  const grid = [{ path: 'stopPct', values: [1, 2] }];
  const original = optimizeStrategy(defaultStrategy(), bars, grid);
  const changed = optimizeStrategy(
    defaultStrategy(),
    bars.map((b, i) =>
      i < 112
        ? b
        : {
            ...b,
            open: b.open * 2,
            high: b.high * 2,
            low: b.low * 2,
            close: b.close * 2,
          },
    ),
    grid,
  );
  expect(changed.candidates).toEqual(original.candidates);
});

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

it('scales out at three targets while retaining a resized stop', () => {
  let s = submitOrder(
    createAccount(config),
    {
      side: 'buy',
      type: 'market',
      quantity: 10,
      stopLoss: 90,
      takeProfits: [
        { price: 105, percent: 30 },
        { price: 110, percent: 30 },
        { price: 115, percent: 40 },
      ],
    },
    bar(1),
  );
  s = advanceBar(s, bar(2, 100, 106, 99, 105));
  expect(s.position.quantity).toBe(7);
  expect(s.orders.find((o) => o.role === 'stopLoss')).toMatchObject({
    quantity: 7,
    status: 'pending',
  });
  expect(
    s.orders
      .filter((o) => o.role === 'takeProfit' && o.status === 'pending')
      .map((o) => o.quantity),
  ).toEqual([3, 4]);
  s = advanceBar(s, bar(3, 105, 116, 104, 115));
  expect(s.position.quantity).toBe(0);
  expect(s.cash).toBe(10105);
  expect(s.orders.filter((o) => o.status === 'pending')).toHaveLength(0);
});
it('multiple short targets retain protection and ambiguous stops win', () => {
  let s = submitOrder(
    createAccount(config),
    {
      side: 'sell',
      type: 'market',
      quantity: 10,
      stopLoss: 110,
      takeProfits: [
        { price: 95, percent: 50 },
        { price: 90, percent: 50 },
      ],
    },
    bar(1),
  );
  s = advanceBar(s, bar(2, 100, 101, 94, 95));
  expect(s.position.quantity).toBe(-5);
  s = advanceBar(s, bar(3, 100, 112, 88, 100));
  expect(s.position.quantity).toBe(0);
  expect(s.cash).toBe(9975);
  expect(s.orders.find((o) => o.price === 90)?.status).toBe('cancelled');
});
it('rejects overallocated and duplicate targets', () => {
  for (const targets of [
    [
      { price: 105, percent: 60 },
      { price: 110, percent: 60 },
    ],
    [
      { price: 105, percent: 30 },
      { price: 105, percent: 30 },
    ],
  ]) {
    const s = submitOrder(
      createAccount(config),
      { side: 'buy', type: 'market', quantity: 10, takeProfits: targets },
      bar(1),
    );
    expect(s.orders[0].status).toBe('rejected');
    expect(s.position.quantity).toBe(0);
  }
});

it('trailing stops tighten prospectively and never loosen', () => {
  let s = submitOrder(
    createAccount(config),
    {
      side: 'buy',
      type: 'market',
      quantity: 10,
      dynamicProtection: { trailing: { mode: 'price', distance: 5 } },
    },
    bar(1),
  );
  expect(s.orders.find((o) => o.role === 'stopLoss')?.price).toBe(95);
  s = advanceBar(s, bar(2, 100, 112, 99, 110));
  expect(s.position.quantity).toBe(10);
  expect(s.orders.find((o) => o.role === 'stopLoss')?.price).toBe(105);
  s = advanceBar(s, bar(3, 110, 111, 106, 107));
  expect(s.orders.find((o) => o.role === 'stopLoss')?.price).toBe(105);
  s = advanceBar(s, bar(4, 103, 104, 100, 102));
  expect(s.position.quantity).toBe(0);
  expect(s.cash).toBe(10030);
  expect(s.dynamicProtection).toBeUndefined();
});
it('short break-even activation acts only on a subsequent candle', () => {
  let s = submitOrder(
    createAccount(config),
    {
      side: 'sell',
      type: 'market',
      quantity: 10,
      dynamicProtection: { breakEvenPct: 2 },
    },
    bar(1),
  );
  s = advanceBar(s, bar(2, 100, 101, 96, 97));
  expect(s.position.quantity).toBe(-10);
  expect(s.orders.find((o) => o.role === 'stopLoss')?.price).toBe(100);
  s = advanceBar(s, bar(3, 97, 101, 96, 100));
  expect(s.position.quantity).toBe(0);
  expect(s.cash).toBe(10000);
});
it('ATR trailing waits for causal warm-up and uses a 14 true-range mean', () => {
  let s = createAccount(config);
  for (let i = 1; i <= 14; i++) s = advanceBar(s, bar(i, 100, 101, 99, 100));
  s = submitOrder(
    s,
    {
      side: 'buy',
      type: 'market',
      quantity: 10,
      dynamicProtection: { trailing: { mode: 'atr', distance: 2 } },
    },
    bar(14, 100, 101, 99, 100),
  );
  expect(s.orders.filter((o) => o.role === 'stopLoss')).toHaveLength(0);
  s = advanceBar(s, bar(15, 100, 101, 99, 100));
  expect(s.orders.find((o) => o.role === 'stopLoss')?.price).toBe(96);
});

it('editing an individual protection level preserves every staged exit and allocation', async () => {
  const { editProtectionLevel } = await import('./engine');
  let s = submitOrder(
    createAccount(config),
    {
      side: 'buy',
      type: 'market',
      quantity: 10,
      stopLoss: 90,
      takeProfits: [
        { price: 105, percent: 30 },
        { price: 110, percent: 30 },
        { price: 115, percent: 40 },
      ],
    },
    bar(1),
  );
  const targets = s.orders.filter((o) => o.role === 'takeProfit');
  const stop = s.orders.find((o) => o.role === 'stopLoss')!;
  s = editProtectionLevel(s, stop.id, 95, bar(1));
  expect(s.orders.filter((o) => o.role === 'takeProfit')).toEqual(targets);
  s = editProtectionLevel(s, targets[1].id, 111, bar(1));
  expect(
    s.orders
      .filter((o) => o.status === 'pending')
      .map((o) => [o.price, o.quantity]),
  ).toEqual([
    [95, 10],
    [105, 3],
    [111, 3],
    [115, 4],
  ]);
  expect(() => editProtectionLevel(s, stop.id, NaN, bar(1))).toThrow(
    'positive',
  );
});

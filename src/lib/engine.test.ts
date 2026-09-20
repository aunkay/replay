import { describe, expect, it } from 'vitest';
import {
  advanceBar,
  cancelOrder,
  closePosition,
  createAccount,
  getMetrics,
  submitOrder,
  type Candle,
  type EngineConfig,
} from './engine';

const config: EngineConfig = {
  initialCapital: 10_000,
  commissionBps: 0,
  slippageBps: 0,
};
const candle = (
  time: number,
  close: number,
  range: Partial<Candle> = {},
): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1_000,
  ...range,
});

describe('average-cost paper trading', () => {
  it('tracks a weighted entry and partial close without mutating previous state', () => {
    const initial = createAccount(config);
    const first = submitOrder(
      initial,
      { side: 'buy', type: 'market', quantity: 10 },
      candle(1, 100),
    );
    const second = submitOrder(
      first,
      { side: 'buy', type: 'market', quantity: 10 },
      candle(2, 120),
    );
    const partial = submitOrder(
      second,
      { side: 'sell', type: 'market', quantity: 5 },
      candle(3, 130),
    );

    expect(initial.cash).toBe(10_000);
    expect(initial.orders).toHaveLength(0);
    expect(first.position).toEqual({ quantity: 10, averagePrice: 100 });
    expect(second.position).toEqual({ quantity: 20, averagePrice: 110 });
    expect(partial.position).toEqual({ quantity: 15, averagePrice: 110 });
    expect(partial.cash).toBe(8_450);
    expect(getMetrics(partial, 130)).toMatchObject({
      equity: 10_400,
      totalPnl: 400,
      realizedPnl: 100,
      unrealizedPnl: 300,
      exposure: 1_950,
      buyingPower: 8_450,
      returnPct: 4,
      closedTrades: 1,
      winRate: 100,
    });
  });

  it('supports short sales, covers and a reversal with a new entry basis', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'sell', type: 'market', quantity: 20 },
      candle(1, 100),
    );
    expect(state.cash).toBe(12_000);
    expect(state.position).toEqual({ quantity: -20, averagePrice: 100 });
    expect(getMetrics(state, 90).unrealizedPnl).toBe(200);
    state = submitOrder(
      state,
      { side: 'buy', type: 'market', quantity: 5 },
      candle(2, 90),
    );
    expect(state.realizedPnl).toBe(50);
    expect(state.position).toEqual({ quantity: -15, averagePrice: 100 });
    state = submitOrder(
      state,
      { side: 'buy', type: 'market', quantity: 25 },
      candle(3, 80),
    );
    expect(state.position).toEqual({ quantity: 10, averagePrice: 80 });
    expect(state.realizedPnl).toBe(350);
    expect(state.cash).toBe(9_550);
    expect(getMetrics(state, 85).totalPnl).toBe(400);
    state = closePosition(state, candle(4, 85));
    expect(state.position).toEqual({ quantity: 0, averagePrice: 0 });
    expect(state.cash).toBe(10_400);
    expect(state.realizedPnl).toBe(400);
  });

  it('applies adverse slippage and counts all commissions in realized P&L', () => {
    let state = createAccount({
      ...config,
      commissionBps: 10,
      slippageBps: 100,
    });
    state = submitOrder(
      state,
      { side: 'buy', type: 'market', quantity: 10 },
      candle(1, 100),
    );
    expect(state.orders[0].fillPrice).toBe(101);
    expect(state.realizedPnl).toBeCloseTo(-1.01);
    expect(getMetrics(state, 100).totalPnl).toBeCloseTo(-11.01);
    state = closePosition(state, candle(2, 110));
    expect(state.orders[1].fillPrice).toBeCloseTo(108.9);
    expect(state.feesPaid).toBeCloseTo(2.099);
    expect(state.realizedPnl).toBeCloseTo(76.901);
    expect(getMetrics(state, 110).totalPnl).toBeCloseTo(76.901);
    expect(state.orders[1].realizedPnl).toBeCloseTo(77.911);
  });

  it('computes win rate from closing fills and excludes entries', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'buy', type: 'market', quantity: 10 },
      candle(1, 100),
    );
    state = submitOrder(
      state,
      { side: 'sell', type: 'market', quantity: 5 },
      candle(2, 110),
    );
    state = closePosition(state, candle(3, 90));
    expect(getMetrics(state, 90)).toMatchObject({
      closedTrades: 2,
      winRate: 50,
      totalPnl: 0,
    });
  });
});

describe('pending order execution', () => {
  it('never fills a limit using the submission candle, and improves a gap fill', () => {
    const bar = candle(1, 100, { low: 80, high: 110 });
    let state = submitOrder(
      createAccount({ ...config, slippageBps: 100 }),
      {
        side: 'buy',
        type: 'limit',
        quantity: 10,
        price: 95,
      },
      bar,
    );
    state = advanceBar(state, bar);
    expect(state.orders[0].status).toBe('pending');
    state = advanceBar(state, candle(2, 96, { open: 90, low: 89, high: 99 }));
    expect(state.orders[0]).toMatchObject({
      status: 'filled',
      fillPrice: 90,
      filledAt: 2,
    });
    expect(state.position.averagePrice).toBe(90);
  });

  it('fills intrabar buy/sell limits exactly at the limit', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'buy', type: 'limit', quantity: 10, price: 95 },
      candle(1, 100),
    );
    state = advanceBar(state, candle(2, 100, { low: 94 }));
    expect(state.orders[0].fillPrice).toBe(95);
    state = submitOrder(
      state,
      { side: 'sell', type: 'limit', quantity: 10, price: 105 },
      candle(2, 100),
    );
    state = advanceBar(state, candle(3, 100, { high: 106 }));
    expect(state.orders[1].fillPrice).toBe(105);
    expect(state.realizedPnl).toBe(100);
  });

  it('gives sell limits the better opening price on a gap up', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'sell', type: 'limit', quantity: 10, price: 105 },
      candle(1, 100),
    );
    state = advanceBar(
      state,
      candle(2, 112, { open: 110, low: 109, high: 113 }),
    );
    expect(state.orders[0].fillPrice).toBe(110);
  });

  it('executes buy stops at a gapped open with adverse slippage', () => {
    let state = submitOrder(
      createAccount({ ...config, slippageBps: 100 }),
      {
        side: 'buy',
        type: 'stop',
        quantity: 10,
        price: 105,
      },
      candle(1, 100),
    );
    state = advanceBar(
      state,
      candle(2, 111, { open: 110, low: 109, high: 113 }),
    );
    expect(state.orders[0]).toMatchObject({
      status: 'filled',
      fillPrice: 111.1,
    });
  });

  it('executes sell stops at a gapped open and intrabar buy stops at the trigger', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'buy', type: 'stop', quantity: 10, price: 105 },
      candle(1, 100),
    );
    state = advanceBar(
      state,
      candle(2, 102, { open: 100, low: 99, high: 106 }),
    );
    expect(state.orders[0].fillPrice).toBe(105);
    state = submitOrder(
      state,
      { side: 'sell', type: 'stop', quantity: 10, price: 95 },
      candle(2, 102),
    );
    state = advanceBar(state, candle(3, 91, { open: 90, low: 88, high: 94 }));
    expect(state.orders[1].fillPrice).toBe(90);
    expect(state.realizedPnl).toBe(-150);
  });

  it('preserves untouched orders and cancels only pending orders', () => {
    const pending = submitOrder(
      createAccount(config),
      { side: 'buy', type: 'limit', quantity: 10, price: 90 },
      candle(1, 100),
    );
    const waiting = advanceBar(pending, candle(2, 100));
    expect(waiting.orders[0].status).toBe('pending');
    const cancelled = cancelOrder(waiting, waiting.orders[0].id);
    expect(waiting.orders[0].status).toBe('pending');
    expect(cancelled.orders[0].status).toBe('cancelled');
    expect(advanceBar(cancelled, candle(3, 85)).position.quantity).toBe(0);
    expect(cancelOrder(cancelled, 'missing')).toBe(cancelled);
    const filled = submitOrder(
      cancelled,
      { side: 'buy', type: 'market', quantity: 1 },
      candle(3, 85),
    );
    expect(cancelOrder(filled, filled.orders[1].id)).toBe(filled);
  });

  it('processes simultaneously touched orders in submission order and checks capital after each fill', () => {
    const settings = { ...config, initialCapital: 1_000 };
    let state = submitOrder(
      createAccount(settings),
      { side: 'buy', type: 'limit', quantity: 5, price: 90 },
      candle(1, 100),
    );
    state = submitOrder(
      state,
      { side: 'buy', type: 'stop', quantity: 10, price: 110 },
      candle(1, 100),
    );
    const bothTouched = candle(2, 100, { low: 85, high: 115 });
    state = advanceBar(state, bothTouched);
    expect(state.orders.map((order) => order.status)).toEqual([
      'filled',
      'rejected',
    ]);
    expect(state.orders[0].fillPrice).toBe(90);
    expect(state.position.quantity).toBe(5);
    const repeated = advanceBar(state, bothTouched);
    expect(repeated).toEqual(state);
  });
});

describe('capital and input safety', () => {
  it('limits both long and short exposure to equity and includes fees', () => {
    for (const side of ['buy', 'sell'] as const) {
      const state = submitOrder(
        createAccount({ ...config, commissionBps: 10 }),
        {
          side,
          type: 'market',
          quantity: 100,
        },
        candle(1, 100),
      );
      expect(state.orders[0].status).toBe('rejected');
      expect(state.orders[0].reason).toMatch(/buying power/);
      expect(state.cash).toBe(10_000);
      expect(state.feesPaid).toBe(0);
    }
  });

  it('always permits reducing and closing exposure after a short account loss', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'sell', type: 'market', quantity: 100 },
      candle(1, 100),
    );
    state = advanceBar(state, candle(2, 300));
    expect(getMetrics(state, 300).equity).toBe(-10_000);
    state = submitOrder(
      state,
      { side: 'buy', type: 'market', quantity: 10 },
      candle(2, 300),
    );
    expect(state.orders[1].status).toBe('filled');
    state = closePosition(state, candle(2, 300));
    expect(state.orders[2].status).toBe('filled');
    expect(state.position.quantity).toBe(0);
    expect(state.cash).toBe(-10_000);
  });

  it('permits a full cover with floating-point quantity dust even under negative equity', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'sell', type: 'market', quantity: 0.3 },
      candle(1, 10_000),
    );
    state = advanceBar(state, candle(2, 100_000));
    expect(getMetrics(state, 100_000).equity).toBe(-17_000);
    state = submitOrder(
      state,
      { side: 'buy', type: 'market', quantity: 0.1 + 0.2 },
      candle(2, 100_000),
    );
    expect(state.orders[1].status).toBe('filled');
    expect(state.position.quantity).toBe(0);
    expect(state.cash).toBeCloseTo(-17_000);
  });

  it('allows a triggered stop to reduce negative equity but rejects a reversal that opens new exposure', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'sell', type: 'market', quantity: 100 },
      candle(1, 100),
    );
    state = submitOrder(
      state,
      { side: 'buy', type: 'stop', quantity: 40, price: 200 },
      candle(1, 100),
    );
    state = advanceBar(state, candle(2, 300));
    expect(state.orders[1].status).toBe('filled');
    expect(state.position.quantity).toBe(-60);
    state = submitOrder(
      state,
      { side: 'buy', type: 'market', quantity: 61 },
      candle(2, 300),
    );
    expect(state.orders[2].status).toBe('rejected');
    expect(state.position.quantity).toBe(-60);
    expect(getMetrics(state, 300)).toMatchObject({
      equity: -10_000,
      maxDrawdown: 200,
      buyingPower: 0,
    });
  });

  it('rechecks buying power when a queued order triggers', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'buy', type: 'stop', quantity: 90, price: 105 },
      candle(1, 100),
    );
    state = advanceBar(state, candle(2, 120));
    expect(state.orders[0].status).toBe('rejected');
    expect(state.position.quantity).toBe(0);
  });

  it.each([0, -1, NaN, Infinity])(
    'rejects invalid quantity %s without damaging account values',
    (quantity) => {
      const state = submitOrder(
        createAccount(config),
        { side: 'buy', type: 'market', quantity },
        candle(1, 100),
      );
      expect(state.orders[0].status).toBe('rejected');
      expect(Number.isFinite(state.orders[0].quantity)).toBe(true);
      expect(getMetrics(state, 100).equity).toBe(10_000);
    },
  );

  it('rejects invalid prices, invalid candles and numeric overflow', () => {
    const initial = createAccount(config);
    expect(
      submitOrder(
        initial,
        { side: 'buy', type: 'limit', quantity: 1, price: NaN },
        candle(1, 100),
      ).orders[0].status,
    ).toBe('rejected');
    expect(
      submitOrder(
        initial,
        { side: 'buy', type: 'market', quantity: 1 },
        candle(NaN, 100),
      ).orders[0],
    ).toMatchObject({ status: 'rejected', createdAt: 0 });
    const overflow = submitOrder(
      initial,
      { side: 'buy', type: 'market', quantity: Number.MAX_VALUE },
      candle(1, 100),
    );
    expect(overflow.orders[0].status).toBe('rejected');
    expect(overflow.cash).toBe(10_000);
    expect(advanceBar(initial, candle(1, NaN))).toBe(initial);
  });

  it('requires valid starting parameters and copies configuration', () => {
    expect(() => createAccount({ ...config, initialCapital: 0 })).toThrow(
      /capital/,
    );
    expect(() => createAccount({ ...config, commissionBps: NaN })).toThrow(
      /Commission/,
    );
    expect(() => createAccount({ ...config, slippageBps: 10_000 })).toThrow(
      /Slippage/,
    );
    const settings = { ...config };
    const state = createAccount(settings);
    settings.initialCapital = 1;
    expect(state.config.initialCapital).toBe(10_000);
  });
});

describe('equity history and drawdown', () => {
  it('replaces same-time marks and refuses time travel', () => {
    let state = advanceBar(createAccount(config), candle(1, 100));
    state = submitOrder(
      state,
      { side: 'buy', type: 'market', quantity: 10 },
      candle(1, 100),
    );
    expect(state.equityHistory).toEqual([{ time: 1, equity: 10_000 }]);
    state = advanceBar(state, candle(2, 110));
    expect(state.equityHistory).toEqual([
      { time: 1, equity: 10_000 },
      { time: 2, equity: 10_100 },
    ]);
    expect(advanceBar(state, candle(1, 90))).toBe(state);
    const rejected = submitOrder(
      state,
      { side: 'buy', type: 'market', quantity: 10 },
      candle(1, 90),
    );
    expect(rejected.orders.at(-1)?.status).toBe('rejected');
    expect(rejected.equityHistory).toEqual(state.equityHistory);
  });

  it('measures peak-to-trough drawdown, including the current valuation', () => {
    let state = submitOrder(
      createAccount(config),
      { side: 'buy', type: 'market', quantity: 100 },
      candle(1, 100),
    );
    state = advanceBar(state, candle(2, 120));
    state = advanceBar(state, candle(3, 90));
    state = advanceBar(state, candle(4, 110));
    expect(getMetrics(state, 110).maxDrawdown).toBe(25);
    expect(getMetrics(state, 60).maxDrawdown).toBe(50);
    expect(getMetrics(state, NaN).equity).toBe(11_000);
  });
});

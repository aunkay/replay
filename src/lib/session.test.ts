import { describe, expect, it } from 'vitest';
import { createDemo } from './data';
import { advanceBar, createAccount, submitOrder } from './engine';
import { isValidSession, type StoredSession } from './session';

function session(): StoredSession {
  const market = createDemo();
  market.bars = market.bars.slice(0, 5);
  return {
    market,
    cursor: 0,
    startCursor: 0,
    account: advanceBar(
      createAccount({
        initialCapital: 10_000,
        commissionBps: 1,
        slippageBps: 1,
      }),
      market.bars[0],
    ),
  };
}

describe('saved session validation', () => {
  it('accepts a fresh session and real engine activity, including old pending and rejected orders', () => {
    const value = session();
    expect(isValidSession(value)).toBe(true);
    value.account = submitOrder(
      value.account,
      { side: 'buy', type: 'market', quantity: 10 },
      value.market.bars[0],
    );
    value.account = submitOrder(
      value.account,
      { side: 'buy', type: 'limit', quantity: 2, price: 1 },
      value.market.bars[0],
    );
    value.account = submitOrder(
      value.account,
      { side: 'buy', type: 'market', quantity: -1 },
      value.market.bars[0],
    );
    value.account = submitOrder(
      value.account,
      { side: 'buy', type: 'limit', quantity: 1, price: NaN },
      value.market.bars[0],
    );
    value.cursor = 1;
    value.account = advanceBar(value.account, value.market.bars[1]);
    expect(isValidSession(JSON.parse(JSON.stringify(value)))).toBe(true);
  });

  it('accepts unavailable currency/exchange metadata', () => {
    const value = JSON.parse(JSON.stringify(session()));
    value.market.currency = null;
    value.market.exchange = null;
    expect(isValidSession(value)).toBe(true);
    value.market.currency = 123;
    expect(isValidSession(value)).toBe(false);
  });

  it('rejects missing accounting fields, invalid settings, and inconsistent equity', () => {
    for (const path of ['realizedPnl', 'feesPaid', 'cash'] as const) {
      const value = JSON.parse(JSON.stringify(session()));
      delete value.account[path];
      expect(isValidSession(value)).toBe(false);
    }
    const value = session();
    value.account.config.slippageBps = 10_000;
    expect(isValidSession(value)).toBe(false);
    value.account.config.slippageBps = 1;
    value.account.cash += 20;
    expect(isValidSession(value)).toBe(false);
  });

  it('rejects invalid OHLC, duplicate/out-of-order bars, and millisecond timestamps', () => {
    const malformed = session();
    malformed.market.bars[0].high = malformed.market.bars[0].low - 1;
    expect(isValidSession(malformed)).toBe(false);
    const duplicate = session();
    duplicate.market.bars[1].time = duplicate.market.bars[0].time;
    expect(isValidSession(duplicate)).toBe(false);
    const millisecond = session();
    millisecond.market.bars[0].time *= 1000;
    expect(isValidSession(millisecond)).toBe(false);
    const futureInvalid = session();
    futureInvalid.market.bars[4].volume = NaN;
    expect(isValidSession(futureInvalid)).toBe(false);
  });

  it('rejects invalid cursors, position basis and nonchronological equity', () => {
    const value = session();
    value.cursor = value.market.bars.length;
    expect(isValidSession(value)).toBe(false);
    value.cursor = 0;
    value.account.position.averagePrice = 10;
    expect(isValidSession(value)).toBe(false);
    value.account.position.averagePrice = 0;
    value.account.equityHistory.push({ ...value.account.equityHistory[0] });
    expect(isValidSession(value)).toBe(false);
  });

  it('rejects future fills, missing execution fields, and duplicate order ids', () => {
    const value = session();
    value.account = submitOrder(
      value.account,
      { side: 'buy', type: 'market', quantity: 10 },
      value.market.bars[0],
    );
    const order = value.account.orders[0];
    order.filledAt = value.market.bars[1].time;
    expect(isValidSession(value)).toBe(false);
    order.filledAt = order.createdAt;
    const fee = order.fee;
    delete order.fee;
    expect(isValidSession(value)).toBe(false);
    order.fee = fee;
    value.account.orders.push({ ...order });
    expect(isValidSession(value)).toBe(false);
  });

  it('permits negative cash/equity resulting from a legitimate short loss', () => {
    const value = session();
    value.account = submitOrder(
      value.account,
      { side: 'sell', type: 'market', quantity: 40 },
      value.market.bars[0],
    );
    value.cursor = 1;
    value.market.bars[1] = {
      ...value.market.bars[1],
      open: 1000,
      high: 1000,
      low: 1000,
      close: 1000,
    };
    value.account = advanceBar(value.account, value.market.bars[1]);
    expect(isValidSession(value)).toBe(true);
    value.account = submitOrder(
      value.account,
      { side: 'buy', type: 'market', quantity: 40 },
      value.market.bars[1],
    );
    expect(value.account.cash).toBeLessThan(0);
    expect(isValidSession(value)).toBe(true);
  });

  it('safely rejects arbitrary broken storage values', () => {
    for (const value of [
      null,
      undefined,
      [],
      {},
      42,
      'session',
      { market: null },
      { market: { bars: [] } },
    ]) {
      expect(isValidSession(value)).toBe(false);
    }
  });
});

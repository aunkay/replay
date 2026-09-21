import { expect, it } from 'vitest';
import { createAccount, submitOrder, advanceBar, type Candle } from './engine';
const config = { initialCapital: 10000, commissionBps: 0, slippageBps: 0 };
const bar = (time: number, price = 100, volume = 10): Candle => ({
  time,
  open: price,
  high: price + 1,
  low: price - 1,
  close: price,
  volume,
});
it('spread is adverse and short borrowing accrues once per elapsed interval', () => {
  let s = submitOrder(
    createAccount({ ...config, spreadBps: 100, borrowAprPct: 36.5 }),
    { side: 'sell', type: 'market', quantity: 10 },
    bar(1),
  );
  expect(s.position.averagePrice).toBe(99.5);
  s = advanceBar(s, bar(86401));
  expect(s.borrowingPaid).toBeCloseTo(1);
  const cash = s.cash;
  expect(advanceBar(s, bar(86401)).cash).toBe(cash);
});
it('orders share volume and carry unfilled market quantities to future candles', () => {
  let s = submitOrder(
    createAccount({ ...config, volumeParticipationPct: 20 }),
    { side: 'buy', type: 'market', quantity: 5 },
    bar(1),
  );
  expect(s.position.quantity).toBe(2);
  expect(s.orders.filter((o) => o.status === 'pending')[0].quantity).toBe(3);
  s = submitOrder(s, { side: 'buy', type: 'market', quantity: 1 }, bar(1));
  expect(s.position.quantity).toBe(2);
  s = advanceBar(s, bar(2));
  expect(s.position.quantity).toBe(4);
  s = advanceBar(s, bar(3));
  expect(s.position.quantity).toBe(6);
  expect(s.orders.filter((o) => o.status === 'pending')).toHaveLength(0);
});
it('a partially filled protective stop remains reduce-only until fully closed', () => {
  let s = submitOrder(
    createAccount({ ...config, volumeParticipationPct: 50 }),
    { side: 'buy', type: 'market', quantity: 5, stopLoss: 95, takeProfit: 110 },
    bar(1),
  );
  s = advanceBar(s, bar(2, 90, 4));
  expect(s.position.quantity).toBe(3);
  expect(s.orders.find((o) => o.role === 'takeProfit')?.status).toBe(
    'cancelled',
  );
  s = advanceBar(s, bar(3, 100, 10));
  expect(s.position.quantity).toBe(0);
  expect(s.orders.filter((o) => o.status === 'pending')).toHaveLength(0);
});
it('zero volume cannot fill orders or recurse through profit targets', () => {
  let s = submitOrder(
    createAccount({ ...config, volumeParticipationPct: 50 }),
    { side: 'buy', type: 'market', quantity: 5, takeProfit: 105 },
    bar(1),
  );
  s = advanceBar(s, bar(2, 110, 0));
  expect(s.position.quantity).toBe(5);
});

import { expect, it } from 'vitest';
import { advanceBar, createAccount, type Candle } from './engine';
import {
  addPortfolioAsset,
  advancePortfolio,
  closePortfolioPosition,
  createPortfolio,
  portfolioMetrics,
  submitPortfolioOrder,
} from './portfolio';
const config = { initialCapital: 1000, commissionBps: 0, slippageBps: 0 };
const bar = (time = 1, price = 100, volume = 100): Candle => ({
  time,
  open: price,
  high: price,
  low: price,
  close: price,
  volume,
});
function portfolio(extra = {}) {
  return addPortfolioAsset(
    createPortfolio(
      'AAA',
      'USD',
      bar(),
      advanceBar(createAccount({ ...config, ...extra }), bar()),
    ),
    'BBB',
    'USD',
    bar(),
  );
}
it('shares capital across long positions, rejects excess exposure, and releases buying power on close', () => {
  let p = submitPortfolioOrder(portfolio(), 'AAA', {
    side: 'buy',
    type: 'market',
    quantity: 6,
  });
  p = submitPortfolioOrder(p, 'BBB', {
    side: 'buy',
    type: 'market',
    quantity: 5,
  });
  expect(p.assets[1].account.orders.at(-1)?.status).toBe('rejected');
  p = submitPortfolioOrder(p, 'BBB', {
    side: 'buy',
    type: 'market',
    quantity: 4,
  });
  expect(portfolioMetrics(p)).toMatchObject({
    cash: 0,
    equity: 1000,
    exposure: 1000,
    buyingPower: 0,
  });
  p = advancePortfolio(p, [
    { ticker: 'AAA', bar: bar(2, 110) },
    { ticker: 'BBB', bar: bar(2, 90) },
  ]);
  expect(portfolioMetrics(p)).toMatchObject({
    totalPnl: 20,
    unrealizedPnl: 20,
  });
  p = closePortfolioPosition(p, 'AAA');
  expect(portfolioMetrics(p)).toMatchObject({
    cash: 660,
    equity: 1020,
    exposure: 360,
    buyingPower: 660,
    realizedPnl: 60,
  });
  p = closePortfolioPosition(p, 'BBB');
  expect(portfolioMetrics(p)).toMatchObject({
    cash: 1020,
    realizedPnl: 20,
    unrealizedPnl: 0,
  });
});
it('short sale proceeds do not increase buying power', () => {
  let p = submitPortfolioOrder(portfolio(), 'AAA', {
    side: 'sell',
    type: 'market',
    quantity: 6,
  });
  expect(portfolioMetrics(p)).toMatchObject({
    cash: 1600,
    equity: 1000,
    exposure: 600,
    buyingPower: 400,
  });
  p = submitPortfolioOrder(p, 'BBB', {
    side: 'buy',
    type: 'market',
    quantity: 5,
  });
  expect(p.assets[1].account.orders.at(-1)?.status).toBe('rejected');
});
it('simultaneous pending orders compete deterministically for shared capital', () => {
  let p = submitPortfolioOrder(portfolio(), 'BBB', {
    side: 'buy',
    type: 'limit',
    price: 90,
    quantity: 8,
  });
  p = submitPortfolioOrder(p, 'AAA', {
    side: 'buy',
    type: 'limit',
    price: 90,
    quantity: 8,
  });
  const updates = [
    { ticker: 'BBB', bar: bar(2, 90) },
    { ticker: 'AAA', bar: bar(2, 90) },
  ];
  const first = advancePortfolio(p, updates),
    reversed = advancePortfolio(p, [...updates].reverse());
  expect(first.assets.map((a) => a.account.position.quantity)).toEqual([8, 0]);
  expect(reversed.assets.map((a) => a.account.position.quantity)).toEqual([
    8, 0,
  ]);
  expect(first.cash).toBe(280);
});
it('charges fees and short borrowing to shared cash exactly once', () => {
  let p = submitPortfolioOrder(
    portfolio({ commissionBps: 10, borrowAprPct: 36.5 }),
    'AAA',
    { side: 'sell', type: 'market', quantity: 4 },
  );
  p = advancePortfolio(p, [
    { ticker: 'AAA', bar: bar(86401) },
    { ticker: 'BBB', bar: bar(86401) },
  ]);
  expect(portfolioMetrics(p).borrowingPaid).toBeCloseTo(0.4);
  expect(portfolioMetrics(p).totalPnl).toBeCloseTo(-0.8);
  expect(advancePortfolio(p, [{ ticker: 'AAA', bar: bar(86401) }])).toEqual(p);
  p = closePortfolioPosition(p, 'AAA');
  expect(portfolioMetrics(p).totalPnl).toBeCloseTo(-1.2);
  expect(portfolioMetrics(p).realizedPnl).toBeCloseTo(-1.2);
});
it('keeps separate per-symbol volume budgets and protective orders', () => {
  let p = submitPortfolioOrder(
    portfolio({ volumeParticipationPct: 1 }),
    'AAA',
    { side: 'buy', type: 'market', quantity: 2, stopLoss: 95 },
  );
  p = submitPortfolioOrder(p, 'BBB', {
    side: 'buy',
    type: 'market',
    quantity: 2,
  });
  expect(p.assets.map((a) => a.account.position.quantity)).toEqual([1, 1]);
  p = advancePortfolio(p, [
    { ticker: 'AAA', bar: bar(2, 90) },
    { ticker: 'BBB', bar: bar(2, 100) },
  ]);
  expect(p.assets.map((a) => a.account.position.quantity)).toEqual([0, 2]);
  expect(portfolioMetrics(p).totalPnl).toBe(-10);
});
it('rejects currency mixing and future data when attaching tickers', () => {
  expect(() => addPortfolioAsset(portfolio(), 'CCC', 'EUR', bar())).toThrow(
    'currency',
  );
  expect(() => addPortfolioAsset(portfolio(), 'CCC', 'USD', bar(2))).toThrow(
    'future',
  );
});

it('maintains instrument ledger identities without granting independent capital', () => {
  let p = submitPortfolioOrder(portfolio(), 'AAA', {
    side: 'buy',
    type: 'market',
    quantity: 6,
  });
  p = submitPortfolioOrder(p, 'BBB', {
    side: 'sell',
    type: 'market',
    quantity: 4,
  });
  p = advancePortfolio(p, [
    { ticker: 'AAA', bar: bar(2, 110) },
    { ticker: 'BBB', bar: bar(2, 95) },
  ]);
  expect(portfolioMetrics(p).totalPnl).toBe(80);
  for (const a of p.assets) {
    const equity = a.account.cash + a.account.position.quantity * a.bar.close;
    expect(a.account.equityHistory.at(-1)?.equity).toBeCloseTo(equity);
    expect(equity - config.initialCapital).toBeCloseTo(
      a.account.realizedPnl +
        a.account.position.quantity *
          (a.bar.close - a.account.position.averagePrice),
    );
    expect(a.account.capitalContext).toBeUndefined();
  }
});

it('rejects corrupt candle marks before they can change portfolio equity', () => {
  const p = portfolio();
  expect(() =>
    advancePortfolio(p, [{ ticker: 'AAA', bar: { ...bar(2), close: NaN } }]),
  ).toThrow('candle');
  expect(portfolioMetrics(p).equity).toBe(1000);
});

it('does not execute manual orders using a stale comparison candle', () => {
  const p = advancePortfolio(portfolio(), [{ ticker: 'AAA', bar: bar(2) }]);
  expect(() =>
    submitPortfolioOrder(p, 'BBB', {
      side: 'buy',
      type: 'market',
      quantity: 1,
    }),
  ).toThrow('fresh quote');
  const ready = advancePortfolio(p, [{ ticker: 'BBB', bar: bar(2) }]);
  expect(
    submitPortfolioOrder(ready, 'BBB', {
      side: 'buy',
      type: 'market',
      quantity: 1,
    }).assets[1].account.position.quantity,
  ).toBe(1);
});

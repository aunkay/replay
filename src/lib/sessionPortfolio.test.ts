import { expect, it } from 'vitest';
import { createDemo } from './data';
import { advanceBar, createAccount } from './engine';
import { isValidSession, type StoredSession } from './session';
import { applyTradingCommand, attachPortfolioMarket } from './sessionPortfolio';
import { advanceReplay } from './alerts';
import { applyCheckpoint } from './checkpoints';
const market = createDemo();
const session = (): StoredSession => ({
  market,
  cursor: 10,
  startCursor: 10,
  account: advanceBar(
    createAccount({ initialCapital: 10000, commissionBps: 1, slippageBps: 1 }),
    market.bars[10],
  ),
});
const comparison = {
  ...market,
  ticker: 'OTHER',
  bars: market.bars.map((b) => ({
    ...b,
    open: b.open / 2,
    high: b.high / 2,
    low: b.low / 2,
    close: b.close / 2,
  })),
};
it('preserves portfolio identities through replay, serialization, and checkpoint restoration', () => {
  let s = attachPortfolioMarket(session(), comparison);
  s = applyTradingCommand(s, {
    type: 'order',
    order: { side: 'buy', type: 'market', quantity: 2 },
  });
  s = applyTradingCommand(s, {
    type: 'order',
    ticker: 'OTHER',
    order: { side: 'sell', type: 'market', quantity: 3 },
  });
  expect(isValidSession(s)).toBe(true);
  s = applyCheckpoint(s, {
    type: 'checkpoint',
    action: 'save',
    id: 'portfolio',
    name: 'Both positions',
  });
  const snapshot = JSON.parse(JSON.stringify(s));
  s = advanceReplay(s, 20);
  expect(isValidSession(s)).toBe(true);
  expect(isValidSession(JSON.parse(JSON.stringify(s)))).toBe(true);
  s = applyCheckpoint(s, {
    type: 'checkpoint',
    action: 'restore',
    id: 'portfolio',
  });
  expect(s.portfolio).toEqual(snapshot.portfolio);
  expect(s.account).toEqual(snapshot.account);
});
it('rejects corrupt portfolio capital and duplicate base-account state', () => {
  const s = attachPortfolioMarket(session(), comparison);
  const inflated = structuredClone(s);
  inflated.portfolio!.book.cash += 1000;
  expect(isValidSession(inflated)).toBe(false);
  const divergent = structuredClone(s);
  divergent.portfolio!.book.assets[0].account.cash += 1;
  expect(isValidSession(divergent)).toBe(false);
});
it('comparison pending fills and base orders use the same available funds', () => {
  let s = attachPortfolioMarket(session(), comparison);
  s = applyTradingCommand(s, {
    type: 'order',
    ticker: 'OTHER',
    order: { side: 'buy', type: 'market', quantity: 100000 },
  });
  expect(s.portfolio!.book.assets[1].account.orders.at(-1)?.status).toBe(
    'rejected',
  );
  s = applyTradingCommand(s, {
    type: 'order',
    ticker: 'OTHER',
    order: {
      side: 'buy',
      type: 'limit',
      price: comparison.bars[11].high * 2,
      quantity: 1,
    },
  });
  s = advanceReplay(s, 11);
  expect(s.portfolio!.book.assets[1].account.position.quantity).toBe(1);
  expect(isValidSession(s)).toBe(true);
});

it('live portfolio waits for staggered comparison fetches and executes only once after submission', async () => {
  const { initializeLive, applyLiveTick } = await import('./liveEngine');
  const timed = {
    ...market,
    bars: market.bars
      .slice(0, 14)
      .map((b) => ({ ...b, complete: true, endTime: b.time + 86400 })),
  };
  const other = { ...timed, ticker: 'OTHER' };
  let s = attachPortfolioMarket(
    initializeLive(
      { ...timed, bars: timed.bars.slice(0, 11) },
      { initialCapital: 10000, commissionBps: 0, slippageBps: 0 },
    ),
    { ...other, bars: other.bars.slice(0, 11) },
  );
  const queued = [
    {
      key: 'buy-other',
      submittedAt: timed.bars[10].endTime + 1,
      command: {
        type: 'order',
        ticker: 'OTHER',
        order: { side: 'buy' as const, type: 'market' as const, quantity: 2 },
      },
    },
  ];
  let result = applyLiveTick(s, timed, queued, 0);
  expect(result.session.cursor).toBe(10);
  expect(result.pending).toHaveLength(1);
  result = applyLiveTick(result.session, timed, result.pending, 0, [other]);
  expect(result.session.cursor).toBe(13);
  expect(result.pending).toHaveLength(0);
  expect(
    result.session.portfolio!.book.assets[1].account.position.quantity,
  ).toBe(2);
  expect(isValidSession(result.session)).toBe(true);
  const again = applyLiveTick(result.session, timed, [], 0, [other]);
  expect(again.session.portfolio).toEqual(result.session.portfolio);
});

it('validates queued Live commands against a stale comparison without executing them', async () => {
  const { validateLiveCommand } = await import('./liveEngine');
  const s = attachPortfolioMarket(session(), {
    ...comparison,
    bars: comparison.bars.slice(0, 10),
  });
  const before = structuredClone(s);
  expect(() =>
    validateLiveCommand(s, {
      type: 'order',
      ticker: 'OTHER',
      order: { side: 'buy', type: 'market', quantity: 2 },
    }),
  ).not.toThrow();
  expect(s).toEqual(before);
  expect(() =>
    applyTradingCommand(s, {
      type: 'order',
      ticker: 'OTHER',
      order: { side: 'buy', type: 'market', quantity: 2 },
    }),
  ).toThrow('fresh quote');
  expect(() =>
    validateLiveCommand(s, {
      type: 'order',
      ticker: 'OTHER',
      order: { side: 'buy', type: 'market', quantity: -1 },
    }),
  ).toThrow('Quantity');
});

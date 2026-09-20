import { describe, it, expect } from 'vitest';
import { initializeLive, applyLiveTick, type LiveCommand } from './liveEngine';
import { createDemo } from './data';
import type { Candle } from './engine';
import { isValidSession } from './session';
const time = 1700000000;
const bar = (i: number, complete = true, close = 100): Candle => ({
  time: time + i * 60,
  endTime: time + (i + 1) * 60,
  open: 100,
  high: 110,
  low: 90,
  close,
  volume: 100,
  complete,
});
const market = (bars: Candle[]) => ({
  ...createDemo(),
  source: 'yfinance' as const,
  interval: '1m',
  bars,
});
const config = { initialCapital: 10000, commissionBps: 0, slippageBps: 0 };
describe('closed-bar live paper engine', () => {
  it('ignores provisional candles and fills only once on completed close', () => {
    const state = initializeLive(market([bar(0), bar(1, false)]), config);
    const command: LiveCommand = {
      key: '1',
      submittedAt: time + 70,
      command: {
        type: 'order',
        order: { side: 'buy', type: 'market', quantity: 10 },
      },
    };
    const unchanged = applyLiveTick(
      state,
      market([bar(0), bar(1, false)]),
      [command],
      time + 65,
    );
    expect(unchanged.session.account.orders).toHaveLength(0);
    const filled = applyLiveTick(
      state,
      market([bar(0), bar(1, true, 105), bar(2, false)]),
      [command],
      time + 65,
    );
    expect(filled.session.account.position.quantity).toBe(10);
    expect(filled.session.account.orders[0].fillPrice).toBe(105);
    expect(filled.pending).toHaveLength(0);
    const duplicate = applyLiveTick(
      filled.session,
      market([bar(0), bar(1, true, 108), bar(2, false)]),
      [],
      time + 65,
    );
    expect(duplicate.session.account).toEqual(filled.session.account);
    expect(duplicate.session.market.bars[1].close).toBe(105);
    expect(isValidSession(filled.session)).toBe(true);
  });
  it('does not use a pre-submission low for a pending limit', () => {
    const state = initializeLive(market([bar(0)]), config);
    const command: LiveCommand = {
      key: '2',
      submittedAt: time + 70,
      command: {
        type: 'order',
        order: { side: 'buy', type: 'limit', quantity: 10, price: 95 },
      },
    };
    const first = applyLiveTick(
      state,
      market([bar(0), bar(1)]),
      [command],
      time + 65,
    );
    expect(first.session.account.position.quantity).toBe(0);
    const second = applyLiveTick(
      first.session,
      market([bar(0), bar(1), bar(2)]),
      [],
      time + 65,
    );
    expect(second.session.account.position.quantity).toBe(10);
  });
  it('marks skipped disconnection candles without retrospective fills', () => {
    let state = initializeLive(market([bar(0)]), config);
    const command: LiveCommand = {
      key: '3',
      submittedAt: time + 70,
      command: {
        type: 'order',
        order: { side: 'buy', type: 'limit', quantity: 10, price: 95 },
      },
    };
    state = applyLiveTick(
      state,
      market([bar(0), bar(1)]),
      [command],
      time + 65,
    ).session;
    const resumed = applyLiveTick(
      state,
      market([bar(0), bar(1), bar(2), bar(3)]),
      [],
      time + 240,
    );
    expect(resumed.session.account.position.quantity).toBe(0);
    expect(resumed.session.account.equityHistory.at(-1)?.time).toBe(time + 180);
    expect(isValidSession(resumed.session)).toBe(true);
  });
  it('one invalid edit cannot wedge subsequent live updates', () => {
    const state = initializeLive(market([bar(0)]), config);
    const result = applyLiveTick(
      state,
      market([bar(0), bar(1)]),
      [
        {
          key: 'bad',
          submittedAt: time + 70,
          command: { type: 'bracket', stopLoss: 95 },
        },
      ],
      time,
    );
    expect(result.pending).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.session.cursor).toBe(1);
  });
});

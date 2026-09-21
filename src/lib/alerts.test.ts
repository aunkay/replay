import { expect, it } from 'vitest';
import { alertCommand, advanceReplay } from './alerts';
import { createDemo } from './data';
import { advanceBar, createAccount } from './engine';
import { initializeLive, applyLiveTick } from './liveEngine';
import type { StoredSession } from './session';
import type { Rule } from './strategy';
const config = { initialCapital: 10000, commissionBps: 0, slippageBps: 0 };
const rule: Rule = {
  join: 'and',
  conditions: [
    {
      left: { kind: 'price', field: 'close' },
      op: 'crossUp',
      right: { kind: 'constant', value: 105 },
    },
  ],
};
function initial(): StoredSession {
  const market = createDemo();
  market.bars = market.bars
    .slice(0, 25)
    .map((b, i) => ({
      ...b,
      open: i < 5 ? 100 : 110,
      high: i < 5 ? 101 : 111,
      low: i < 5 ? 99 : 109,
      close: i < 5 ? 100 : 110,
      endTime: b.time + 1,
      complete: true,
    }));
  return {
    market,
    cursor: 2,
    startCursor: 2,
    account: advanceBar(createAccount(config), market.bars[2]),
  };
}
it('seek stops exactly at crossing, fires once, and cannot see future prices', () => {
  let s = initial();
  s = alertCommand(s, {
    type: 'alert',
    action: 'save',
    id: 'price',
    name: 'Breakout',
    rule,
    pause: true,
  });
  s = advanceReplay(s, 4);
  expect(s.alertEvents).toBeUndefined();
  s = advanceReplay(s, 20);
  expect(s.cursor).toBe(5);
  expect(s.alertEvents).toHaveLength(1);
  s = advanceReplay(s, 20);
  expect(s.cursor).toBe(20);
  expect(s.alertEvents).toHaveLength(1);
});
it('indicator conditions honor warm-up and notification-only alerts do not stop seek', () => {
  let s = initial();
  s = alertCommand(s, {
    type: 'alert',
    action: 'save',
    id: 'indicator',
    name: 'Trend',
    pause: false,
    rule: {
      join: 'and',
      conditions: [
        {
          left: { kind: 'indicator', indicator: 'sma', period: 8 },
          op: 'gt',
          right: { kind: 'constant', value: 105 },
        },
      ],
    },
  });
  s = advanceReplay(s, 6);
  expect(s.alertEvents).toBeUndefined();
  s = advanceReplay(s, 20);
  expect(s.cursor).toBe(20);
  expect(s.alertEvents).toHaveLength(1);
});
it('live evaluates closed bars and skips acknowledged gap alerts', () => {
  const source = initial();
  const market = { ...source.market, bars: source.market.bars.slice(0, 5) };
  let s = initializeLive(market, config);
  s = alertCommand(s, {
    type: 'alert',
    action: 'save',
    id: 'live',
    name: 'Breakout',
    rule,
  });
  const provisional = {
    ...source.market,
    bars: source.market.bars
      .slice(0, 6)
      .map((b, i) => ({ ...b, complete: i < 5 })),
  };
  expect(
    applyLiveTick(s, provisional, [], 0).session.alertEvents,
  ).toBeUndefined();
  expect(
    applyLiveTick(s, source.market, [], 0).session.alertEvents,
  ).toHaveLength(1);
  expect(
    applyLiveTick(s, source.market, [], source.market.bars[6].endTime!).session
      .alertEvents,
  ).toBeUndefined();
});

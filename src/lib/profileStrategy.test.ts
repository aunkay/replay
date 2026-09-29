import { describe, it, expect } from 'vitest';
import {
  profileReclaimPlans,
  profileEntryAllowed,
  reclaimDefaults,
} from './profileStrategy';
import { calculateProfile } from './volumeProfile';
import { runStrategy, defaultStrategy, emptyRule } from './strategy';
import type { Candle } from './engine';
export function reclaimFixture(short = false) {
  const candle = (
    time: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume = 100,
  ): Candle => ({ time, open, high, low, close, volume });
  const origin = 1704186000;
  const reference = Array.from({ length: 20 }, (_, i) =>
    candle(
      origin + 86400 + i * 300,
      100,
      i < 18 ? 110 : 101,
      i < 18 ? 90 : 100,
      100,
      i < 18 ? 100 : 1000,
    ),
  );
  const p = calculateProfile(reference, 20, 70)!;
  const bars = [
    ...reference.map((b) => ({ ...b, time: b.time - 86400 })),
    ...reference,
  ];
  const day = origin + 86400 * 2;
  const edge = short ? p.vah : p.val;
  // Sweep/reclaim, then a separate retest with a stronger directional close.
  const make = (j: number, a: number, h: number, l: number, c: number) =>
    candle(day + j * 300, a, h, l, c);
  if (!short) {
    bars.push(
      make(0, edge + 0.2, edge + 0.4, edge - 0.4, edge + 0.1),
      make(1, edge + 0.1, edge + 0.5, edge - 0.1, edge + 0.3),
      make(2, edge + 0.3, p.pocPrice + 0.2, edge + 0.2, p.pocPrice),
      make(3, p.pocPrice, p.vah + 0.2, p.pocPrice - 0.1, p.vah),
    );
  } else {
    bars.push(
      make(0, edge - 0.2, edge + 0.4, edge - 0.4, edge - 0.1),
      make(1, edge - 0.1, edge + 0.1, edge - 0.5, edge - 0.3),
      make(2, edge - 0.3, edge - 0.2, p.pocPrice - 0.2, p.pocPrice),
      make(3, p.pocPrice, p.pocPrice + 0.1, p.val - 0.2, p.val),
    );
  }
  return {
    bars,
    p,
    settings: {
      ...reclaimDefaults,
      timezone: 'UTC',
      rows: 20,
      atrPeriod: 2,
      sweepAtr: 0,
      stopAtr: 0.05,
      retestAtr: 0.25,
      minRR: 0.1,
    },
  };
}
describe('frozen-session sweep/reclaim', () => {
  for (const short of [false, true])
    it(`${short ? 'short' : 'long'} waits for retest then fills next open with profile SL/PT`, () => {
      const { bars, p, settings } = reclaimFixture(short);
      const plans = profileReclaimPlans(bars, settings);
      expect(plans[40]).toBeNull();
      expect(plans[41]?.side).toBe(short ? 'sell' : 'buy');
      expect(plans[41]!.poc).toBe(p.pocPrice);
      const strategy = {
        ...defaultStrategy(),
        volumeProfile: settings,
        stopPct: undefined,
        targetPct: undefined,
        riskPct: 0.5,
        longEntry: emptyRule(),
        shortEntry: emptyRule(),
        config: { initialCapital: 100000, commissionBps: 0, slippageBps: 0 },
      };
      const result = runStrategy(strategy, bars);
      const opening = result.account.orders.find(
        (o) => !o.reduceOnly && o.status === 'filled',
      )!;
      expect(opening).toBeDefined();
      expect(opening.filledAt).toBe(bars[42].time);
      expect(opening.stopLoss).toBe(plans[41]!.stop);
      expect(
        result.account.orders
          .filter((o) => o.role === 'takeProfit')
          .map((o) => o.price),
      ).toEqual(expect.arrayContaining([p.pocPrice, short ? p.val : p.vah]));
      expect(result.account.orders.some((o) => o.status === 'rejected')).toBe(
        false,
      );
    });
  it('is prefix-invariant and never uses the first partial session', () => {
    const { bars, settings } = reclaimFixture();
    const all = profileReclaimPlans(bars, settings);
    expect(all.slice(0, 40).every((p) => p === null)).toBe(true);
    for (let end = 40; end <= bars.length; end++)
      expect(profileReclaimPlans(bars.slice(0, end), settings)).toEqual(
        all.slice(0, end),
      );
    expect(
      profileReclaimPlans(
        bars.map((b, i) =>
          i > 41 ? { ...b, high: b.high * 10, close: b.close * 5 } : b,
        ),
        settings,
      ).slice(0, 42),
    ).toEqual(all.slice(0, 42));
  });
  it('cancels failed reclaim, rejects chase entries and insufficient reward', () => {
    const { bars, settings } = reclaimFixture();
    const plan = profileReclaimPlans(bars, settings)[41]!;
    expect(profileEntryAllowed(plan, plan.zoneHigh + 10, settings)).toBe(false);
    expect(profileEntryAllowed(plan, plan.poc, settings)).toBe(false);
    const failed = bars.map((b, i) =>
      i === 41 ? { ...b, close: plan.zoneLow - 1, low: plan.zoneLow - 2 } : b,
    );
    expect(profileReclaimPlans(failed, settings)[41]).toBeNull();
    const newExtreme = bars.map((b, i) =>
      i === 41 ? { ...b, low: bars[40].low - 1 } : b,
    );
    expect(profileReclaimPlans(newExtreme, settings)[41]).toBeNull();
  });
  it('requires intraday data and validates custom settings', () => {
    const { bars, settings } = reclaimFixture();
    const s = {
      ...defaultStrategy(),
      volumeProfile: settings,
      stopPct: undefined,
      targetPct: undefined,
    };
    expect(() =>
      runStrategy(
        s,
        bars.map((b, i) => ({ ...b, time: 1700000000 + i * 86400 })),
      ),
    ).toThrow('intraday');
    expect(() => runStrategy({ ...s, stopPct: 2 }, bars)).toThrow(
      'sweep stops',
    );
    expect(() =>
      profileReclaimPlans(bars, { ...settings, timezone: 'invalid' }),
    ).toThrow('timezone');
  });
});

it('exits remaining positions at the holding limit or next session open', () => {
  for (const nextSession of [false, true]) {
    const { bars, settings } = reclaimFixture();
    const open = bars[42].open;
    for (const i of [42, 43])
      bars[i] = {
        ...bars[i],
        open,
        high: open + 0.01,
        low: open - 0.01,
        close: open,
      };
    if (nextSession) bars[43].time += 86400;
    const result = runStrategy(
      {
        ...defaultStrategy(),
        volumeProfile: { ...settings, maxHold: nextSession ? 999 : 1 },
        stopPct: undefined,
        targetPct: undefined,
        config: { initialCapital: 100000, commissionBps: 0, slippageBps: 0 },
      },
      bars,
    );
    const exits = result.account.orders.filter(
      (o) => o.side === 'sell' && o.status === 'filled',
    );
    expect(exits).toHaveLength(1);
    expect(exits[0].filledAt).toBe(bars[43].time);
    expect(exits[0].fillPrice).toBe(open);
  }
});

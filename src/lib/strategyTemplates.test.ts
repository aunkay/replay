import { describe, it, expect } from 'vitest';
import { STRATEGY_TEMPLATES } from './strategyTemplates';
import { runStrategy, validateStrategy } from './strategy';
import { computeIndicator } from './indicators';
import { createDemo } from './data';
import { strategyPerformance } from './strategyPerformance';
import type { EquityPoint } from './engine';
const bars = createDemo().bars;
describe('research catalog execution', () => {
  it('contains 24 distinct rule sets', () => {
    expect(STRATEGY_TEMPLATES).toHaveLength(24);
    expect(
      new Set(
        STRATEGY_TEMPLATES.map((t) =>
          JSON.stringify([t.strategy.longEntry, t.strategy.longExit]),
        ),
      ).size,
    ).toBe(24);
  });
  for (const template of STRATEGY_TEMPLATES)
    it(`${template.name}: valid plots, causal results and affordable orders`, () => {
      validateStrategy(template.strategy);
      for (const rule of [
        template.strategy.longEntry,
        template.strategy.longExit,
      ])
        for (const condition of rule.conditions)
          for (const operand of [condition.left, condition.right]) {
            if (operand.kind !== 'indicator') continue;
            const plots = computeIndicator(
              {
                id: 'check',
                indicatorId: operand.indicator,
                period: operand.period,
                color: '#fff',
              },
              bars,
            );
            expect(
              plots.some((p) => p.key === (operand.plot ?? plots[0].key)),
            ).toBe(true);
          }
      const boundary = Math.min(400, bars.length - 10);
      const a = runStrategy(template.strategy, bars.slice(0, boundary));
      const changed = bars.map((b, index) =>
        index < boundary
          ? b
          : {
              ...b,
              open: b.open * 2,
              high: b.high * 2,
              low: b.low * 2,
              close: b.close * 2,
            },
      );
      const b = runStrategy(template.strategy, changed, 1, boundary);
      expect(b.metrics).toEqual(a.metrics);
      expect(b.account.equityHistory).toEqual(a.account.equityHistory);
      expect(a.account.orders.filter((o) => o.status === 'rejected')).toEqual(
        [],
      );
    });
  it('allocation includes costs and cannot combine with risk sizing', () => {
    const s = structuredClone(STRATEGY_TEMPLATES[0].strategy);
    s.longEntry = {
      join: 'and',
      conditions: [
        {
          left: { kind: 'constant', value: 1 },
          op: 'gt',
          right: { kind: 'constant', value: 0 },
        },
      ],
    };
    const r = runStrategy(s, bars.slice(0, 3));
    const entry = r.account.orders.find((o) => o.status === 'filled')!;
    expect(entry.quantity * bars[1].open).toBeLessThan(95000);
    expect(entry.quantity * bars[1].open).toBeGreaterThan(94800);
    expect(() => validateStrategy({ ...s, riskPct: 1, stopPct: 2 })).toThrow(
      'either',
    );
    expect(() => validateStrategy({ ...s, allocationPct: 100 })).toThrow();
  });
});
const points = (values: number[], step = 86400): EquityPoint[] =>
  values.map((equity, i) => ({
    time: i * step,
    equity,
    cash: equity,
    positionValue: 0,
  }));
describe('Sharpe calculation', () => {
  it('retains first-day intraday P&L and costs after daily resampling', () => {
    const performance = strategyPerformance([
      { time: 0, equity: 100 },
      { time: 3600, equity: 90 },
      { time: 86400, equity: 99 },
    ]);
    expect(performance.observations).toBe(2);
    expect(performance.sharpe).toBeCloseTo(0, 10);
  });
  it('matches a hand calculation using sample variance and retains idle cash', () => {
    // returns 10%, 0%, -10%; mean 0, sample standard deviation 10%.
    expect(strategyPerformance(points([100, 110, 110, 99])).sharpe).toBeCloseTo(
      0,
      10,
    );
    const p = strategyPerformance(points([100, 110, 132])); // 10%,20%; mean .15, sample SD sqrt(.005)
    expect(p.sharpe).toBeCloseTo((0.15 / Math.sqrt(0.005)) * Math.sqrt(252));
    expect(
      strategyPerformance(points([100, 110, 132]), 365).sharpe,
    ).toBeCloseTo((0.15 / Math.sqrt(0.005)) * Math.sqrt(365));
  });
  it('uses final intraday mark and native coarse frequency', () => {
    const intraday = [
      ...points([100, 110, 132]),
      { time: 86400 + 100, equity: 120, cash: 120, positionValue: 0 },
    ].sort((a, b) => a.time - b.time);
    expect(strategyPerformance(intraday)).toEqual(
      strategyPerformance(points([100, 120, 132])),
    );
    expect(
      strategyPerformance(points([100, 110, 132], 7 * 86400)).periodsPerYear,
    ).toBe(52);
    expect(
      strategyPerformance(points([100, 110, 132], 30 * 86400)).periodsPerYear,
    ).toBe(12);
  });
  it('does not invent Sharpe for insufficient, constant or bankrupt equity', () => {
    for (const values of [
      [],
      [100],
      [100, 110],
      [100, 100, 100],
      [100, 0, 100],
    ])
      expect(strategyPerformance(points(values)).sharpe).toBeNull();
  });
});

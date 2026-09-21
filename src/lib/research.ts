import { runStrategy, optimizeStrategy, type Strategy } from './strategy';
import { type Candle, type EquityPoint } from './engine';
import { strategyPerformance } from './strategyPerformance';
export type ResearchOptions = {
  mode: 'single' | 'walk-forward';
  trainBars: number;
  testBars: number;
  simulations: number;
  seed: number;
};
export type ParameterGrid = { path: string; values: number[] }[];
export function monteCarlo(
  pnls: number[],
  capital: number,
  simulations: number,
  seed: number,
) {
  if (
    !Number.isInteger(simulations) ||
    simulations < 100 ||
    simulations > 5000 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 4294967295
  )
    throw new Error('Use 100–5,000 simulations and a 32-bit nonnegative seed.');
  if (!pnls.length) return { simulations, seed, trades: 0, percentiles: null };
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const outcomes: { pnl: number; drawdown: number }[] = [];
  for (let n = 0; n < simulations; n++) {
    let equity = capital,
      peak = capital,
      drawdown = 0;
    for (let i = 0; i < pnls.length; i++) {
      equity += pnls[Math.floor(random() * pnls.length)];
      peak = Math.max(peak, equity);
      drawdown = Math.max(drawdown, ((peak - equity) / peak) * 100);
    }
    outcomes.push({ pnl: equity - capital, drawdown });
  }
  const percentile = (values: number[], q: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * q)];
  };
  return {
    simulations,
    seed,
    trades: pnls.length,
    percentiles: [0.05, 0.5, 0.95].map((q) => ({
      percentile: q * 100,
      pnl: percentile(
        outcomes.map((o) => o.pnl),
        q,
      ),
      drawdown: percentile(
        outcomes.map((o) => o.drawdown),
        q,
      ),
    })),
    lossProbability: outcomes.filter((o) => o.pnl < 0).length / simulations,
  };
}
export function runResearch(
  strategy: Strategy,
  bars: Candle[],
  parameters: ParameterGrid,
  options: ResearchOptions,
  split = 0.7,
  progress?: (done: number, total: number) => void,
) {
  if (!options || !['single', 'walk-forward'].includes(options.mode))
    throw new Error('Choose a research mode.');
  // Validate simulation limits even if no trades are produced.
  monteCarlo(
    [],
    strategy.config.initialCapital,
    options.simulations,
    options.seed,
  );
  if (options.mode === 'single') {
    const output = parameters.length
      ? optimizeStrategy(strategy, bars, parameters, split)
      : runStrategy(strategy, bars);
    const evaluation = 'test' in output ? output.test : output;
    return {
      ...output,
      researchKind: 'single',
      monteCarlo: monteCarlo(
        evaluation.trades.map((t) => t.pnl),
        strategy.config.initialCapital,
        options.simulations,
        options.seed,
      ),
    };
  }
  const { trainBars, testBars } = options;
  if (
    !Number.isInteger(trainBars) ||
    !Number.isInteger(testBars) ||
    trainBars < 10 ||
    testBars < 2 ||
    trainBars < testBars ||
    trainBars > testBars * 9
  )
    throw new Error(
      'Use at least 10 training bars and 2 test bars; training must be 1–9 times test length.',
    );
  const count = Math.floor((bars.length - trainBars) / testBars);
  if (count < 2 || count > 20)
    throw new Error(
      'Choose window sizes producing 2–20 complete test windows.',
    );
  const folds = [];
  const equity: EquityPoint[] = [];
  const pnls: number[] = [];
  let totalPnl = 0;
  for (let fold = 0; fold < count; fold++) {
    const start = fold * testBars,
      boundary = start + trainBars,
      end = boundary + testBars;
    const sample = bars.slice(start, end);
    const optimized = optimizeStrategy(
      strategy,
      sample,
      parameters,
      trainBars / (trainBars + testBars),
    );
    const test = optimized.test;
    for (const point of test.account.equityHistory) {
      const shifted = { time: point.time, equity: point.equity + totalPnl };
      if (equity.at(-1)?.time === point.time)
        equity[equity.length - 1] = shifted;
      else equity.push(shifted);
    }
    totalPnl += test.metrics.totalPnl;
    pnls.push(...test.trades.map((t) => t.pnl));
    folds.push({
      fold: fold + 1,
      trainStart: bars[start].time,
      trainEnd: bars[boundary - 1].time,
      testStart: bars[boundary].time,
      testEnd: bars[end - 1].time,
      winner: optimized.winner,
      candidates: optimized.candidates,
      metrics: test.metrics,
      performance: test.performance,
      trades: test.trades,
    });
    progress?.(fold + 1, count);
  }
  let peak = strategy.config.initialCapital,
    maxDrawdown = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.equity);
    maxDrawdown = Math.max(maxDrawdown, ((peak - p.equity) / peak) * 100);
  }
  return {
    researchKind: 'walk-forward',
    parameters,
    folds,
    equity,
    totalPnl,
    maxDrawdown,
    performance: strategyPerformance(equity, strategy.tradingDaysPerYear),
    monteCarlo: monteCarlo(
      pnls,
      strategy.config.initialCapital,
      options.simulations,
      options.seed,
    ),
    selection:
      'Each rolling training window selects by training net P&L only. Test windows do not overlap. Each starts a fresh fixed-capital account; combined P&L is additive.',
  };
}

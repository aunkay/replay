import {
  aggregateTimeframe,
  candleDuration,
  RULE_INTERVALS,
  type RuleInterval,
} from './timeframes';
import {
  advanceBar,
  closePosition,
  createAccount,
  getMetrics,
  submitOrder,
  type Candle,
  type EngineConfig,
  type TradingState,
} from './engine';
import { INDICATORS, computeIndicator, type IndicatorId } from './indicators';
import { analyzeTrades, closedTrades } from './analytics';
import { sizeByRisk } from './risk';
import { strategyPerformance } from './strategyPerformance';
export type Operand = (
  | { kind: 'price'; field: 'open' | 'high' | 'low' | 'close' | 'volume' }
  | { kind: 'constant'; value: number }
  | { kind: 'indicator'; indicator: IndicatorId; period: number; plot?: string }
) & { offset?: number; interval?: RuleInterval };
export type Condition = {
  left: Operand;
  op: 'gt' | 'lt' | 'crossUp' | 'crossDown';
  right: Operand;
};
export type Rule = { join: 'and' | 'or'; conditions: Condition[] };
export type Strategy = {
  version: 1;
  name: string;
  longEntry: Rule;
  shortEntry: Rule;
  longExit: Rule;
  shortExit: Rule;
  quantity: number;
  riskPct?: number;
  allocationPct?: number;
  tradingDaysPerYear?: number;
  stopPct?: number;
  targetPct?: number;
  config: EngineConfig;
};
export type StrategyResult = {
  account: TradingState;
  metrics: ReturnType<typeof getMetrics>;
  trades: ReturnType<typeof closedTrades>;
  analytics: ReturnType<typeof analyzeTrades>;
  conflicts: number;
  performance: ReturnType<typeof strategyPerformance>;
};
export function validateStrategy(strategy: Strategy) {
  if (!strategy || strategy.version !== 1 || typeof strategy.name !== 'string')
    throw new Error('Invalid strategy definition');
  createAccount(strategy.config);
  if (!Number.isFinite(strategy.quantity) || strategy.quantity <= 0)
    throw new Error('Quantity must be positive');
  for (const field of [
    'riskPct',
    'stopPct',
    'targetPct',
    'allocationPct',
  ] as const) {
    const v = strategy[field];
    if (v !== undefined && (!Number.isFinite(v) || v <= 0 || v >= 100))
      throw new Error(`${field} must be between zero and 100`);
  }
  if (
    strategy.tradingDaysPerYear !== undefined &&
    ![252, 365].includes(strategy.tradingDaysPerYear)
  )
    throw new Error('Choose 252 or 365 trading days per year');
  if (strategy.riskPct && strategy.allocationPct)
    throw new Error('Choose either risk sizing or equity allocation');
  if (strategy.riskPct && !strategy.stopPct)
    throw new Error('Risk sizing requires a stop');
  for (const name of [
    'longEntry',
    'shortEntry',
    'longExit',
    'shortExit',
  ] as const) {
    const rule = strategy[name];
    if (
      !rule ||
      !['and', 'or'].includes(rule.join) ||
      !Array.isArray(rule.conditions) ||
      rule.conditions.length > 20
    )
      throw new Error('Each rule supports at most 20 conditions');
    for (const c of rule.conditions) {
      if (!['gt', 'lt', 'crossUp', 'crossDown'].includes(c.op))
        throw new Error('Unknown condition operator');
      for (const operand of [c.left, c.right]) {
        if (
          !operand ||
          !['price', 'constant', 'indicator'].includes(operand.kind)
        )
          throw new Error('Unknown rule operand');
        if (
          operand.interval !== undefined &&
          !(operand.interval in RULE_INTERVALS)
        )
          throw new Error('Unsupported rule interval');
        if (
          !Number.isInteger(operand.offset ?? 0) ||
          (operand.offset ?? 0) < 0 ||
          (operand.offset ?? 0) > 500
        )
          throw new Error('Bars ago must be 0–500');
        if (operand.kind === 'constant' && !Number.isFinite(operand.value))
          throw new Error('Constant must be finite');
        if (
          operand.kind === 'price' &&
          !['open', 'high', 'low', 'close', 'volume'].includes(operand.field)
        )
          throw new Error('Unknown price field');
        if (
          operand.kind === 'indicator' &&
          (!INDICATORS.some((i) => i.id === operand.indicator) ||
            !Number.isInteger(operand.period) ||
            operand.period < 1 ||
            operand.period > 500)
        )
          throw new Error('Choose a valid indicator and period');
      }
    }
  }
}
/** Evaluates rules using only the supplied candle history. */
export function createRuleEvaluator(bars: Candle[]) {
  const operands = new Map<string, Map<number, number>>();
  const higher = new Map<RuleInterval, Candle[]>();
  const duration = candleDuration(bars);
  function value(operand: Operand, index: number): number | undefined {
    if (index < 0 || index >= bars.length) return undefined;
    if (operand.kind === 'constant') return operand.value;
    let series = bars,
      at = index;
    if (operand.interval) {
      if (!higher.has(operand.interval))
        higher.set(
          operand.interval,
          aggregateTimeframe(bars, operand.interval),
        );
      series = higher.get(operand.interval)!;
      const clock = bars[index].endTime ?? bars[index].time + duration;
      let lo = 0,
        hi = series.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (series[mid].endTime! <= clock) lo = mid + 1;
        else hi = mid;
      }
      at = lo - 1;
    }
    at -= operand.offset ?? 0;
    if (at < 0 || at >= series.length) return undefined;
    if (operand.kind === 'price') return series[at][operand.field];
    const key = JSON.stringify(operand);
    if (!operands.has(key)) {
      const plots = computeIndicator(
        {
          id: key,
          indicatorId: operand.indicator,
          period: operand.period,
          color: '#ffffff',
        },
        series,
      );
      const plot = operand.plot
        ? plots.find((p) => p.key === operand.plot)
        : plots[0];
      operands.set(
        key,
        new Map(plot?.data.map((p) => [p.time, p.value]) ?? []),
      );
    }
    return operands.get(key)!.get(series[at].time);
  }
  function matches(rule: Rule, index: number) {
    if (!rule.conditions.length) return false;
    const conditions = rule.conditions.map((c) => {
      const a = value(c.left, index),
        b = value(c.right, index);
      if (
        a === undefined ||
        b === undefined ||
        !Number.isFinite(a) ||
        !Number.isFinite(b)
      )
        return false;
      if (c.op === 'gt') return a > b;
      if (c.op === 'lt') return a < b;
      const p = value(c.left, index - 1),
        q = value(c.right, index - 1);
      return (
        p !== undefined &&
        q !== undefined &&
        (c.op === 'crossUp' ? a > b && p <= q : a < b && p >= q)
      );
    });
    return rule.join === 'and'
      ? conditions.every(Boolean)
      : conditions.some(Boolean);
  }
  return matches;
}

export function runStrategy(
  strategy: Strategy,
  bars: Candle[],
  start = 1,
  end = bars.length,
  progress?: (done: number, total: number) => void,
): StrategyResult {
  validateStrategy(strategy);
  if (
    bars.length < 2 ||
    bars.length > 100000 ||
    start < 1 ||
    end > bars.length ||
    start >= end
  )
    throw new Error('Choose 2–100,000 candles and a valid evaluation range.');
  let state = advanceBar(createAccount(strategy.config), bars[start - 1]);
  const matches = createRuleEvaluator(bars);
  let conflicts = 0;
  for (let i = start; i < end; i++) {
    const bar = bars[i],
      signalIndex = i - 1;
    const long = matches(strategy.longEntry, signalIndex),
      short = matches(strategy.shortEntry, signalIndex);
    // Signal exits and new market entries use the next open. The whole candle is
    // then processed for protection; no signal can execute on its own close.
    const openBar = { ...bar, high: bar.open, low: bar.open, close: bar.open };
    if (
      (state.position.quantity > 0 &&
        matches(strategy.longExit, signalIndex)) ||
      (state.position.quantity < 0 && matches(strategy.shortExit, signalIndex))
    )
      state = closePosition(state, openBar);
    if (long && short) conflicts++;
    if (!state.position.quantity && long !== short) {
      const side = long ? 'buy' : 'sell',
        sign = long ? 1 : -1;
      const stopLoss = strategy.stopPct
        ? bar.open * (1 - (sign * strategy.stopPct) / 100)
        : undefined;
      const takeProfit = strategy.targetPct
        ? bar.open * (1 + (sign * strategy.targetPct) / 100)
        : undefined;
      const budget = strategy.riskPct
        ? (getMetrics(state, bar.open).equity * strategy.riskPct) / 100
        : undefined;
      const sizing =
        budget && stopLoss
          ? sizeByRisk({
              entry: bar.open,
              stop: stopLoss,
              side,
              budget,
              buyingPower: getMetrics(state, bar.open).buyingPower,
              step: 0.000001,
              config: state.config,
            })
          : null;
      state = submitOrder(
        state,
        {
          side,
          type: 'market',
          quantity:
            sizing?.quantity ??
            (strategy.allocationPct
              ? Math.floor(
                  ((Math.max(0, getMetrics(state, bar.open).equity) *
                    strategy.allocationPct) /
                    100 /
                    (bar.open *
                      (1 + state.config.slippageBps / 10000) *
                      (1 + state.config.commissionBps / 10000))) *
                    1e6,
                ) / 1e6
              : strategy.quantity),
          stopLoss,
          takeProfit,
          plannedRisk: sizing?.risk,
        },
        openBar,
      );
    }
    state = advanceBar(state, bar, true);
    if (i % 500 === 0 || i === end - 1) progress?.(i - start + 1, end - start);
  }
  if (state.position.quantity) state = closePosition(state, bars[end - 1]);
  state = {
    ...state,
    orders: state.orders.map((o) =>
      o.status === 'pending'
        ? { ...o, status: 'cancelled' as const, reason: 'End of evaluation' }
        : o,
    ),
  };
  const trades = closedTrades(state.orders, bars.slice(start, end));
  return {
    account: state,
    metrics: getMetrics(state, bars[end - 1].close),
    trades,
    analytics: analyzeTrades(trades),
    conflicts,
    performance: strategyPerformance(
      state.equityHistory,
      strategy.tradingDaysPerYear,
    ),
  };
}
export const emptyRule = (): Rule => ({ join: 'and', conditions: [] });
export function defaultStrategy(): Strategy {
  return {
    version: 1,
    name: 'SMA crossover',
    longEntry: {
      join: 'and',
      conditions: [
        {
          left: { kind: 'indicator', indicator: 'sma', period: 20 },
          op: 'crossUp',
          right: { kind: 'indicator', indicator: 'sma', period: 50 },
        },
      ],
    },
    shortEntry: emptyRule(),
    longExit: {
      join: 'and',
      conditions: [
        {
          left: { kind: 'indicator', indicator: 'sma', period: 20 },
          op: 'crossDown',
          right: { kind: 'indicator', indicator: 'sma', period: 50 },
        },
      ],
    },
    shortExit: emptyRule(),
    quantity: 10,
    stopPct: 2,
    targetPct: 4,
    config: { initialCapital: 100000, commissionBps: 1, slippageBps: 1 },
  };
}
export function optimizeStrategy(
  strategy: Strategy,
  bars: Candle[],
  parameters: { path: string; values: number[] }[],
  split = 0.7,
  progress?: (done: number, total: number, candidate: unknown) => void,
) {
  if (!(split >= 0.5 && split <= 0.9))
    throw new Error('Training split must be 50–90%.');
  const count = parameters.reduce((n, p) => n * p.values.length, 1);
  if (!count || count > 500)
    throw new Error('Choose 1–500 parameter combinations.');
  const boundary = Math.floor(bars.length * split);
  const candidates: {
    strategy: Strategy;
    training: Omit<StrategyResult, 'account' | 'trades'>;
  }[] = [];
  function visit(at: number, candidate: Strategy) {
    if (at === parameters.length) {
      const {
        account: _account,
        trades: _trades,
        ...training
      } = runStrategy(candidate, bars.slice(0, boundary));
      candidates.push({ strategy: candidate, training });
      progress?.(candidates.length, count, { strategy: candidate, training });
      return;
    }
    const parameter = parameters[at];
    // Only existing numeric fields can be adjusted; prevent arbitrary prototype mutation.
    const keys = parameter.path.split('.');
    if (keys.some((k) => ['__proto__', 'constructor', 'prototype'].includes(k)))
      throw new Error('Invalid parameter path.');
    for (const value of parameter.values) {
      if (!Number.isFinite(value) || value <= 0)
        throw new Error('Parameter values must be positive.');
      const copy = structuredClone(candidate);
      let cursor: Record<string, unknown> = copy as unknown as Record<
        string,
        unknown
      >;
      for (const key of keys.slice(0, -1)) {
        if (!cursor[key] || typeof cursor[key] !== 'object')
          throw new Error('Invalid parameter path.');
        cursor = cursor[key] as Record<string, unknown>;
      }
      const key = keys.at(-1)!;
      if (typeof cursor[key] !== 'number')
        throw new Error('Choose a numeric strategy parameter.');
      cursor[key] = value;
      visit(at + 1, copy);
    }
  }
  visit(0, strategy);
  candidates.sort(
    (a, b) => b.training.metrics.totalPnl - a.training.metrics.totalPnl,
  );
  return {
    boundary,
    parameters,
    candidates,
    winner: candidates[0].strategy,
    test: runStrategy(candidates[0].strategy, bars, boundary),
    selection: 'Training net profit only',
  };
}

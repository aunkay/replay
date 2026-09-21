import { isValidMarketData, type MarketData } from './data';
import type { TradingState } from './engine';

export type StoredSession = {
  mode?: 'replay' | 'blind' | 'live';
  blind?: { seed: number; end: number; finished: boolean };
  market: MarketData;
  cursor: number;
  startCursor: number;
  account: TradingState;
  checkpoints?: {
    id: string;
    name: string;
    cursor: number;
    startCursor: number;
    account: TradingState;
  }[];
};

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number =>
  finite(value) && value > 0;
const nonnegative = (value: unknown): value is number =>
  finite(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string';
const nonemptyText = (value: unknown): value is string =>
  text(value) && value.trim().length > 0;
// Yahoo's historical market data fits comfortably inside 1900–2200. Bounding
// seconds also prevents a saved millisecond timestamp reaching chart/date APIs.
const MIN_TIME = -2_208_988_800;
const MAX_TIME = 7_258_118_400;
const timestamp = (value: unknown): value is number =>
  finite(value) &&
  Number.isSafeInteger(value) &&
  value >= MIN_TIME &&
  value <= MAX_TIME;
function validDynamic(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  if (value.breakEvenPct !== undefined && !positive(value.breakEvenPct))
    return false;
  if (value.trailing !== undefined) {
    const t = value.trailing;
    if (
      !record(t) ||
      !['price', 'percent', 'atr'].includes(String(t.mode)) ||
      !positive(t.distance) ||
      (t.mode === 'percent' && t.distance >= 100)
    )
      return false;
  }
  return true;
}
/** Validate untrusted browser storage before it reaches accounting and charts. */
export function isValidSession(value: unknown): value is StoredSession {
  if (
    !record(value) ||
    !isValidMarketData(value.market) ||
    !Number.isInteger(value.cursor) ||
    !Number.isInteger(value.startCursor) ||
    !finite(value.cursor) ||
    !finite(value.startCursor) ||
    value.cursor < 0 ||
    value.cursor >= value.market.bars.length ||
    value.startCursor < 0 ||
    value.startCursor > value.cursor ||
    !record(value.account)
  )
    return false;

  if (value.checkpoints !== undefined) {
    if (!Array.isArray(value.checkpoints) || value.checkpoints.length > 20)
      return false;
    const checkpointIds = new Set<string>();
    for (const c of value.checkpoints) {
      if (
        !record(c) ||
        !nonemptyText(c.id) ||
        c.id.length > 100 ||
        checkpointIds.has(c.id) ||
        !nonemptyText(c.name) ||
        c.name.length > 100
      )
        return false;
      checkpointIds.add(c.id);
      if (
        !isValidSession({
          market: value.market,
          cursor: c.cursor,
          startCursor: c.startCursor,
          account: c.account,
        })
      )
        return false;
    }
  }
  const currentTime = value.market.bars[value.cursor].time;
  const account = value.account;
  if (!validDynamic(account.dynamicProtection)) return false;
  if (
    account.recentBars !== undefined &&
    (!Array.isArray(account.recentBars) ||
      account.recentBars.length > 15 ||
      account.recentBars.some(
        (b) =>
          !record(b) ||
          !timestamp(b.time) ||
          b.time > currentTime ||
          !positive(b.high) ||
          !positive(b.low) ||
          !positive(b.close),
      ))
  )
    return false;
  const config = account.config;
  const position = account.position;
  if (
    !record(config) ||
    !positive(config.initialCapital) ||
    !nonnegative(config.commissionBps) ||
    config.commissionBps > 10_000 ||
    !nonnegative(config.slippageBps) ||
    config.slippageBps >= 10_000 ||
    !finite(account.cash) ||
    !finite(account.realizedPnl) ||
    !nonnegative(account.feesPaid) ||
    !record(position) ||
    !finite(position.quantity) ||
    !finite(position.averagePrice) ||
    (position.quantity === 0
      ? position.averagePrice !== 0
      : position.averagePrice <= 0) ||
    !Array.isArray(account.orders) ||
    !Array.isArray(account.equityHistory) ||
    account.equityHistory.length === 0
  )
    return false;

  const startTime = value.market.bars[value.startCursor].time;
  const currentBar = value.market.bars[value.cursor];
  const knownTimes = new Set(
    value.market.bars
      .slice(value.startCursor, value.cursor + 1)
      .map((bar) => bar.time),
  );
  const accountTime = (time: unknown): time is number =>
    timestamp(time) &&
    time >= startTime &&
    time <= currentBar.time &&
    knownTimes.has(time);
  const ids = new Set<string>();
  for (const order of account.orders) {
    if (
      !record(order) ||
      !nonemptyText(order.id) ||
      ids.has(order.id) ||
      !text(order.side) ||
      !['buy', 'sell'].includes(order.side) ||
      !text(order.type) ||
      !['market', 'limit', 'stop'].includes(order.type) ||
      !text(order.status) ||
      !['pending', 'filled', 'cancelled', 'rejected'].includes(order.status) ||
      !finite(order.quantity) ||
      !accountTime(order.createdAt) ||
      (order.reason !== undefined && !text(order.reason)) ||
      (order.price !== undefined && !finite(order.price)) ||
      (order.realizedPnl !== undefined && !finite(order.realizedPnl))
    )
      return false;
    if (!validDynamic(order.dynamicProtection)) return false;
    if (order.takeProfits !== undefined) {
      if (
        !Array.isArray(order.takeProfits) ||
        order.takeProfits.length > 3 ||
        (order.takeProfits.length > 0 && order.takeProfit !== undefined)
      )
        return false;
      let allocation = 0;
      const prices = new Set<number>();
      for (const target of order.takeProfits) {
        if (
          !record(target) ||
          !positive(target.price) ||
          !positive(target.percent) ||
          target.percent > 100 ||
          prices.has(target.price)
        )
          return false;
        prices.add(target.price);
        allocation += target.percent;
      }
      if (allocation > 100 + 1e-8) return false;
    }
    ids.add(order.id);
    if (
      order.status !== 'rejected' &&
      (order.quantity <= 0 ||
        (order.type !== 'market' && !positive(order.price)))
    )
      return false;
    if (order.status === 'filled') {
      if (
        !accountTime(order.filledAt) ||
        order.filledAt < order.createdAt ||
        (order.type !== 'market' &&
          !order.reduceOnly &&
          order.filledAt <= order.createdAt) ||
        !positive(order.fillPrice) ||
        !nonnegative(order.fee)
      )
        return false;
    } else if (
      order.filledAt !== undefined ||
      order.fillPrice !== undefined ||
      order.fee !== undefined ||
      order.realizedPnl !== undefined ||
      (order.status === 'pending' && order.type === 'market')
    )
      return false;
  }

  let previousTime = -Infinity;
  let lastEquity: number | undefined;
  for (const point of account.equityHistory) {
    if (
      !record(point) ||
      !accountTime(point.time) ||
      point.time <= previousTime ||
      !finite(point.equity)
    )
      return false;
    previousTime = point.time;
    lastEquity = point.equity;
  }
  if (previousTime !== currentBar.time) return false;
  const equity = account.cash + position.quantity * currentBar.close;
  const unrealized =
    position.quantity * (currentBar.close - position.averagePrice);
  const total = equity - config.initialCapital;
  const tolerance =
    Math.max(1, Math.abs(equity), Math.abs(total), config.initialCapital) *
    1e-8;
  return (
    finite(equity) &&
    finite(unrealized) &&
    finite(total) &&
    lastEquity !== undefined &&
    Math.abs(lastEquity - equity) <= tolerance &&
    Math.abs(account.realizedPnl + unrealized - total) <= tolerance
  );
}

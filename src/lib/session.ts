import type { SessionPortfolio } from './sessionPortfolio';
import { validateAlert, type MarketAlert, type AlertEvent } from './alerts';
import { isValidMarketData, type MarketData } from './data';
import { createAccount, type TradingState } from './engine';

export type StoredSession = {
  portfolio?: SessionPortfolio;
  mode?: 'replay' | 'blind' | 'live';
  blind?: { seed: number; end: number; finished: boolean };
  market: MarketData;
  cursor: number;
  startCursor: number;
  account: TradingState;
  finerMarket?: MarketData;
  alerts?: MarketAlert[];
  alertEvents?: AlertEvent[];
  checkpoints?: {
    portfolio?: SessionPortfolio;
    id: string;
    name: string;
    cursor: number;
    startCursor: number;
    account: TradingState;
    finerMarket?: MarketData;
    alerts?: MarketAlert[];
    alertEvents?: AlertEvent[];
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

  if (
    value.finerMarket !== undefined &&
    (!isValidMarketData(value.finerMarket) ||
      value.finerMarket.ticker !== value.market.ticker ||
      value.finerMarket.currency !== value.market.currency ||
      value.finerMarket.adjusted !== value.market.adjusted)
  )
    return false;
  try {
    if (value.alerts !== undefined) {
      if (!Array.isArray(value.alerts) || value.alerts.length > 30)
        return false;
      const ids = new Set<string>();
      for (const a of value.alerts) {
        validateAlert(a);
        if (ids.has(a.id)) return false;
        ids.add(a.id);
      }
    }
    if (
      value.alertEvents !== undefined &&
      (!Array.isArray(value.alertEvents) ||
        value.alertEvents.length > 200 ||
        value.alertEvents.some(
          (e) =>
            !record(e) ||
            !nonemptyText(e.id) ||
            !nonemptyText(e.alertId) ||
            !nonemptyText(e.name) ||
            !timestamp(e.time) ||
            !positive(e.price) ||
            typeof e.pause !== 'boolean',
        ))
    )
      return false;
  } catch {
    return false;
  }
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
          portfolio: c.portfolio,
          cursor: c.cursor,
          startCursor: c.startCursor,
          account: c.account,
          finerMarket: c.finerMarket,
          alerts: c.alerts,
          alertEvents: c.alertEvents,
        })
      )
        return false;
    }
  }
  if (value.portfolio !== undefined && !validPortfolio(value)) return false;
  const currentTime = value.market.bars[value.cursor].time;
  const account = value.account;
  // This context is computed by the portfolio engine, never trusted from storage.
  if (account.capitalContext !== undefined) return false;
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
  if (
    account.financing !== undefined &&
    (!Array.isArray(account.financing) ||
      account.financing.some(
        (f) =>
          !record(f) ||
          !timestamp(f.time) ||
          !nonnegative(f.amount) ||
          !nonemptyText(f.tradeId),
      ))
  )
    return false;
  const config = account.config;
  const position = account.position;
  try {
    createAccount(config as unknown as TradingState['config']);
  } catch {
    return false;
  }
  if (
    account.borrowingPaid !== undefined &&
    !nonnegative(account.borrowingPaid)
  )
    return false;
  if (
    account.liquidity !== undefined &&
    (!record(account.liquidity) ||
      !timestamp(account.liquidity.time) ||
      !nonnegative(account.liquidity.remaining))
  )
    return false;

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
    if (
      order.executionTime !== undefined &&
      (!timestamp(order.executionTime) ||
        !finite(order.filledAt) ||
        order.executionTime < order.filledAt ||
        order.executionTime >
          (currentBar.endTime ??
            value.market.bars[value.cursor + 1]?.time ??
            currentBar.time))
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
          order.filledAt <= order.createdAt &&
          order.executionTime === undefined) ||
        !positive(order.fillPrice) ||
        !nonnegative(order.fee)
      )
        return false;
    } else if (
      order.filledAt !== undefined ||
      order.fillPrice !== undefined ||
      order.fee !== undefined ||
      order.realizedPnl !== undefined ||
      (order.status === 'pending' &&
        order.type === 'market' &&
        !(order.queuedMarket && config.volumeParticipationPct))
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

function validPortfolio(session: RecordValue): boolean {
  const p = session.portfolio;
  if (
    !record(p) ||
    !record(p.book) ||
    !Array.isArray(p.markets) ||
    !Array.isArray(p.book.assets) ||
    p.book.assets.length < 2 ||
    p.book.assets.length > 6 ||
    p.markets.length !== p.book.assets.length - 1
  )
    return false;
  const market = session.market as MarketData;
  const book = p.book;
  if (
    !finite(book.cash) ||
    book.currency !== market.currency ||
    !record(session.account) ||
    JSON.stringify(book.config) !== JSON.stringify(session.account.config)
  )
    return false;
  const assets = book.assets as unknown[];
  const markets = [market, ...p.markets];
  const tickers = new Set<string>();
  for (const m of markets) {
    if (
      !isValidMarketData(m) ||
      tickers.has(m.ticker) ||
      m.currency !== market.currency ||
      m.interval !== market.interval ||
      m.adjusted !== market.adjusted
    )
      return false;
    tickers.add(m.ticker);
    const matches = assets.filter((a) => record(a) && a.ticker === m.ticker);
    if (matches.length !== 1) return false;
    const a = matches[0] as RecordValue;
    if (
      !record(a.bar) ||
      !record(a.account) ||
      a.currency !== m.currency ||
      JSON.stringify(a.account.config) !== JSON.stringify(book.config)
    )
      return false;
    const at = m.bars.findIndex((b) => b.time === (a.bar as RecordValue).time);
    if (
      at < 0 ||
      JSON.stringify(m.bars[at]) !== JSON.stringify(a.bar) ||
      m.bars[at].time > market.bars[session.cursor as number].time
    )
      return false;
    const history = a.account.equityHistory;
    if (!Array.isArray(history) || !record(history[0])) return false;
    const start = m.bars.findIndex(
      (b) => b.time === (history[0] as RecordValue).time,
    );
    if (
      !isValidSession({
        market: m,
        account: a.account,
        cursor: at,
        startCursor: start,
      })
    )
      return false;
    if (
      m.ticker === market.ticker &&
      (at !== session.cursor ||
        JSON.stringify(a.account) !== JSON.stringify(session.account))
    )
      return false;
  }
  const capital = (session.account.config as TradingState['config'])
    .initialCapital;
  const expectedCash =
    capital +
    assets.reduce<number>(
      (sum, a) =>
        sum + ((a as { account: TradingState }).account.cash - capital),
      0,
    );
  const tolerance = Math.max(1, Math.abs(expectedCash), capital) * 1e-8;
  if (
    Math.abs(book.cash - expectedCash) > tolerance ||
    !Array.isArray(book.equityHistory) ||
    !book.equityHistory.length
  )
    return false;
  let previous = -Infinity;
  for (const point of book.equityHistory) {
    if (
      !record(point) ||
      !timestamp(point.time) ||
      point.time <= previous ||
      point.time > market.bars[session.cursor as number].time ||
      !finite(point.equity)
    )
      return false;
    previous = point.time;
  }
  const equity =
    book.cash +
    assets.reduce<number>((sum, a) => {
      const asset = a as { account: TradingState; bar: { close: number } };
      return sum + asset.account.position.quantity * asset.bar.close;
    }, 0);
  const last = book.equityHistory.at(-1) as { time: number; equity: number };
  return (
    last.time === market.bars[session.cursor as number].time &&
    Math.abs(last.equity - equity) <= tolerance
  );
}

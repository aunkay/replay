import {
  advancePortfolioSession,
  applyTradingCommand,
} from './sessionPortfolio';
import { evaluateAlerts } from './alerts';
import {
  advanceBar,
  cancelOrder,
  closePosition,
  createAccount,
  editBracket,
  submitOrder,
  withEquity,
  type EngineConfig,
  type OrderRequest,
} from './engine';
import type { MarketData } from './data';
import type { StoredSession } from './session';
export type LiveCommand = {
  key: string;
  submittedAt: number;
  command: {
    type: string;
    ticker?: string;
    order?: OrderRequest;
    id?: string;
    stopLoss?: number;
    takeProfit?: number;
  };
};
export function initializeLive(
  market: MarketData,
  config: EngineConfig,
): StoredSession {
  const bars = market.bars.filter((b) => b.complete === true),
    cursor = bars.length - 1;
  if (cursor < 0) throw new Error('No completed candles yet');
  return {
    mode: 'live',
    market: { ...market, bars },
    cursor,
    startCursor: cursor,
    account: advanceBar(createAccount(config), bars[cursor]),
  };
}
export function applyLiveTick(
  session: StoredSession,
  market: MarketData,
  queued: LiveCommand[],
  resumeAfter: number,
  comparisonMarkets: MarketData[] = [],
) {
  if (session.portfolio)
    return applyPortfolioLiveTick(
      session,
      market,
      queued,
      resumeAfter,
      comparisonMarkets,
    );
  const oldTime = session.market.bars[session.cursor].time,
    bars = market.bars.filter((b) => b.complete === true);
  let account = session.account,
    pending = [...queued];
  let alertSession = session;
  const observed = [...session.market.bars];
  const rejected: { key: string; reason: string }[] = [];
  for (const bar of bars.filter((b) => b.time > oldTime)) {
    observed.push(bar);
    if ((bar.endTime ?? bar.time) <= resumeAfter) {
      account = withEquity(account, bar);
      continue;
    }
    account = advanceBar(account, bar);
    const ready = pending.filter(
      (p) => p.submittedAt < (bar.endTime ?? bar.time),
    );
    pending = pending.filter((p) => !ready.includes(p));
    for (const request of ready) {
      const c = request.command;
      try {
        if (c.type === 'order') account = submitOrder(account, c.order!, bar);
        else if (c.type === 'close') account = closePosition(account, bar);
        else if (c.type === 'cancel') account = cancelOrder(account, c.id!);
        else if (c.type === 'bracket')
          account = editBracket(account, c.stopLoss, c.takeProfit, bar);
        else throw new Error('Unknown live command');
      } catch (error) {
        rejected.push({ key: request.key, reason: (error as Error).message });
      }
    }
    alertSession = evaluateAlerts(alertSession, observed);
  }
  const merged = new Map(session.market.bars.map((b) => [b.time, b]));
  for (const bar of bars) if (bar.time > oldTime) merged.set(bar.time, bar);
  const finalBars = [...merged.values()].sort((a, b) => a.time - b.time);
  return {
    session: {
      ...alertSession,
      mode: 'live' as const,
      market: { ...market, bars: finalBars },
      cursor: finalBars.length - 1,
      account,
    },
    pending,
    rejected,
  };
}

function applyPortfolioLiveTick(
  session: StoredSession,
  market: MarketData,
  queued: LiveCommand[],
  resumeAfter: number,
  incoming: MarketData[],
) {
  const merge = (old: MarketData, fresh: MarketData) => {
    if (
      old.ticker !== fresh.ticker ||
      old.currency !== fresh.currency ||
      old.interval !== fresh.interval ||
      old.adjusted !== fresh.adjusted
    )
      throw new Error(
        'Live portfolio dataset identity changed. Start a new baseline.',
      );
    const last = old.bars.at(-1)?.time ?? -Infinity;
    const bars = new Map(old.bars.map((b) => [b.time, b]));
    for (const b of fresh.bars)
      if (b.complete === true && b.time > last) bars.set(b.time, b);
    return {
      ...fresh,
      bars: [...bars.values()].sort((a, b) => a.time - b.time),
    };
  };
  const current = session.portfolio!;
  const base = merge(session.market, market);
  const markets = current.markets.map((old) => {
    const fresh = incoming.find(
      (m) => m.ticker === old.ticker && m.interval === old.interval,
    );
    return fresh ? merge(old, fresh) : old;
  });
  // Provider fetches are staggered: wait until all tickers have supplied this
  // candle before competing for shared capital. No later close funds an earlier fill.
  const watermark = Math.min(
    base.bars.at(-1)!.time,
    ...markets.map((m) => m.bars.at(-1)!.time),
  );
  let next: StoredSession = {
    ...session,
    market: base,
    portfolio: { ...current, markets },
  };
  let pending = [...queued];
  const rejected: { key: string; reason: string }[] = [];
  for (
    let i = session.cursor + 1;
    i < base.bars.length && base.bars[i].time <= watermark;
    i++
  ) {
    const bar = base.bars[i];
    const gap = (bar.endTime ?? bar.time) <= resumeAfter;
    next = advancePortfolioSession(next, i, gap);
    if (gap) continue;
    const ready = pending.filter((p) => {
      const ticker = p.command.ticker ?? base.ticker;
      const quote = next.portfolio!.book.assets.find(
        (a) => a.ticker === ticker,
      )?.bar;
      return (
        quote?.time === bar.time &&
        p.submittedAt < (quote.endTime ?? quote.time)
      );
    });
    pending = pending.filter((p) => !ready.includes(p));
    for (const request of ready) {
      try {
        next = applyTradingCommand(next, request.command);
      } catch (e) {
        rejected.push({ key: request.key, reason: (e as Error).message });
      }
    }
    next = evaluateAlerts(next, base.bars.slice(0, i + 1));
  }
  return { session: { ...next, mode: 'live' as const }, pending, rejected };
}

/** Check a queued request without executing it or requiring all current quotes
 * to be aligned. Actual shared-capital checks happen on the next eligible bar. */
export function validateLiveCommand(
  session: StoredSession,
  command: LiveCommand['command'],
) {
  const ticker = command.ticker ?? session.market.ticker;
  let detached = { ...session, portfolio: undefined };
  if (session.portfolio) {
    const asset = session.portfolio.book.assets.find(
      (a) => a.ticker === ticker,
    );
    if (!asset) throw new Error('Ticker is not in this portfolio.');
    const market =
      ticker === session.market.ticker
        ? session.market
        : session.portfolio.markets.find((m) => m.ticker === ticker)!;
    detached = {
      ...detached,
      market,
      cursor: market.bars.findIndex((b) => b.time === asset.bar.time),
      account: asset.account,
    };
  }
  const checked = applyTradingCommand(detached, command);
  if (command.type === 'order') {
    const last = checked.account.orders.at(-1);
    if (
      last?.status === 'rejected' &&
      !last.reason?.startsWith('Insufficient buying power')
    )
      throw new Error(last.reason ?? 'Invalid order.');
  }
}

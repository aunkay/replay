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
) {
  const oldTime = session.market.bars[session.cursor].time,
    bars = market.bars.filter((b) => b.complete === true);
  let account = session.account,
    pending = [...queued];
  const rejected: { key: string; reason: string }[] = [];
  for (const bar of bars.filter((b) => b.time > oldTime)) {
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
  }
  const merged = new Map(session.market.bars.map((b) => [b.time, b]));
  for (const bar of bars) if (bar.time > oldTime) merged.set(bar.time, bar);
  const finalBars = [...merged.values()].sort((a, b) => a.time - b.time);
  return {
    session: {
      ...session,
      mode: 'live' as const,
      market: { ...market, bars: finalBars },
      cursor: finalBars.length - 1,
      account,
    },
    pending,
    rejected,
  };
}

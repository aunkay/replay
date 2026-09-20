import type { Candle, Order } from './engine';
export type ClosedTrade = {
  id: string;
  direction: 'long' | 'short';
  openedAt: number;
  closedAt: number;
  pnl: number;
  fees: number;
  risk: number;
  r: number | null;
  orderIds: string[];
  ambiguous: boolean;
  mae: number;
  mfe: number;
};
export function closedTrades(
  orders: Order[],
  bars: Candle[] = [],
): ClosedTrade[] {
  let quantity = 0,
    cash = 0,
    fees = 0,
    risk = 0,
    openedAt = 0,
    entryPrice = 0;
  let ids: string[] = [],
    ambiguous = false,
    direction: 'long' | 'short' = 'long';
  const result: ClosedTrade[] = [];
  for (const o of orders
    .filter((o) => o.status === 'filled')
    .sort((a, b) => a.filledAt! - b.filledAt!)) {
    if (o.status !== 'filled') continue;
    const signed = o.side === 'buy' ? o.quantity : -o.quantity;
    const opposite = quantity && Math.sign(quantity) !== Math.sign(signed);
    const closing = opposite ? Math.min(Math.abs(quantity), o.quantity) : 0;
    const opening = o.quantity - closing;
    if (closing) {
      const partFee = ((o.fee ?? 0) * closing) / o.quantity;
      cash -= Math.sign(signed) * closing * o.fillPrice! + partFee;
      fees += partFee;
      quantity += Math.sign(signed) * closing;
      ids.push(o.id);
      ambiguous ||= Boolean(o.ambiguous);
      if (Math.abs(quantity) < 1e-9) {
        const seen = bars.filter(
          (b) => b.time > openedAt && b.time <= o.filledAt!,
        );
        const sign = direction === 'long' ? 1 : -1;
        result.push({
          id: ids[0],
          direction,
          openedAt,
          closedAt: o.filledAt!,
          pnl: cash,
          fees,
          risk,
          r: risk > 0 ? cash / risk : null,
          orderIds: [...ids],
          ambiguous,
          mfe: Math.max(
            0,
            ...seen.map(
              (b) => ((sign > 0 ? b.high : b.low) - entryPrice) * sign,
            ),
          ),
          mae: Math.max(
            0,
            ...seen.map(
              (b) => (entryPrice - (sign > 0 ? b.low : b.high)) * sign,
            ),
          ),
        });
        quantity = 0;
        cash = fees = risk = 0;
        ids = [];
        ambiguous = false;
      }
    }
    if (opening) {
      if (!quantity) {
        openedAt = o.filledAt!;
        direction = signed > 0 ? 'long' : 'short';
        entryPrice = o.fillPrice!;
      }
      const partFee = ((o.fee ?? 0) * opening) / o.quantity;
      quantity += Math.sign(signed) * opening;
      cash -= Math.sign(signed) * opening * o.fillPrice! + partFee;
      fees += partFee;
      risk += ((o.plannedRisk ?? 0) * opening) / o.quantity;
      ids.push(o.id);
    }
  }
  return result;
}
export function analyzeTrades(trades: ClosedTrade[]) {
  const wins = trades.filter((t) => t.pnl > 0),
    losses = trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0),
    grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  let winningStreak = 0,
    losingStreak = 0,
    w = 0,
    l = 0;
  for (const t of trades) {
    w = t.pnl > 0 ? w + 1 : 0;
    l = t.pnl < 0 ? l + 1 : 0;
    winningStreak = Math.max(winningStreak, w);
    losingStreak = Math.max(losingStreak, l);
  }
  return {
    count: trades.length,
    netProfit: grossProfit - grossLoss,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss
      ? grossProfit / grossLoss
      : grossProfit
        ? Infinity
        : null,
    expectancy: trades.length
      ? (grossProfit - grossLoss) / trades.length
      : null,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    averageWin: wins.length ? grossProfit / wins.length : null,
    averageLoss: losses.length ? grossLoss / losses.length : null,
    holdingSeconds: trades.length
      ? trades.reduce((s, t) => s + t.closedAt - t.openedAt, 0) / trades.length
      : null,
    winningStreak,
    losingStreak,
  };
}

export function equityAnalysis(
  points: { time: number; equity: number }[],
  initial: number,
) {
  let peak = initial,
    peakAt = points[0]?.time ?? 0,
    maxDrawdown = 0,
    maxDrawdownPct = 0,
    maxDuration = 0;
  for (const point of points) {
    if (point.equity >= peak) {
      maxDuration = Math.max(maxDuration, point.time - peakAt);
      peak = point.equity;
      peakAt = point.time;
    } else {
      maxDrawdown = Math.max(maxDrawdown, peak - point.equity);
      maxDrawdownPct = Math.max(
        maxDrawdownPct,
        ((peak - point.equity) / peak) * 100,
      );
      maxDuration = Math.max(maxDuration, point.time - peakAt);
    }
  }
  return { maxDrawdown, maxDrawdownPct, maxDrawdownSeconds: maxDuration };
}

/** Uses the cached provider snapshots fetched sequentially from Replay's API. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { STRATEGY_TEMPLATES } from '../src/lib/strategyTemplates';
import { runStrategy } from '../src/lib/strategy';
import type { MarketData } from '../src/lib/data';
const strategy = STRATEGY_TEMPLATES.find(
  (t) => t.id === 'profile-reclaim',
)!.strategy;
const cache = process.env.PROFILE_RESEARCH_CACHE ?? '/tmp/replay-vp-research';
await mkdir(cache, { recursive: true });
const datasets = [],
  results = [];
for (const ticker of ['SPY', 'QQQ']) {
  const path = `${cache}/${ticker}.json`;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const base = process.env.RESEARCH_API_URL ?? 'http://127.0.0.1:8080';
    const response = await fetch(
      `${base}/api/market-data?ticker=${ticker}&interval=5m&period=1mo`,
    );
    if (!response.ok)
      throw new Error(
        `${ticker}: HTTP ${response.status}; respect provider cooldown before retrying.`,
      );
    raw = await response.text();
    await writeFile(path, raw);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const market: MarketData = JSON.parse(raw);
  if (
    market.source !== 'yfinance' ||
    market.interval !== '5m' ||
    market.ticker !== ticker ||
    !market.adjusted ||
    market.bars.length < 100
  )
    throw new Error('Unexpected research data');
  const bars = market.bars.filter((b) => b.complete !== false),
    boundary = Math.floor(bars.length * 0.7);
  datasets.push({
    ticker,
    interval: market.interval,
    source: market.source,
    adjusted: market.adjusted,
    fetchedAt: market.fetchedAt,
    bars: bars.length,
    first: bars[0].time,
    last: bars.at(-1)!.time,
    sha256: createHash('sha256').update(JSON.stringify(bars)).digest('hex'),
  });
  for (const [sample, start, end] of [
    ['First 70%', 1, boundary],
    ['Later 30%', boundary, bars.length],
  ] as const) {
    for (const cost of [5, 10]) {
      const s = structuredClone(strategy);
      s.config.commissionBps = cost;
      s.config.slippageBps = cost;
      const r = runStrategy(s, bars, start, end);
      results.push({
        ticker,
        sample,
        costBps: cost,
        bars: end - start,
        from: bars[start].time,
        to: bars[end - 1].time,
        pnl: r.metrics.totalPnl,
        drawdownPct: r.metrics.maxDrawdown,
        sharpe: r.performance.sharpe,
        trades: r.trades.length,
        rejected: r.account.orders.filter((o) => o.status === 'rejected')
          .length,
        conflicts: r.conflicts,
      });
    }
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  strategy,
  method:
    'Fixed defaults, no parameter tuning. Recent one-month adjusted 5m Yahoo snapshots. Fresh $100,000 capital for each ticker/sample/cost scenario; 0.5% risk per trade with buying-power cap. First 70% / later 30% chronological split, prior bars for warmup only. 5 or 10 bps EACH of commission and slippage on EACH side. End-of-evaluation liquidation. Daily Sharpe, zero risk-free rate; bar-close drawdown. Too short for evidence of durable profitability; later sample is not an independent future test. OHLCV profile approximations, no true bid/ask flow. Same-bar protective-order conflicts use the engine conservative policy.',
  datasets,
  results,
};
await writeFile(
  'src/data/profile-strategy-research.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(results, null, 2));

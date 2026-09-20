/** Run with npm run research:strategies. Fetches only 3 requests, sequentially through Replay's provider gate. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { STRATEGY_TEMPLATES } from '../src/lib/strategyTemplates';
import { runStrategy, emptyRule } from '../src/lib/strategy';
const cache = process.env.RESEARCH_CACHE ?? '/tmp/replay-strategy-research';
const base = process.env.RESEARCH_API_URL ?? 'http://localhost:8080';
await mkdir(cache, { recursive: true });
const datasets = [],
  results = [];
for (const ticker of ['SPY', 'QQQ', 'GLD']) {
  const path = `${cache}/${ticker}.json`;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    const response = await fetch(
      `${base}/api/market-data?ticker=${ticker}&interval=1d&start=2015-01-01&end=2026-01-01`,
    );
    if (!response.ok)
      throw new Error(
        `${ticker}: HTTP ${response.status}; rerun after provider cooldown`,
      );
    raw = await response.text();
    await writeFile(path, raw);
  }
  const data = JSON.parse(raw),
    bars = data.bars;
  if (
    !bars?.length ||
    data.source !== 'yfinance' ||
    data.interval !== '1d' ||
    data.ticker !== ticker ||
    !data.adjusted
  )
    throw new Error(`Unexpected dataset ${ticker}`);
  datasets.push({
    ticker,
    source: data.source,
    adjusted: data.adjusted,
    fetchedAt: data.fetchedAt,
    bars: bars.length,
    sha256: createHash('sha256').update(JSON.stringify(bars)).digest('hex'),
    first: bars[0].time,
    last: bars.at(-1).time,
  });
  for (const [window, from, to] of [
    ['Development', '2016-01-01', '2021-01-01'],
    ['Later sample', '2021-01-01', '2026-01-01'],
  ]) {
    const start = bars.findIndex(
      (b: { time: number }) => b.time >= Date.parse(from) / 1000,
    );
    const endIndex = bars.findIndex(
      (b: { time: number }) => b.time >= Date.parse(to) / 1000,
    );
    const end = endIndex < 0 ? bars.length : endIndex;
    if (start < 200 || end - start < 1000)
      throw new Error(`Incomplete evaluation window: ${ticker} ${window}`);
    const benchmark = structuredClone(STRATEGY_TEMPLATES[0].strategy);
    benchmark.name = 'Buy and hold (95%)';
    benchmark.longEntry = {
      join: 'and',
      conditions: [
        {
          left: { kind: 'constant', value: 1 },
          op: 'gt',
          right: { kind: 'constant', value: 0 },
        },
      ],
    };
    benchmark.longExit = emptyRule();
    for (const item of [
      ...STRATEGY_TEMPLATES,
      { id: 'buy-hold', name: benchmark.name, strategy: benchmark },
    ]) {
      const result = runStrategy(item.strategy, bars, start, end);
      const rejected = result.account.orders.filter(
        (o) => o.status === 'rejected',
      );
      if (rejected.length)
        throw new Error(
          `Rejected orders in ${ticker}/${item.id}: ${JSON.stringify(rejected[0])}`,
        );
      results.push({
        ticker,
        window,
        from,
        to,
        id: item.id,
        name: item.name,
        pnl: result.metrics.totalPnl,
        returnPct: result.metrics.totalPnl / 1000,
        maxDrawdownPct: result.metrics.maxDrawdown,
        sharpe: result.performance.sharpe,
        trades: result.trades.length,
      });
    }
    console.log(`${ticker} ${window}: 24 strategies + benchmark complete`);
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  engineVersion: '3',
  strategies: STRATEGY_TEMPLATES.map((t) => ({
    id: t.id,
    strategy: t.strategy,
    sources: t.sources,
    adaptation: t.adaptation,
  })),
  method:
    'Fixed parameters, long-only, 95% of current equity per entry; $100,000 fresh capital per ticker/window; 5 bps commission + 5 bps slippage each side; adjusted daily yfinance OHLCV; prior data used only for indicator warmup; signal at close, execution next open; final position liquidated at final close. No stops/targets, leverage, cash interest or parameter search. Buy-and-hold uses the same sizing and costs. Later sample is a chronological check, not truly unseen: source ideas were published after portions of this history. No profitability guarantee; all results retained.',
  sharpe:
    'UTC daily equity simple returns including idle cash; sample standard deviation; zero risk-free rate; sqrt(252) annualization. Null means insufficient observations or zero variance. Drawdown uses bar-close equity, not intrabar worst-case.',
  datasets,
  results,
};
await mkdir('src/data', { recursive: true });
await writeFile(
  'src/data/strategy-research.json',
  JSON.stringify(report, null, 2) + '\n',
);
await writeFile(
  'docs/strategy-research.csv',
  'ticker,window,from,to,id,name,pnl,returnPct,maxDrawdownPct,sharpe,trades\n' +
    results
      .map((r) =>
        Object.values(r)
          .map((v) => (v === null ? '' : v))
          .join(','),
      )
      .join('\n') +
    '\n',
);
console.log(`Saved ${results.length} results. No historical OHLCV committed.`);

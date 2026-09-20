import { useState } from 'react';
import { STRATEGY_SOURCES, STRATEGY_TEMPLATES } from '../lib/strategyTemplates';
import type { Strategy } from '../lib/strategy';
import report from '../data/strategy-research.json';

export default function StrategyCatalog({
  onChoose,
}: {
  onChoose: (s: Strategy) => void;
}) {
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('All'),
    [selected, setSelected] = useState('sma'),
    [ticker, setTicker] = useState('SPY'),
    [window, setWindow] = useState('Later sample');
  const visible = STRATEGY_TEMPLATES.filter(
    (t) =>
      (category === 'All' || t.category === category) &&
      `${t.name} ${t.entry} ${t.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const current = STRATEGY_TEMPLATES.find((t) => t.id === selected)!;
  const rows = report.results.filter(
    (r) => r.ticker === ticker && r.window === window,
  );
  const choose = (id: string) => {
    const t = STRATEGY_TEMPLATES.find((t) => t.id === id)!;
    setSelected(id);
    onChoose(structuredClone(t.strategy));
  };
  return (
    <div className="strategy-catalog">
      <p>
        24 researched templates. Start with a trading idea, read its rules, then
        test it on your loaded chart. Reddit discussions are research leads;
        profitability is not established.
      </p>
      <div className="hub-fields">
        <label>
          Find a strategy
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Try RSI, breakout or volume"
          />
        </label>
        <label>
          Strategy category
          <select
            aria-label="Strategy category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {[
              'All',
              'Trend',
              'Breakout',
              'Mean reversion',
              'Momentum',
              'Volume',
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <p role="status">{visible.length} templates match</p>
      <div className="strategy-template-list" aria-label="Strategy templates">
        {visible.map((t) => (
          <button
            key={t.id}
            aria-pressed={selected === t.id}
            onClick={() => choose(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {!visible.length && (
        <p>No matches. Clear your search or choose All categories.</p>
      )}
      <article
        className="strategy-template-guide"
        aria-label="Selected template explanation"
      >
        <h4>
          {current.name} · {current.category}
        </h4>
        <p>
          <strong>Buy when:</strong> {current.entry}
        </p>
        <p>
          <strong>Sell when:</strong> {current.exit}
        </p>
        <p>
          <strong>Source and adaptation:</strong> {current.adaptation}
        </p>
        <p>
          {current.sources.map((key) => (
            <a
              key={key}
              href={STRATEGY_SOURCES[key].url}
              target="_blank"
              rel="noreferrer"
            >
              r/algotrading: {STRATEGY_SOURCES[key].title}
            </a>
          ))}
        </p>
        <p>
          Template defaults: long only, 95% equity per entry, 5 bps commission
          and 5 bps slippage each side, no stop or target. Change these under
          Position size & costs. This explanation describes the original
          template; your edited rules are shown in step 2.
        </p>
      </article>
      <details className="hub-disclosure">
        <summary>Historical quick tests · P&amp;L, drawdown & Sharpe</summary>
        <p>
          Reference study, separate from your loaded chart. Every template was
          tested on SPY, QQQ and GLD over 2016–2020 and 2021–2025. Results
          include losing strategies.
        </p>
        <div className="hub-fields">
          <label>
            Research ticker
            <select
              aria-label="Research ticker"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
            >
              {['SPY', 'QQQ', 'GLD'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Research period
            <select
              aria-label="Research period"
              value={window}
              onChange={(e) => setWindow(e.target.value)}
            >
              <option value="Later sample">2021–2025 · later sample</option>
              <option value="Development">2016–2020 · development</option>
            </select>
          </label>
        </div>
        <div
          className="hub-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Historical strategy comparison"
        >
          <table>
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Net P&amp;L ($)</th>
                <th>Return %</th>
                <th>Max DD %</th>
                <th>Sharpe</th>
                <th>Trades</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.name}</th>
                  <td>{r.pnl.toFixed(2)}</td>
                  <td>{r.returnPct.toFixed(2)}</td>
                  <td>{r.maxDrawdownPct.toFixed(2)}</td>
                  <td>{r.sharpe?.toFixed(2) ?? 'N/A'}</td>
                  <td>{r.trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary>How to interpret these tests</summary>
          <p>{report.method}</p>
          <p>{report.sharpe}</p>
          <p>
            Generated {report.generatedAt.slice(0, 10)}. Comparing many
            strategies creates selection bias. ETFs were chosen in advance for
            this study, but are not a survivorship-free universe. Adjusted
            prices approximate distributions; taxes, liquidity impact and cash
            yield are excluded.
          </p>
        </details>
      </details>
    </div>
  );
}

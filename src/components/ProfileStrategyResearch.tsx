import report from '../data/profile-strategy-research.json';
export default function ProfileStrategyResearch() {
  return (
    <details className="hub-disclosure">
      <summary>Volume profile research · experimental results</summary>
      <p>
        No demonstrated edge: this short sample produced very few trades. Do not
        interpret a large annualized Sharpe from one trade as reliable evidence.
        Defaults were fixed before these tests; no tuning was performed.
      </p>
      <p>{report.method}</p>
      <p>
        Fetched{' '}
        {report.datasets
          .map(
            (d) =>
              `${d.ticker}: ${new Date(d.first * 1000).toISOString().slice(0, 10)} to ${new Date(d.last * 1000).toISOString().slice(0, 10)} (${d.bars} bars)`,
          )
          .join('; ')}
        .
      </p>
      <div
        className="hub-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Volume profile research results"
      >
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Sample</th>
              <th>Each cost (bps)</th>
              <th>Trades</th>
              <th>P&amp;L ($)</th>
              <th>Max DD (%)</th>
              <th>Sharpe</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((r) => (
              <tr key={`${r.ticker}-${r.sample}-${r.costBps}`}>
                <td>{r.ticker}</td>
                <td>{r.sample}</td>
                <td>{r.costBps}</td>
                <td>{r.trades}</td>
                <td>{r.pnl.toFixed(2)}</td>
                <td>{r.drawdownPct.toFixed(2)}</td>
                <td>{r.sharpe === null ? 'N/A' : r.sharpe.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Low trade counts make these results inconclusive. A later chronological
        slice is not proof of out-of-sample profitability. Longer histories,
        other markets, realistic spreads, and forward paper testing are needed.
      </p>
    </details>
  );
}

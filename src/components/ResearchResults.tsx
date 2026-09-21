import { useState } from 'react';
import EquityChart from './EquityChart';
import { exportCsv } from '../lib/data';
export default function ResearchResults({
  output,
  parameters,
}: {
  output: any;
  parameters: { path: string; values: number[] }[];
}) {
  const [fold, setFold] = useState(0);
  const candidates =
    output.folds?.[Math.min(fold, output.folds.length - 1)]?.candidates ??
    output.candidates ??
    [];
  const read = (obj: any, path: string) =>
    path.split('.').reduce((v, k) => v?.[k], obj);
  const x = parameters[0],
    y = parameters[1];
  const rows = y?.values ?? [0];
  const scale = Math.max(
    1,
    ...candidates.map((c: any) => Math.abs(c.training.metrics.totalPnl)),
  );
  const mc = output.monteCarlo;
  return (
    <section aria-label="Strategy robustness results">
      {output.researchKind === 'walk-forward' && (
        <>
          <h4>Walk-forward results</h4>
          <p>{output.selection}</p>
          <p>
            Out-of-sample net P&L {output.totalPnl.toFixed(2)} · Max drawdown{' '}
            {output.maxDrawdown.toFixed(2)}% · Sharpe{' '}
            {output.performance.sharpe?.toFixed(2) ?? 'N/A'}
          </p>
          <EquityChart
            points={output.equity}
            initialCapital={output.folds[0].winner.config.initialCapital}
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fold</th>
                  <th>Test start (UTC)</th>
                  <th>Test end (UTC)</th>
                  <th>Net P&L</th>
                  <th>Max DD %</th>
                  <th>Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {output.folds.map((f: any) => (
                  <tr key={f.fold}>
                    <td>{f.fold}</td>
                    <td>
                      {new Date(f.testStart * 1000).toISOString().slice(0, 16)}
                    </td>
                    <td>
                      {new Date(f.testEnd * 1000).toISOString().slice(0, 16)}
                    </td>
                    <td>{f.metrics.totalPnl.toFixed(2)}</td>
                    <td>{f.metrics.maxDrawdown.toFixed(2)}</td>
                    <td>{f.performance.sharpe?.toFixed(2) ?? 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() =>
              exportCsv(
                [
                  [
                    'Fold',
                    'Test start',
                    'Test end',
                    'Net P&L',
                    'Max DD %',
                    'Sharpe',
                  ],
                  ...output.folds.map((f: any) => [
                    f.fold,
                    f.testStart,
                    f.testEnd,
                    f.metrics.totalPnl,
                    f.metrics.maxDrawdown,
                    f.performance.sharpe ?? '',
                  ]),
                ],
                'walk-forward.csv',
              )
            }
          >
            Export walk-forward results
          </button>
        </>
      )}
      {x && candidates.length > 0 && (
        <>
          <h4>Parameter stability heatmap</h4>
          {output.folds && (
            <label>
              Training fold
              <select
                aria-label="Training fold"
                value={fold}
                onChange={(e) => setFold(Number(e.target.value))}
              >
                {output.folds.map((f: any, i: number) => (
                  <option key={i} value={i}>
                    Fold {f.fold}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p>
            Training net P&L only. Columns: {x.path}; rows:{' '}
            {y?.path ?? 'one-dimensional sweep'}. Additional parameter
            dimensions are averaged within each cell. Green is positive and red
            is negative; darker color means larger magnitude. This is not an
            out-of-sample score.
          </p>
          <div className="table-scroll">
            <table aria-label="Parameter stability heatmap">
              <thead>
                <tr>
                  <th>{y?.path ?? 'Training P&L'}</th>
                  {x.values.map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row}>
                    <th>{y ? row : 'P&L'}</th>
                    {x.values.map((col) => {
                      const group = candidates.filter(
                        (c: any) =>
                          read(c.strategy, x.path) === col &&
                          (!y || read(c.strategy, y.path) === row),
                      );
                      const mean =
                        group.reduce(
                          (sum: number, c: any) =>
                            sum + c.training.metrics.totalPnl,
                          0,
                        ) / (group.length || 1);
                      return (
                        <td
                          key={col}
                          style={{
                            background:
                              mean >= 0
                                ? `rgba(32,170,115,${0.1 + (0.6 * Math.abs(mean)) / scale})`
                                : `rgba(220,65,85,${0.1 + (0.6 * Math.abs(mean)) / scale})`,
                          }}
                        >
                          {group.length ? mean.toFixed(2) : 'N/A'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {mc && (
        <>
          <h4>Monte Carlo trade bootstrap</h4>
          <p>
            {mc.simulations} simulations · seed {mc.seed} · {mc.trades} closed
            trades. Samples net trade P&L with replacement using fixed stakes.
            Assumes independent trades; it does not model changing market
            regimes, serial correlation or future profitability.
          </p>
          {mc.percentiles ? (
            <>
              <p>
                Simulated loss probability:{' '}
                {(mc.lossProbability * 100).toFixed(1)}%
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Percentile</th>
                    <th>Net P&L</th>
                    <th>Max drawdown %</th>
                  </tr>
                </thead>
                <tbody>
                  {mc.percentiles.map((p: any) => (
                    <tr key={p.percentile}>
                      <td>{p.percentile}%</td>
                      <td>{p.pnl.toFixed(2)}</td>
                      <td>{p.drawdown.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p>No closed trades to resample.</p>
          )}
        </>
      )}
    </section>
  );
}

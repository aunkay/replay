import { useEffect, useState } from 'react';
import { api } from '../lib/server';
import EquityChart from './EquityChart';
import { createDemo, exportCsv } from '../lib/data';
import { INDICATORS, computeIndicator } from '../lib/indicators';
import { type Operand, type Rule, type Strategy } from '../lib/strategy';
import StrategyCatalog from './StrategyCatalog';
import { STRATEGY_TEMPLATES } from '../lib/strategyTemplates';
import type { Candle } from '../lib/engine';
const previewBars = createDemo().bars;
function OperandEditor({
  value,
  onChange,
}: {
  value: Operand;
  onChange: (v: Operand) => void;
}) {
  return (
    <div className="rule-operand">
      <select
        aria-label="Operand type"
        value={value.kind}
        onChange={(e) =>
          onChange(
            e.target.value === 'constant'
              ? { kind: 'constant', value: 50 }
              : e.target.value === 'price'
                ? { kind: 'price', field: 'close' }
                : { kind: 'indicator', indicator: 'sma', period: 20 },
          )
        }
      >
        <option value="price">Price / volume</option>
        <option value="indicator">Indicator</option>
        <option value="constant">Number</option>
      </select>
      {value.kind === 'constant' ? (
        <input
          aria-label="Constant"
          type="number"
          value={value.value}
          onChange={(e) =>
            onChange({ ...value, value: Number(e.target.value) })
          }
        />
      ) : value.kind === 'price' ? (
        <select
          aria-label="Price field"
          value={value.field}
          onChange={(e) =>
            onChange({ ...value, field: e.target.value as 'close' })
          }
        >
          {['open', 'high', 'low', 'close', 'volume'].map((v) => (
            <option key={v} value={v}>
              {{
                stopPct: 'Stop-loss (%)',
                targetPct: 'Take-profit (%)',
                quantity: 'Fixed quantity',
                allocationPct: 'Equity allocation (%)',
                'longEntry.conditions.0.left.period':
                  'Long entry: first indicator period',
                'longEntry.conditions.0.right.period':
                  'Long entry: comparison indicator period',
              }[v] ?? v}
            </option>
          ))}
        </select>
      ) : (
        <>
          <select
            aria-label="Rule indicator"
            value={value.indicator}
            onChange={(e) =>
              onChange({
                ...value,
                indicator: e.target.value as typeof value.indicator,
              })
            }
          >
            {INDICATORS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Rule period"
            type="number"
            min="1"
            max="500"
            value={value.period}
            onChange={(e) =>
              onChange({ ...value, period: Number(e.target.value) })
            }
          />
          <select
            aria-label="Indicator output"
            value={value.plot ?? ''}
            onChange={(e) =>
              onChange({ ...value, plot: e.target.value || undefined })
            }
          >
            <option value="">First output</option>
            {computeIndicator(
              {
                id: 'preview',
                indicatorId: value.indicator,
                period: value.period,
                color: '#fff',
              },
              previewBars,
            ).map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </>
      )}
      <label>
        Bars ago
        <input
          type="number"
          min="0"
          max="500"
          value={value.offset ?? 0}
          onChange={(e) =>
            onChange({ ...value, offset: Number(e.target.value) })
          }
        />
      </label>
    </div>
  );
}
function RuleEditor({
  name,
  value,
  onChange,
}: {
  name: string;
  value: Rule;
  onChange: (v: Rule) => void;
}) {
  return (
    <fieldset>
      <legend>{name}</legend>
      <select
        aria-label={`${name} matching`}
        value={value.join}
        onChange={(e) =>
          onChange({ ...value, join: e.target.value as 'and' | 'or' })
        }
      >
        <option value="and">All conditions (AND)</option>
        <option value="or">Any condition (OR)</option>
      </select>
      {value.conditions.map((c, i) => (
        <div className="strategy-condition" key={i}>
          <OperandEditor
            value={c.left}
            onChange={(left) =>
              onChange({
                ...value,
                conditions: value.conditions.map((v, j) =>
                  j === i ? { ...v, left } : v,
                ),
              })
            }
          />
          <select
            aria-label="Condition operator"
            value={c.op}
            onChange={(e) =>
              onChange({
                ...value,
                conditions: value.conditions.map((v, j) =>
                  j === i ? { ...v, op: e.target.value as typeof c.op } : v,
                ),
              })
            }
          >
            <option value="gt">Above</option>
            <option value="lt">Below</option>
            <option value="crossUp">Crosses above</option>
            <option value="crossDown">Crosses below</option>
          </select>
          <OperandEditor
            value={c.right}
            onChange={(right) =>
              onChange({
                ...value,
                conditions: value.conditions.map((v, j) =>
                  j === i ? { ...v, right } : v,
                ),
              })
            }
          />
          <button
            onClick={() =>
              onChange({
                ...value,
                conditions: value.conditions.filter((_, j) => j !== i),
              })
            }
          >
            Remove condition
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange({
            ...value,
            conditions: [
              ...value.conditions,
              {
                left: { kind: 'price', field: 'close' },
                op: 'gt',
                right: { kind: 'indicator', indicator: 'sma', period: 20 },
              },
            ],
          })
        }
      >
        Add condition
      </button>
    </fieldset>
  );
}
export default function StrategyBuilder({ bars }: { bars: Candle[] }) {
  const [strategy, setStrategy] = useState<Strategy>(() =>
      structuredClone(STRATEGY_TEMPLATES[0].strategy),
    ),
    [saved, setSaved] = useState<any[]>([]),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState(''),
    [result, setResult] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]);
  const [optimize, setOptimize] = useState(false),
    [path, setPath] = useState('allocationPct'),
    [minimum, setMinimum] = useState(1),
    [maximum, setMaximum] = useState(5),
    [step, setStep] = useState(1),
    [split, setSplit] = useState(70),
    [additional, setAdditional] = useState<
      { path: string; minimum: number; maximum: number; step: number }[]
    >([]),
    [comparison, setComparison] = useState<any[]>([]),
    [selectedRuns, setSelectedRuns] = useState<string[]>([]);
  const load = () =>
    Promise.all([
      api<any[]>('/strategies').then(setSaved),
      api<any[]>('/strategy-runs').then(setHistory),
    ]).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!job) return;
    const timer = setInterval(
      () =>
        api(`/strategy-runs/${job}`)
          .then((r) => {
            setResult(r);
            if (!['queued', 'running'].includes(r.status)) {
              setJob('');
              void load();
            }
          })
          .catch((e) => {
            setError(e.message);
            setJob('');
          }),
      1000,
    );
    return () => clearInterval(timer);
  }, [job]);
  async function run() {
    setBusy(true);
    setFeedback('');
    try {
      setError('');
      const grids = optimize
        ? [{ path, minimum, maximum, step }, ...additional]
        : [];
      const parameters = grids.map((grid) => {
        if (grid.step <= 0 || grid.minimum <= 0 || grid.maximum < grid.minimum)
          throw new Error('Enter positive parameter ranges and steps');
        const values: number[] = [];
        for (let v = grid.minimum; v <= grid.maximum + 1e-9; v += grid.step) {
          if (values.length >= 500) throw new Error('Maximum 500 combinations');
          values.push(v);
        }
        return { path: grid.path, values };
      });
      if (parameters.reduce((n, p) => n * p.values.length, 1) > 500)
        throw new Error('Maximum 500 combined parameter combinations');
      const r = await api('/strategy-runs', {
        strategy,
        bars,
        parameters,
        split: split / 100,
      });
      setJob(r.id);
      setResult({ status: r.status });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveStrategy() {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await api('/strategies', { strategy });
      await load();
      setFeedback(
        'Strategy saved. You can load it from the starting-point menu.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const output = result?.result;
  const summary = output?.test ?? output;
  return (
    <section className="strategy-builder">
      <h3>Visual strategy testing</h3>
      <p>
        Signals at candle close; fills at the next open. One position, no
        pyramiding. Results use the loaded historical snapshot.
      </p>
      <details className="hub-disclosure" open>
        <summary>1. Choose a starting point</summary>
        <p>
          Use a template, or load a strategy you saved earlier. Templates
          replace the current rules.
        </p>
        <StrategyCatalog
          onChoose={(s) => {
            setStrategy(s);
            setPath('allocationPct');
          }}
        />
        <label>
          Strategy name
          <input
            value={strategy.name}
            onChange={(e) => setStrategy({ ...strategy, name: e.target.value })}
          />
        </label>
        <select
          aria-label="Saved strategy"
          defaultValue=""
          onChange={(e) => {
            const s = saved.find((s) => s.id === e.target.value);
            if (s) setStrategy(s.strategy);
          }}
        >
          <option value="">Load saved strategy</option>
          {saved.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </details>
      <details className="hub-disclosure">
        <summary>2. Entry & exit rules</summary>
        <p>
          Choose when to enter and exit. Empty rules do not generate a signal.
        </p>
        {(['longEntry', 'shortEntry', 'longExit', 'shortExit'] as const).map(
          (key) => (
            <RuleEditor
              key={key}
              name={key.replace(/([A-Z])/g, ' $1')}
              value={strategy[key]}
              onChange={(v) => setStrategy({ ...strategy, [key]: v })}
            />
          ),
        )}
      </details>
      <details className="hub-disclosure">
        <summary>3. Position size & costs</summary>
        <p>
          Choose equity allocation OR risk sizing (which needs a stop-loss).
          Leave both blank to use fixed quantity. Fees and slippage are in basis
          points: 10 bps = 0.1%.
        </p>
        <label>
          Sharpe trading calendar
          <select
            aria-label="Sharpe trading calendar"
            value={strategy.tradingDaysPerYear ?? 252}
            onChange={(e) =>
              setStrategy({
                ...strategy,
                tradingDaysPerYear: Number(e.target.value),
              })
            }
          >
            <option value={252}>Exchange markets · 252 days/year</option>
            <option value={365}>Crypto / every day · 365 days/year</option>
          </select>
        </label>
        <p>
          Sharpe uses UTC daily equity marks, or native weekly/monthly marks for
          coarse data. Less than two returns or zero variance shows N/A.
        </p>
        <div className="hub-fields">
          {(
            [
              'quantity',
              'allocationPct',
              'riskPct',
              'stopPct',
              'targetPct',
            ] as const
          ).map((key) => (
            <label key={key}>
              {
                {
                  quantity: 'Fixed quantity',
                  allocationPct: 'Equity allocation (%)',
                  riskPct: 'Equity risk (%)',
                  stopPct: 'Stop-loss (%)',
                  targetPct: 'Take-profit (%)',
                  initialCapital: 'Starting capital',
                  commissionBps: 'Commission (bps)',
                  slippageBps: 'Slippage (bps)',
                }[key]
              }
              <input
                type="number"
                min="0"
                step="any"
                value={strategy[key] ?? ''}
                onChange={(e) =>
                  setStrategy({
                    ...strategy,
                    [key]: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </label>
          ))}
          {(['initialCapital', 'commissionBps', 'slippageBps'] as const).map(
            (key) => (
              <label key={key}>
                {
                  {
                    quantity: 'Fixed quantity',
                    allocationPct: 'Equity allocation (%)',
                    riskPct: 'Equity risk (%)',
                    stopPct: 'Stop-loss (%)',
                    targetPct: 'Take-profit (%)',
                    initialCapital: 'Starting capital',
                    commissionBps: 'Commission (bps)',
                    slippageBps: 'Slippage (bps)',
                  }[key]
                }
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={strategy.config[key]}
                  onChange={(e) =>
                    setStrategy({
                      ...strategy,
                      config: {
                        ...strategy.config,
                        [key]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ),
          )}
        </div>
      </details>
      <details className="hub-disclosure">
        <summary>4. Parameter search (optional)</summary>
        <p>
          Compare settings using training data, then evaluate the winner on
          separate test data.
        </p>
        <label>
          <input
            type="checkbox"
            checked={optimize}
            onChange={(e) => setOptimize(e.target.checked)}
          />{' '}
          Parameter search with held-out test data
        </label>
        {optimize && (
          <div className="hub-fields">
            <label>
              Parameter
              <select value={path} onChange={(e) => setPath(e.target.value)}>
                {[
                  'allocationPct',
                  'stopPct',
                  'targetPct',
                  'quantity',
                  'longEntry.conditions.0.left.period',
                  'longEntry.conditions.0.right.period',
                ].map((v) => (
                  <option key={v} value={v}>
                    {{
                      stopPct: 'Stop-loss (%)',
                      targetPct: 'Take-profit (%)',
                      quantity: 'Fixed quantity',
                      allocationPct: 'Equity allocation (%)',
                      'longEntry.conditions.0.left.period':
                        'Long entry: first indicator period',
                      'longEntry.conditions.0.right.period':
                        'Long entry: comparison indicator period',
                    }[v] ?? v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Minimum
              <input
                type="number"
                value={minimum}
                onChange={(e) => setMinimum(Number(e.target.value))}
              />
            </label>
            <label>
              Maximum
              <input
                type="number"
                value={maximum}
                onChange={(e) => setMaximum(Number(e.target.value))}
              />
            </label>
            <label>
              Step
              <input
                type="number"
                value={step}
                onChange={(e) => setStep(Number(e.target.value))}
              />
            </label>
            {additional.map((grid, index) => (
              <fieldset key={index}>
                <legend>Additional parameter {index + 1}</legend>
                {(['path', 'minimum', 'maximum', 'step'] as const).map(
                  (key) => (
                    <label key={key}>
                      {key}
                      <input
                        type={key === 'path' ? 'text' : 'number'}
                        value={grid[key]}
                        onChange={(e) =>
                          setAdditional((previous) =>
                            previous.map((g, i) =>
                              i === index
                                ? {
                                    ...g,
                                    [key]:
                                      key === 'path'
                                        ? e.target.value
                                        : Number(e.target.value),
                                  }
                                : g,
                            ),
                          )
                        }
                      />
                    </label>
                  ),
                )}
                <button
                  onClick={() =>
                    setAdditional((previous) =>
                      previous.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove parameter
                </button>
              </fieldset>
            ))}
            <button
              onClick={() =>
                setAdditional((previous) => [
                  ...previous,
                  { path: 'targetPct', minimum: 2, maximum: 6, step: 2 },
                ])
              }
            >
              Add parameter range
            </button>
            <label>
              Training %
              <input
                type="number"
                min="50"
                max="90"
                value={split}
                onChange={(e) => setSplit(Number(e.target.value))}
              />
            </label>
            <p>
              {[{ minimum, maximum, step }, ...additional].reduce(
                (count, g) =>
                  count *
                  Math.max(0, Math.floor((g.maximum - g.minimum) / g.step) + 1),
                1,
              )}{' '}
              combinations × {bars.length} candles. Ranking uses training net
              profit only.
            </p>
          </div>
        )}
      </details>
      <div className="hub-actions strategy-run-actions">
        <button disabled={busy} onClick={saveStrategy}>
          Save strategy
        </button>
        <button className="hub-primary" disabled={!!job || busy} onClick={run}>
          Run backtest
        </button>
        {job && (
          <button
            onClick={() =>
              api(`/strategy-runs/${job}`, undefined, 'DELETE')
                .then((r) => {
                  setResult(r);
                  setJob('');
                  void load();
                })
                .catch((e) => setError(e.message))
            }
          >
            Cancel run
          </button>
        )}
      </div>
      {feedback && (
        <p className="hub-feedback success" role="status">
          {feedback}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          Run: {result.status} {result.error}{' '}
          {result.progress
            ? ` · ${result.progress.completed}/${result.progress.total}`
            : null}
        </p>
      )}
      {summary?.metrics && (
        <>
          <h4>{output?.test ? 'Held-out test results' : 'Backtest results'}</h4>
          <p>
            Net P&L {summary.metrics.totalPnl.toFixed(2)} · Drawdown{' '}
            {summary.metrics.maxDrawdown.toFixed(2)}% · Sharpe{' '}
            {summary.performance?.sharpe?.toFixed(2) ?? 'N/A'} · Trades{' '}
            {summary.trades.length} · Conflicting signals {summary.conflicts}
          </p>
          <p>
            {summary.performance
              ? `Sharpe: ${summary.performance.sampling}, ${summary.performance.periodsPerYear} periods/year, ${summary.performance.observations} returns, 0% risk-free rate.`
              : 'Sharpe unavailable for older saved runs. Run again to calculate it.'}
          </p>
          <EquityChart
            points={summary.account.equityHistory}
            initialCapital={summary.account.config.initialCapital}
          />
          <button
            onClick={() =>
              exportCsv(
                [
                  [
                    'Trade',
                    'Direction',
                    'Opened',
                    'Closed',
                    'Net P&L',
                    'Fees',
                    'R',
                  ],
                  ...summary.trades.map((t: any) => [
                    t.id,
                    t.direction,
                    t.openedAt,
                    t.closedAt,
                    t.pnl,
                    t.fees,
                    t.r ?? '',
                  ]),
                ],
                'strategy-trades.csv',
              )
            }
          >
            Export strategy trades CSV
          </button>
          {output?.candidates && (
            <div
              className="hub-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Strategy results table"
            >
              <table>
                <thead>
                  <tr>
                    <th>Training rank</th>
                    <th>Net P&amp;L</th>
                    <th>Drawdown %</th>
                    <th>Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {output.candidates.map((c: any, i: number) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{c.training.metrics.totalPnl.toFixed(2)}</td>
                      <td>{c.training.metrics.maxDrawdown.toFixed(2)}</td>
                      <td>
                        {c.training.performance?.sharpe?.toFixed(2) ?? 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details>
            <summary>Trades and parameter results</summary>
            <pre>{JSON.stringify(output, null, 2)}</pre>
          </details>
        </>
      )}
      <details className="hub-disclosure">
        <summary>Saved runs & comparison ({history.length})</summary>
        <p>
          Select two to four runs to compare. Open a previous run to review its
          results.
        </p>
        <button
          disabled={selectedRuns.length < 2}
          onClick={() =>
            Promise.all(
              selectedRuns.map((id) =>
                api(`/strategy-runs/${id}`).then((result) => ({
                  id,
                  ...result,
                })),
              ),
            )
              .then(setComparison)
              .catch((e) => setError(e.message))
          }
        >
          Compare selected runs
        </button>
        {comparison.length > 0 && (
          <div
            className="hub-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Strategy results table"
          >
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Net P&amp;L</th>
                  <th>Drawdown %</th>
                  <th>Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => {
                  const metrics = (r.result?.test ?? r.result)?.metrics;
                  return (
                    <tr key={r.id}>
                      <td>{r.id.slice(0, 8)}</td>
                      <td>{metrics?.totalPnl.toFixed(2) ?? r.status}</td>
                      <td>{metrics?.maxDrawdown.toFixed(2) ?? '—'}</td>
                      <td>
                        {(
                          r.result?.test ?? r.result
                        )?.performance?.sharpe?.toFixed(2) ?? 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {history.map((r) => (
          <div key={r.id}>
            <input
              aria-label={`Select run ${r.id}`}
              type="checkbox"
              checked={selectedRuns.includes(r.id)}
              onChange={(e) =>
                setSelectedRuns((previous) =>
                  e.target.checked
                    ? [...previous, r.id].slice(-4)
                    : previous.filter((id) => id !== r.id),
                )
              }
            />
            <button
              key={r.id}
              onClick={() =>
                api(`/strategy-runs/${r.id}`)
                  .then(setResult)
                  .catch((e) => setError(e.message))
              }
            >
              {new Date(r.updated * 1000).toLocaleString()} · {r.status}
            </button>
          </div>
        ))}
      </details>
    </section>
  );
}

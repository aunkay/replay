import { useState } from 'react';
import { api } from '../lib/server';
import { INTERVALS, type MarketData } from '../lib/data';
type Entry = {
  id: string;
  name: string;
  ticker: string;
  interval: string;
  count: number;
  gapCount: number;
  source: string;
};
type Dataset = {
  id: string;
  name: string;
  market: MarketData;
  gaps: { after: number; before: number; missingSlots: number }[];
};
export default function DataLibrary({
  market,
  onLoad,
}: {
  market: MarketData;
  onLoad: (m: MarketData) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [name, setName] = useState(''),
    [ticker, setTicker] = useState(market.ticker),
    [interval, setInterval] = useState(market.interval),
    [currency, setCurrency] = useState(market.currency ?? 'USD'),
    [csv, setCsv] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [selected, setSelected] = useState<Dataset | null>(null);
  const load = async () => setEntries(await api<Entry[]>('/datasets'));
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="alerts-panel"
      onToggle={(e) => {
        if (e.currentTarget.open) void load().catch((e) => setError(e.message));
      }}
    >
      <summary>Data library & CSV import</summary>
      <section aria-label="Historical data library">
        <h3>Reusable historical datasets</h3>
        <p>
          Save the loaded candles or import your own history. Loading a dataset
          starts a fresh replay account; saved sessions remain available in the
          session library.
        </p>
        <label>
          Dataset name
          <input
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={busy || !name.trim()}
          onClick={() =>
            void act(async () => {
              await api('/datasets', { name, market });
              setMessage('Current dataset saved on server.');
            })
          }
        >
          Save current dataset
        </button>
        <fieldset>
          <legend>Import CSV</legend>
          <p>
            Columns: time (or date), open, high, low, close, volume. Use ISO
            timestamps or Unix seconds, ordered oldest first with no duplicates.
            Dates without a timezone use UTC. Prices are used as supplied.
          </p>
          <label>
            Import ticker
            <input
              value={ticker}
              maxLength={32}
              onChange={(e) => setTicker(e.target.value)}
            />
          </label>
          <label>
            Import interval
            <select
              aria-label="Import interval"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            >
              {INTERVALS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Import currency
            <input
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </label>
          <label>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 20 * 1024 * 1024) {
                  setError('CSV exceeds 20 MB');
                  return;
                }
                setCsv(await f.text());
              }}
            />
          </label>
          <label>
            CSV contents
            <textarea
              rows={5}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </label>
          <button
            className="button"
            disabled={busy || !csv || !name.trim()}
            onClick={() =>
              void act(async () => {
                const result = await api<Dataset>('/datasets/import', {
                  name,
                  ticker,
                  interval,
                  currency,
                  csv,
                });
                setSelected(result);
                setMessage(
                  'CSV imported and saved. Inspect it below, then load it for replay.',
                );
              })
            }
          >
            Import dataset
          </button>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <h4>Saved datasets</h4>
        {entries.map((d) => (
          <article key={d.id} aria-label={`Dataset ${d.name}`}>
            <strong>{d.name}</strong>
            <p>
              {d.ticker} · {d.interval} · {d.count} candles · {d.source} ·{' '}
              {d.gapCount} potential gaps
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void act(async () =>
                  setSelected(await api<Dataset>(`/datasets/${d.id}`)),
                )
              }
            >
              Inspect dataset
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await api<Dataset>(`/datasets/${d.id}`);
                  onLoad(result.market);
                  setMessage(`${d.name} loaded into a fresh replay account.`);
                })
              }
            >
              Load dataset
            </button>
            <button
              className="button ghost"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api(`/datasets/${d.id}`, undefined, 'DELETE');
                  if (selected?.id === d.id) setSelected(null);
                })
              }
            >
              Delete dataset
            </button>
          </article>
        ))}
        {selected && (
          <section aria-label="Dataset inspection">
            <h4>{selected.name}</h4>
            <p>
              {selected.market.bars.length} candles ·{' '}
              {selected.market.range.start} → {selected.market.range.end}
            </p>
            <p>
              Potential gaps are timestamp gaps, not proof of missing data:
              weekends, holidays and overnight closures may be expected. Monthly
              intervals are not scanned. Up to 200 gaps are shown.
            </p>
            <ul>
              {selected.gaps.map((g) => (
                <li key={g.after}>
                  {new Date(g.after * 1000).toISOString()} →{' '}
                  {new Date(g.before * 1000).toISOString()}: {g.missingSlots}{' '}
                  empty interval slots
                </li>
              ))}
            </ul>
            {!selected.gaps.length && <p>No fixed-interval gaps detected.</p>}
          </section>
        )}
      </section>
    </details>
  );
}

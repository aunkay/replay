import { useState } from 'react';
import type { StoredSession } from '../lib/session';
import { api } from '../lib/server';
import { fetchMarketData, type MarketData } from '../lib/data';
import { panelMarketRequest } from '../lib/panelMarket';
export default function FinerExecution({
  session,
  onChange,
}: {
  session: StoredSession;
  onChange: (market?: MarketData) => Promise<void>;
}) {
  const [entries, setEntries] = useState<
      { id: string; name: string; ticker: string; interval: string }[]
    >([]),
    [id, setId] = useState(''),
    [interval, setInterval] = useState('1m'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function apply(load: () => Promise<MarketData | undefined>) {
    setBusy(true);
    setError('');
    try {
      await onChange(await load());
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
        if (e.currentTarget.open)
          void api('/datasets')
            .then(setEntries)
            .catch((e) => setError(e.message));
      }}
    >
      <summary>Finer-candle execution</summary>
      <section aria-label="Finer execution settings">
        <p>
          Resolve stop/target ordering with smaller candles. Only windows
          matching the parent OHLC and volume are used; missing or incompatible
          windows retain conservative parent-candle execution. Data must use the
          same ticker, currency and adjustment.
        </p>
        <label>
          Execution interval
          <select
            aria-label="Execution interval"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          >
            {['1m', '2m', '5m', '15m', '30m', '60m'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void apply(() =>
              fetchMarketData(
                panelMarketRequest(
                  session.market,
                  session.market.ticker,
                  interval,
                ),
              ),
            )
          }
        >
          Fetch finer candles
        </button>
        <label>
          Execution dataset
          <select
            aria-label="Execution dataset"
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            <option value="">Choose saved finer data</option>
            {entries
              .filter((d) => d.ticker === session.market.ticker)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.interval}
                </option>
              ))}
          </select>
        </label>
        <button
          className="button"
          disabled={busy || !id}
          onClick={() =>
            void apply(async () => (await api(`/datasets/${id}`)).market)
          }
        >
          Use execution dataset
        </button>
        <button
          className="button ghost"
          disabled={busy || !session.finerMarket}
          onClick={() => void apply(async () => undefined)}
        >
          Disable finer execution
        </button>
        <p role="status">
          {session.finerMarket
            ? `Enabled: ${session.finerMarket.interval} · ${session.finerMarket.bars.length} finer candles`
            : 'Finer execution is off'}
        </p>
        <p>
          Reconciled parent candles:{' '}
          {session.account.executionCoverage?.fine ?? 0} · Conservative
          fallbacks: {session.account.executionCoverage?.fallback ?? 0}
        </p>
        {error && <p role="alert">{error}</p>}
      </section>
    </details>
  );
}

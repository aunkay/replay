import { useState } from 'react';
import type { StoredSession } from '../lib/session';
import type { MarketData } from '../lib/data';
import type { TradingCommand } from '../lib/sessionPortfolio';
import { portfolioMetrics } from '../lib/portfolio';
import { api } from '../lib/server';

export default function PortfolioPanel({
  session,
  comparisons,
  onAdd,
  onCommand,
}: {
  session: StoredSession;
  comparisons: MarketData[];
  onAdd: (market: MarketData) => Promise<void>;
  onCommand: (command: TradingCommand) => Promise<void>;
}) {
  const [ticker, setTicker] = useState(''),
    [quantity, setQuantity] = useState('1');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'market' | 'limit' | 'stop'>('market');
  const [price, setPrice] = useState(''),
    [stop, setStop] = useState(''),
    [target, setTarget] = useState('');
  const [entries, setEntries] = useState<
    { id: string; name: string; ticker: string; interval: string }[]
  >([]);
  const [dataset, setDataset] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const book = session.portfolio?.book;
  const metrics = book ? portfolioMetrics(book) : undefined;
  const selected =
    book?.assets.find((a) => a.ticker === ticker) ?? book?.assets[0];
  const money = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: session.market.currency ?? 'USD',
    }).format(n);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="alerts-panel portfolio-panel"
      onToggle={(e) => {
        if (e.currentTarget.open)
          void api('/datasets')
            .then(setEntries)
            .catch((e) => setError(e.message));
      }}
    >
      <summary>Portfolio trading</summary>
      <section aria-label="Portfolio trading">
        <p>
          Trade the base ticker and up to five comparisons with one cash balance
          and shared buying power. Add same-currency data at the base interval.
          Chart normalization does not change execution prices.
        </p>
        {session.mode === 'live' && (
          <p>
            Live orders wait for a new completed candle from every portfolio
            ticker. Only provider data from your active chart comparisons can be
            added in Live mode.
          </p>
        )}
        <div className="portfolio-add">
          {comparisons
            .filter((m) => !book?.assets.some((a) => a.ticker === m.ticker))
            .map((m) => (
              <button
                className="button"
                key={m.ticker}
                disabled={busy}
                onClick={() => void run(() => onAdd(m))}
              >
                Trade {m.ticker} in portfolio
              </button>
            ))}
          <label>
            Portfolio dataset
            <select
              aria-label="Portfolio dataset"
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
            >
              <option value="">Choose a saved comparison dataset</option>
              {entries
                .filter(
                  (d) =>
                    d.interval === session.market.interval &&
                    d.ticker !== session.market.ticker &&
                    !book?.assets.some((a) => a.ticker === d.ticker),
                )
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.ticker}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="button"
            disabled={busy || !dataset || session.mode === 'live'}
            onClick={() =>
              void run(async () => {
                await onAdd((await api(`/datasets/${dataset}`)).market);
                setDataset('');
              })
            }
          >
            Add dataset to portfolio
          </button>
        </div>
        {!book && (
          <p>
            Add a chart comparison or a saved dataset to begin. Your existing
            base-ticker trades and account balance are preserved.
          </p>
        )}
        {book && metrics && (
          <>
            <dl className="portfolio-metrics">
              <div>
                <dt>Portfolio equity</dt>
                <dd>{money(metrics.equity)}</dd>
              </div>
              <div>
                <dt>Shared cash</dt>
                <dd>{money(metrics.cash)}</dd>
              </div>
              <div>
                <dt>Buying power</dt>
                <dd>{money(metrics.buyingPower)}</dd>
              </div>
              <div>
                <dt>Portfolio P&amp;L</dt>
                <dd>{money(metrics.totalPnl)}</dd>
              </div>
            </dl>
            <p>
              Orders execute on revealed candles. Missing quotes retain the last
              known mark; trading waits for a fresh candle. Simultaneous pending
              fills compete for capital in ticker order.
            </p>
            <div className="portfolio-positions">
              {book.assets.map((a) => (
                <article
                  key={a.ticker}
                  aria-label={`Portfolio position ${a.ticker}`}
                >
                  <h4>
                    {a.ticker} · {a.account.position.quantity} units
                  </h4>
                  <p>
                    Price {money(a.bar.close)} · Average{' '}
                    {money(a.account.position.averagePrice)} · Unrealized{' '}
                    {money(
                      a.account.position.quantity *
                        (a.bar.close - a.account.position.averagePrice),
                    )}{' '}
                    · Realized {money(a.account.realizedPnl)}
                  </p>
                  <small>
                    Last candle {new Date(a.bar.time * 1000).toISOString()}
                  </small>
                  <button
                    className="button"
                    disabled={busy || !a.account.position.quantity}
                    onClick={() =>
                      void run(() =>
                        onCommand({ type: 'close', ticker: a.ticker }),
                      )
                    }
                  >
                    Close {a.ticker} position
                  </button>
                  {a.account.orders
                    .filter((o) => o.status === 'pending')
                    .map((o) => (
                      <div key={o.id}>
                        {o.side} {o.quantity} {o.role ?? o.type}{' '}
                        {o.price ? money(o.price) : ''}{' '}
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              onCommand({
                                type: 'cancel',
                                ticker: a.ticker,
                                id: o.id,
                              }),
                            )
                          }
                        >
                          Cancel {a.ticker} {o.role ?? o.type} order
                        </button>
                      </div>
                    ))}
                  {a.account.orders.at(-1)?.status === 'rejected' && (
                    <p role="status">{a.account.orders.at(-1)?.reason}</p>
                  )}
                </article>
              ))}
            </div>
            <form
              aria-label="Portfolio order ticket"
              onSubmit={(e) => {
                e.preventDefault();
                if (selected)
                  void run(() =>
                    onCommand({
                      type: 'order',
                      ticker: selected.ticker,
                      order: {
                        side,
                        type,
                        quantity: Number(quantity),
                        ...(type !== 'market' ? { price: Number(price) } : {}),
                        ...(stop ? { stopLoss: Number(stop) } : {}),
                        ...(target ? { takeProfit: Number(target) } : {}),
                      },
                    }),
                  );
              }}
            >
              <label>
                Trade ticker
                <select
                  aria-label="Portfolio trade ticker"
                  value={selected?.ticker ?? ''}
                  onChange={(e) => setTicker(e.target.value)}
                >
                  {book.assets.map((a) => (
                    <option key={a.ticker}>{a.ticker}</option>
                  ))}
                </select>
              </label>
              <label>
                Side
                <select
                  aria-label="Portfolio side"
                  value={side}
                  onChange={(e) => setSide(e.target.value as typeof side)}
                >
                  <option value="buy">Buy</option>
                  <option value="sell">Sell / short</option>
                </select>
              </label>
              <label>
                Order type
                <select
                  aria-label="Portfolio order type"
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                >
                  <option value="market">Market</option>
                  <option value="limit">Limit</option>
                  <option value="stop">Stop</option>
                </select>
              </label>
              <label>
                Quantity
                <input
                  aria-label="Portfolio quantity"
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
              {type !== 'market' && (
                <label>
                  Order price
                  <input
                    aria-label="Portfolio order price"
                    type="number"
                    min="0.000001"
                    step="any"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </label>
              )}
              <label>
                Stop-loss
                <input
                  aria-label="Portfolio stop-loss"
                  type="number"
                  min="0.000001"
                  step="any"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                />
              </label>
              <label>
                Take-profit
                <input
                  aria-label="Portfolio take-profit"
                  type="number"
                  min="0.000001"
                  step="any"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              <button className="button primary" disabled={busy}>
                Place portfolio order
              </button>
            </form>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </details>
  );
}

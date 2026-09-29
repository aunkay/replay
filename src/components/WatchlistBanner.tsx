import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import './WatchlistBanner.css';
type Quote = {
  ticker: string;
  price?: number;
  previousClose?: number | null;
  changePct?: number | null;
  currency?: string | null;
  sessionDate?: string;
  asOf?: number | null;
  fetchedAt?: number;
  nextAttempt?: number;
  error?: string | null;
  stale: boolean;
};
type Snapshot = {
  tickers: string[];
  interval: number;
  enabled: boolean;
  monitoring: boolean;
  quotes: Quote[];
  provider: { retryAt: number | null };
};
async function request(
  body?: unknown,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const response = await fetch(
    body === undefined ? '/api/watchlist/heartbeat' : '/api/watchlist',
    {
      method: body === undefined ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    },
  );
  if (!response.ok)
    throw new Error(
      'Watchlist could not connect to the server. Your saved list is kept.',
    );
  return response.json();
}
export default function WatchlistBanner() {
  const [data, setData] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const draftInitialized = useRef(false),
    generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [tickers, setTickers] = useState<string[]>([]);
  const [interval, setIntervalSeconds] = useState(60);
  const [enabled, setEnabled] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem('replay-watchlist-paused') === 'true';
    } catch {
      return false;
    }
  });
  const viewport = useRef<HTMLDivElement>(null),
    group = useRef<HTMLDivElement>(null),
    track = useRef<HTMLDivElement>(null);
  const previousDistance = useRef(0);
  const [distance, setDistance] = useState(0);
  useEffect(() => {
    let alive = true,
      pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      const currentGeneration = generation.current;
      try {
        const next = await request(undefined, controller.signal);
        if (alive && currentGeneration === generation.current) {
          setData(next);
          setConnectionError('');
        }
      } catch {
        if (alive)
          setConnectionError(
            'Watchlist connection interrupted; retaining last quotes.',
          );
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useLayoutEffect(() => {
    if (!viewport.current || !group.current) return;
    const measure = () =>
      setDistance(
        data?.tickers.length &&
          group.current!.getBoundingClientRect().width >
            viewport.current!.clientWidth + 1
          ? group.current!.getBoundingClientRect().width
          : 0,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current);
    observer.observe(group.current);
    measure();
    return () => observer.disconnect();
  }, [data?.tickers.length]);
  useLayoutEffect(() => {
    const animation = track.current?.getAnimations()[0];
    const previous = previousDistance.current;
    if (animation && distance > 0 && previous > 0 && !paused) {
      // Changing CSS duration must not move the quote under the user's eyes.
      // currentTime survives a duration update; convert its old loop position
      // back to pixels, then place it at the same offset in the new loop.
      const elapsed = Number(animation.currentTime ?? 0);
      const oldDuration = (previous / 35) * 1000;
      const offset = ((elapsed % oldDuration) / oldDuration) * previous;
      animation.currentTime = ((offset % distance) / 35) * 1000;
    }
    previousDistance.current = paused ? 0 : distance;
    if (!paused && viewport.current) viewport.current.scrollLeft = 0;
  }, [distance, paused]);

  useEffect(() => {
    if (open && data && !draftInitialized.current) {
      draftInitialized.current = true;
      setTickers(data.tickers);
      setIntervalSeconds(data.interval);
      setEnabled(data.enabled);
      setInput('');
      setError('');
    }
  }, [open, data]);
  function add() {
    const symbols = input
      .toUpperCase()
      .split(/[\s,;]+/)
      .filter(Boolean);
    if (!symbols.length) return;
    if (symbols.some((s) => !/^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/.test(s))) {
      setError('Enter Yahoo ticker symbols separated by commas or spaces.');
      return;
    }
    const next = [...new Set([...tickers, ...symbols])];
    if (next.length > 10) {
      setError(
        'A watchlist supports up to 10 tickers. Remove one before adding another.',
      );
      return;
    }
    setTickers(next);
    setInput('');
    setError('');
  }
  async function save() {
    if (input.trim()) {
      setError('Click Add tickers first, then save your watchlist.');
      return;
    }
    generation.current++;
    setBusy(true);
    setError('');
    try {
      setData(await request({ tickers, interval, enabled }));
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const items = (duplicate = false) =>
    (data?.quotes ?? []).map((q) => {
      const change =
        q.changePct == null
          ? null
          : Math.abs(q.changePct) < 0.005
            ? 0
            : q.changePct;
      const color =
        change === null || change === 0
          ? 'neutral'
          : change > 0
            ? 'positive'
            : 'negative';
      const price =
        q.price == null
          ? '—'
          : q.price.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: q.price < 1 ? 6 : 2,
            });
      const title = [
        q.ticker,
        q.sessionDate
          ? `Reported session: ${q.sessionDate}`
          : 'Waiting for first quote',
        q.asOf ? `Quote time: ${new Date(q.asOf * 1000).toISOString()}` : '',
        q.fetchedAt
          ? `Fetched: ${new Date(q.fetchedAt * 1000).toISOString()}`
          : '',
        q.error ?? '',
      ]
        .filter(Boolean)
        .join(' · ');
      return (
        <div
          key={q.ticker}
          role={duplicate ? undefined : 'listitem'}
          className={`watchlist-quote ${color}`}
          title={title}
          data-ticker={q.ticker}
          data-stale={q.stale}
        >
          <strong>{q.ticker}</strong>
          <span>{price}</span>
          <span>
            {change === null
              ? '(—)'
              : `(${change > 0 ? '+' : ''}${change.toFixed(2)}%)`}
          </span>
          {q.currency && <small>{q.currency}</small>}
          {q.stale && (
            <small className="watchlist-stale">
              {q.price == null
                ? q.error
                  ? 'unavailable'
                  : 'loading'
                : 'stale'}
            </small>
          )}
        </div>
      );
    });
  return (
    <section className="watchlist-banner" aria-label="Market watchlist">
      <details
        className="watchlist-settings"
        open={open}
        onToggle={(e) => {
          const next = e.currentTarget.open;
          if (!next) draftInitialized.current = false;
          setOpen(next);
        }}
      >
        <summary>
          Watchlist <span>{data?.tickers.length ?? 0}/10</span>
        </summary>
        <div
          className="watchlist-editor"
          role="group"
          aria-label="Watchlist settings"
        >
          <h3>Market watchlist</h3>
          <p>
            Current Yahoo regular-session quotes, independent of replay. Prices
            may be delayed. Change compares the latest reported daily close with
            the preceding session close, not your last poll.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor="watchlist-symbols">Ticker symbols</label>
            <div className="watchlist-add">
              <input
                id="watchlist-symbols"
                disabled={busy || !data}
                value={input}
                placeholder="AAPL, MSFT, SPY"
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(e) => setInput(e.target.value)}
              />
              <button type="submit" disabled={busy || !data}>
                Add tickers
              </button>
            </div>
          </form>
          <ol className="watchlist-edit-list">
            {tickers.map((ticker, i) => (
              <li key={ticker}>
                <b>{ticker}</b>
                <button
                  aria-label={`Move ${ticker} up`}
                  disabled={i === 0 || busy}
                  onClick={() =>
                    setTickers((v) => {
                      const next = [...v];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return next;
                    })
                  }
                >
                  ↑
                </button>
                <button
                  aria-label={`Remove ${ticker} from watchlist`}
                  disabled={busy}
                  onClick={() =>
                    setTickers((v) => v.filter((t) => t !== ticker))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <label>
            Update each ticker
            <select
              aria-label="Watchlist polling interval"
              disabled={busy || !data}
              value={interval}
              onChange={(e) => setIntervalSeconds(+e.target.value)}
            >
              <option value={30}>Every 30 seconds</option>
              <option value={60}>Every minute (recommended)</option>
              <option value={120}>Every 2 minutes</option>
              <option value={300}>Every 5 minutes</option>
            </select>
          </label>
          <label className="watchlist-enable">
            <input
              type="checkbox"
              disabled={busy || !data}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable quote polling
          </label>
          <p>
            Requests are staggered at least 3 seconds apart and share
            Live/replay’s provider limiter. Closed markets refresh at most every
            5 minutes when market hours are available. Throttling causes
            automatic backoff; intervals are targets, not guarantees. Polling
            stops shortly after all visible browser tabs close.
          </p>
          <p>
            This list is saved on the server and shared across your devices.
            Stop the banner animation to scroll manually; reduced-motion
            preferences are respected.
          </p>
          {data?.quotes
            .filter((q) => q.error)
            .map((q) => (
              <p key={q.ticker} className="watchlist-error">
                {q.ticker}: {q.error}
              </p>
            ))}
          {error && (
            <p role="alert" className="watchlist-error">
              {error}
            </p>
          )}
          <button
            className="button primary"
            disabled={busy || !data}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save watchlist'}
          </button>
        </div>
      </details>
      <span className="watchlist-source">
        {data?.enabled === false ? 'Polling paused' : 'Yahoo · delayed'}
      </span>
      <div
        className={`watchlist-viewport ${paused ? 'is-paused' : ''}`}
        ref={viewport}
        tabIndex={0}
        aria-label="Watchlist quotes, scroll horizontally when animation is stopped"
      >
        <div
          ref={track}
          className={`watchlist-track ${distance && !paused ? 'is-scrolling' : ''}`}
          style={
            {
              '--ticker-duration': `${Math.max(0.1, distance / 35)}s`,
            } as CSSProperties
          }
        >
          <div className="watchlist-group" ref={group} role="list">
            {items()}
            {!data?.tickers.length && (
              <span className="watchlist-empty">
                Add up to 10 tickers to follow their prices.
              </span>
            )}
          </div>
          {distance > 0 && !paused && (
            <div className="watchlist-group" aria-hidden="true">
              {items(true)}
            </div>
          )}
        </div>
      </div>
      <button
        className="watchlist-motion"
        aria-label={
          paused ? 'Start watchlist animation' : 'Stop watchlist animation'
        }
        aria-pressed={paused}
        onClick={() =>
          setPaused((v) => {
            try {
              localStorage.setItem('replay-watchlist-paused', String(!v));
            } catch {
              /* Motion still works without storage. */
            }
            return !v;
          })
        }
      >
        {paused ? '▶' : 'Ⅱ'}
      </button>
      {(connectionError ||
        (data?.provider.retryAt ?? 0) > Date.now() / 1000) && (
        <p className="watchlist-message" role="status">
          {connectionError ||
            'Yahoo cooldown active. Last quotes remain visible; retry is automatic.'}
        </p>
      )}
    </section>
  );
}

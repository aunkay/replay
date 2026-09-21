import { useEffect, useState } from 'react';
import { api } from '../lib/server';
type Monitor = {
  id: string;
  ticker: string;
  interval: string;
  active: boolean;
  gap: boolean;
  events: number;
  error?: string;
};
export default function BackgroundMonitors({
  onConnect,
}: {
  onConnect: (id: string) => Promise<void>;
}) {
  const [monitors, setMonitors] = useState<Monitor[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<Monitor[]>('/live')
        .then((rows) => {
          if (!cancelled) setMonitors(rows);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  if (!monitors.length) return null;
  return (
    <section className="live-status" aria-label="Background live monitors">
      <strong>Background live monitors</strong>
      <p>
        Connect to take control and inspect the current account and alerts.
        Closing the browser leaves these monitors running.
      </p>
      {monitors.map((m) => (
        <article
          data-monitor-id={m.id}
          key={m.id}
          aria-label={`Monitor ${m.ticker}`}
        >
          <span>
            {m.ticker} {m.interval} · {m.active ? 'Monitoring' : 'Paused'} ·{' '}
            {m.events} alerts
          </span>
          {m.error && <p>{m.error}</p>}
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConnect(m.id);
              } finally {
                setBusy(false);
              }
            }}
          >
            Connect to monitor
          </button>
          <button
            className="button ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/live/${m.id}`, undefined, 'DELETE');
                setMonitors((rows) => rows.filter((r) => r.id !== m.id));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Stop monitor
          </button>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

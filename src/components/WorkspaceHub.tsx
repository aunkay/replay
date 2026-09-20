import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredSession } from '../lib/session';
import { api, type useServerSession } from '../lib/server';
import { captureChart } from '../lib/capture';
import { analyzeTrades, closedTrades, equityAnalysis } from '../lib/analytics';
import { exportCsv } from '../lib/data';
import StrategyBuilder from './StrategyBuilder';
export default function WorkspaceHub({
  session,
  library,
  onPause,
  onBlind,
}: {
  session: StoredSession;
  library: ReturnType<typeof useServerSession>;
  onPause: () => void;
  onBlind: (count: number) => void;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState('sessions'),
    [sessions, setSessions] = useState<any[]>([]),
    [notes, setNotes] = useState<any[]>([]),
    [name, setName] = useState('My replay'),
    [error, setError] = useState(''),
    [length, setLength] = useState(100),
    [filter, setFilter] = useState(''),
    [sessionSearch, setSessionSearch] = useState(''),
    [group, setGroup] = useState('direction'),
    [autoCapture, setAutoCapture] = useState(
      () => localStorage.getItem('replay-auto-capture') === 'true',
    );
  const seen = useRef<{ session: string | null; orders: Set<string> }>({
    session: null,
    orders: new Set(),
  });
  const trades = useMemo(
    () =>
      closedTrades(
        session.account.orders,
        session.market.bars.slice(0, session.cursor + 1),
      ),
    [session],
  );
  const filtered = trades.filter((t) => {
    const n = notes.find((n) => n.tradeId === t.id);
    return (
      !filter ||
      `${t.direction} ${n?.setup ?? ''} ${n?.tags ?? ''}`
        .toLowerCase()
        .includes(filter.toLowerCase())
    );
  });
  const metrics = analyzeTrades(filtered);
  const stats = {
    ...metrics,
    payoffRatio:
      metrics.averageLoss && metrics.averageWin
        ? metrics.averageWin / metrics.averageLoss
        : null,
    ...equityAnalysis(
      session.account.equityHistory,
      session.account.config.initialCapital,
    ),
  };
  const groups = new Map<string, typeof filtered>();
  for (const trade of filtered) {
    const note = notes.find((n) => n.tradeId === trade.id);
    const date = new Date(trade.openedAt * 1000);
    const key =
      group === 'setup'
        ? note?.setup || 'Unclassified'
        : group === 'tags'
          ? note?.tags || 'Untagged'
          : group === 'weekday'
            ? date.toLocaleDateString('en-US', {
                weekday: 'long',
                timeZone: session.market.exchangeTimezone ?? 'UTC',
              })
            : group === 'hour'
              ? date.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  hour12: false,
                  timeZone: session.market.exchangeTimezone ?? 'UTC',
                })
              : trade.direction;
    groups.set(key, [...(groups.get(key) ?? []), trade]);
  }
  const load = () =>
    api<any[]>('/sessions')
      .then(setSessions)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (open) {
      void load();
      if (library.record)
        api<any[]>(`/sessions/${library.record.id}/journal`)
          .then(setNotes)
          .catch((e) => setError(e.message));
    }
  }, [open, library.record?.id]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  useEffect(() => {
    const id = library.record?.id ?? null;
    const fills = session.account.orders.filter((o) => o.status === 'filled');
    if (seen.current.session !== id) {
      seen.current = { session: id, orders: new Set(fills.map((o) => o.id)) };
      return;
    }
    const fresh = fills.filter((o) => !seen.current.orders.has(o.id));
    seen.current.orders = new Set(fills.map((o) => o.id));
    if (autoCapture && id)
      for (const fill of fresh) {
        const trade = trades.find((t) => t.orderIds.includes(fill.id));
        void capture(trade?.id ?? fill.id);
      }
  }, [session.account.orders, library.record?.id, autoCapture]);
  async function capture(tradeId: string) {
    try {
      if (!library.record) throw new Error('Save the session first');
      const blob = await captureChart(
        `${session.market.ticker} · ${session.market.interval} · ${new Date(session.market.bars[session.cursor].time * 1000).toISOString()} · ${session.mode ?? 'replay'}`,
      );
      const response = await fetch(
        `/api/sessions/${library.record.id}/attachments`,
        { method: 'POST', body: blob },
      );
      const image = await response.json();
      if (!response.ok) throw new Error(image.detail);
      const latest = await api<any[]>(`/sessions/${library.record.id}/journal`);
      const note = latest.find((n) => n.tradeId === tradeId) ?? {};
      const next = { ...note, images: [...(note.images ?? []), image.url] };
      await saveNote(tradeId, next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveNote(tradeId: string, note: any) {
    if (!library.record) return;
    await api(`/sessions/${library.record.id}/journal/${tradeId}`, note, 'PUT');
    setNotes((old) => [
      ...old.filter((n) => n.tradeId !== tradeId),
      { ...note, tradeId },
    ]);
  }
  const journalTrades = [...trades];
  if (session.account.position.quantity) {
    let position = 0;
    let entry: (typeof session.account.orders)[number] | undefined;
    for (const order of session.account.orders
      .filter((o) => o.status === 'filled')
      .sort((a, b) => a.filledAt! - b.filledAt!)) {
      const signed = order.quantity * (order.side === 'buy' ? 1 : -1);
      if (!position || position * (position + signed) < 0) entry = order;
      position += signed;
      if (Math.abs(position) < 1e-9) {
        position = 0;
        entry = undefined;
      }
    }
    if (entry && !journalTrades.some((t) => t.id === entry.id))
      journalTrades.push({
        id: entry.id,
        direction: session.account.position.quantity > 0 ? 'long' : 'short',
        openedAt: entry.filledAt!,
        closedAt: 0,
        pnl: 0,
        fees: 0,
        risk: entry.plannedRisk ?? 0,
        r: null,
        orderIds: [entry.id],
        ambiguous: false,
        mae: 0,
        mfe: 0,
      });
  }
  return (
    <>
      <button
        className="button ghost"
        onClick={() => {
          onPause();
          setOpen(true);
        }}
      >
        Practice & research
      </button>
      {library.record && (
        <span className="server-save-status">
          {library.record.name} · {library.status}
        </span>
      )}
      {open && (
        <div className="hub-backdrop">
          <section
            className="workspace-hub"
            role="dialog"
            aria-modal="true"
            aria-label="Practice and research"
          >
            <header>
              <h2>Practice & research</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close practice workspace"
              >
                ✕
              </button>
            </header>
            <nav>
              {['sessions', 'journal', 'analytics', 'blind', 'strategies'].map(
                (t) => (
                  <button
                    key={t}
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ),
              )}
            </nav>
            {(error || library.error) && (
              <p role="alert">{error || library.error}</p>
            )}
            {tab === 'sessions' && (
              <>
                <h3>Session library</h3>
                <label>
                  Session name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <div className="hub-actions">
                  <button
                    onClick={() =>
                      library
                        .save(name)
                        .then(load)
                        .catch((e) => setError(e.message))
                    }
                  >
                    Save as new session
                  </button>
                  <button
                    onClick={() =>
                      library
                        .save(
                          'Imported browser workspace',
                          session,
                          JSON.stringify({
                            market: session.market,
                            cursor: session.cursor,
                            account: session.account,
                          }),
                        )
                        .then(load)
                        .catch((e) => setError(e.message))
                    }
                  >
                    Import existing browser workspace
                  </button>
                  <button
                    onClick={() => {
                      library.detach();
                      setOpen(false);
                    }}
                  >
                    Use browser workspace
                  </button>
                  <label>
                    Import archive
                    <input
                      type="file"
                      accept=".zip"
                      onChange={async (e) => {
                        try {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const r = await fetch('/api/sessions-import', {
                            method: 'POST',
                            body: file,
                          });
                          const result = await r.json();
                          if (!r.ok) throw new Error(result.detail);
                          await load();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />
                  </label>
                </div>
                <label>
                  Search sessions
                  <input
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                  />
                </label>
                {sessions
                  .filter((s) =>
                    s.name.toLowerCase().includes(sessionSearch.toLowerCase()),
                  )
                  .map((s) => (
                    <article key={s.id}>
                      <strong>
                        {s.name}
                        {s.archived ? ' · Archived' : ''}
                      </strong>
                      <small>
                        {new Date(s.updated * 1000).toLocaleString()}
                      </small>
                      <div className="hub-actions">
                        <button
                          onClick={() =>
                            library
                              .open(s.id)
                              .then(() => {
                                localStorage.setItem(
                                  'replay-market-lab:v1',
                                  JSON.stringify(
                                    library.record?.payload.session ?? session,
                                  ),
                                );
                                setOpen(false);
                              })
                              .catch((e) => setError(e.message))
                          }
                        >
                          Resume
                        </button>
                        <button
                          onClick={() =>
                            library
                              .open(s.id, true)
                              .then(() => setOpen(false))
                              .catch((e) => setError(e.message))
                          }
                        >
                          Take control
                        </button>
                        <button
                          onClick={() =>
                            api(
                              `/sessions/${s.id}`,
                              {
                                revision: s.revision,
                                client: library.client,
                                name,
                              },
                              'PUT',
                            )
                              .then(load)
                              .catch((e) => setError(e.message))
                          }
                        >
                          Rename to entered name
                        </button>
                        <button
                          onClick={() =>
                            api(
                              `/sessions/${s.id}`,
                              {
                                revision: s.revision,
                                client: library.client,
                                archived: !s.archived,
                              },
                              'PUT',
                            )
                              .then(load)
                              .catch((e) => setError(e.message))
                          }
                        >
                          {s.archived ? 'Unarchive' : 'Archive'}
                        </button>
                        <a href={`/api/sessions/${s.id}/export`}>Export ZIP</a>
                        <button
                          onClick={() =>
                            api(`/sessions/${s.id}`)
                              .then((source) =>
                                api('/sessions', {
                                  name: `${source.name} (copy)`,
                                  payload: source.payload,
                                }),
                              )
                              .then(load)
                              .catch((e) => setError(e.message))
                          }
                        >
                          Duplicate
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete ${s.name} and its journal?`))
                              api(`/sessions/${s.id}`, undefined, 'DELETE')
                                .then(load)
                                .catch((e) => setError(e.message));
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
              </>
            )}
            {tab === 'journal' && (
              <>
                <h3>Trade journal</h3>
                <label>
                  <input
                    type="checkbox"
                    checked={autoCapture}
                    onChange={(e) => {
                      setAutoCapture(e.target.checked);
                      localStorage.setItem(
                        'replay-auto-capture',
                        String(e.target.checked),
                      );
                    }}
                  />{' '}
                  Automatically capture entry and exit charts for this browser
                </label>
                <button
                  onClick={() =>
                    exportCsv(
                      [
                        [
                          'Trade',
                          'Setup',
                          'Tags',
                          'Entry rationale',
                          'Exit rationale',
                          'Notes',
                        ],
                        ...notes.map((n) => [
                          n.tradeId,
                          n.setup ?? '',
                          n.tags ?? '',
                          n.entryRationale ?? '',
                          n.exitRationale ?? '',
                          n.notes ?? '',
                        ]),
                      ],
                      'trade-journal.csv',
                    )
                  }
                >
                  Export journal CSV
                </button>
                {!library.record ? (
                  <p>
                    Save this session to keep notes and screenshots on the
                    server.
                  </p>
                ) : journalTrades.length === 0 ? (
                  <p>Place a trade to start your journal.</p>
                ) : (
                  journalTrades.map((t) => {
                    const note = notes.find((n) => n.tradeId === t.id) ?? {};
                    return (
                      <article key={t.id}>
                        <h4>
                          {t.direction} · {t.id} ·{' '}
                          {t.closedAt
                            ? `P&L ${t.pnl.toFixed(2)}`
                            : 'Open position'}
                        </h4>
                        {[
                          'setup',
                          'tags',
                          'entryRationale',
                          'exitRationale',
                          'notes',
                        ].map((field) => (
                          <label key={field}>
                            {field}
                            <textarea
                              value={note[field] ?? ''}
                              onChange={(e) =>
                                setNotes((old) => [
                                  ...old.filter((n) => n.tradeId !== t.id),
                                  {
                                    ...note,
                                    tradeId: t.id,
                                    [field]: e.target.value,
                                  },
                                ])
                              }
                            />
                          </label>
                        ))}
                        <button
                          onClick={() =>
                            saveNote(t.id, note).catch((e) =>
                              setError(e.message),
                            )
                          }
                        >
                          Save notes
                        </button>
                        <button onClick={() => capture(t.id)}>
                          Capture chart
                        </button>
                        {note.images?.map((url: string) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={url}
                              alt="Saved trade chart"
                              width="200"
                            />
                          </a>
                        ))}
                      </article>
                    );
                  })
                )}
              </>
            )}
            {tab === 'analytics' && (
              <>
                <h3>Closed-trade analysis</h3>
                <label>
                  Filter setup, tag or direction
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </label>
                <div className="metric-grid">
                  {Object.entries(stats).map(([key, value]) => (
                    <article key={key}>
                      <small>{key}</small>
                      <strong>
                        {value === null
                          ? '—'
                          : Number.isFinite(value)
                            ? value.toFixed(2)
                            : '∞'}
                      </strong>
                    </article>
                  ))}
                </div>
                <button
                  onClick={() =>
                    exportCsv(
                      [
                        [
                          'Trade',
                          'Direction',
                          'Entry',
                          'Exit',
                          'Net P&L',
                          'Fees',
                          'Risk',
                          'R',
                          'Ambiguous',
                        ],
                        ...filtered.map((t) => [
                          t.id,
                          t.direction,
                          t.openedAt,
                          t.closedAt,
                          t.pnl,
                          t.fees,
                          t.risk,
                          t.r ?? '',
                          t.ambiguous ? 'yes' : 'no',
                        ]),
                      ],
                      'closed-trades.csv',
                    )
                  }
                >
                  Export closed trades CSV
                </button>
                <table>
                  <thead>
                    <tr>
                      <th>Trade</th>
                      <th>P&L</th>
                      <th>R</th>
                      <th>MAE / MFE (price)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={t.id}>
                        <td>{t.id}</td>
                        <td>{t.pnl.toFixed(2)}</td>
                        <td>{t.r?.toFixed(2) ?? '—'}</td>
                        <td>
                          {t.mae.toFixed(2)} / {t.mfe.toFixed(2)}
                          {t.ambiguous ? ' · Ambiguous fill' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <label>
                  Group performance
                  <select
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    {['direction', 'setup', 'tags', 'weekday', 'hour'].map(
                      (g) => (
                        <option key={g}>{g}</option>
                      ),
                    )}
                  </select>
                </label>
                <p>
                  Entry time zone: {session.market.exchangeTimezone ?? 'UTC'}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Trades</th>
                      <th>Net P&amp;L</th>
                      <th>Expectancy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...groups].map(([key, trades]) => {
                      const a = analyzeTrades(trades);
                      return (
                        <tr key={key}>
                          <td>{key}</td>
                          <td>{a.count}</td>
                          <td>{a.netProfit.toFixed(2)}</td>
                          <td>{a.expectancy?.toFixed(2) ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p>
                  Trades are flat-to-flat episodes including partial exits and
                  allocated fees. Excursions are OHLC estimates.
                </p>
              </>
            )}
            {tab === 'blind' && (
              <>
                <h3>Blind practice</h3>
                <p>
                  A random window hides calendar dates and unrevealed prices.
                  Your ticker stays visible. The account starts fresh; finish to
                  reveal dates and results.
                </p>
                <label>
                  Exercise candles
                  <input
                    type="number"
                    min="1"
                    max={session.market.bars.length - 2}
                    value={length}
                    onChange={(e) => setLength(Number(e.target.value))}
                  />
                </label>
                <button
                  onClick={() => {
                    onBlind(length);
                    setOpen(false);
                  }}
                >
                  Start blind exercise
                </button>
              </>
            )}
            {tab === 'strategies' && (
              <StrategyBuilder bars={session.market.bars} />
            )}
          </section>
        </div>
      )}
    </>
  );
}

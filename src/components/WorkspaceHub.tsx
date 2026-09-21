import Checkpoints from './Checkpoints';
import type { CheckpointCommand } from '../lib/checkpoints';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredSession } from '../lib/session';
import { api, type useServerSession } from '../lib/server';
import { captureChart } from '../lib/capture';
import { analyzeTrades, closedTrades, equityAnalysis } from '../lib/analytics';
import { exportCsv } from '../lib/data';
import StrategyBuilder from './StrategyBuilder';
import SessionLibrary from './SessionLibrary';
import PracticeGuide from './PracticeGuide';
import {
  FolderOpen,
  BookOpen,
  BarChart3,
  EyeOff,
  FlaskConical,
  X,
  ArrowRight,
} from 'lucide-react';
const destinations = [
  {
    id: 'sessions',
    label: 'Sessions',
    description: 'Save & pick up later',
    icon: FolderOpen,
  },
  {
    id: 'journal',
    label: 'Trade journal',
    description: 'Record your decisions',
    icon: BookOpen,
  },
  {
    id: 'analytics',
    label: 'Performance',
    description: 'Learn from your trades',
    icon: BarChart3,
  },
  {
    id: 'blind',
    label: 'Blind practice',
    description: 'Practice without hindsight',
    icon: EyeOff,
  },
  {
    id: 'strategies',
    label: 'Strategy lab',
    description: 'Build & test your rules',
    icon: FlaskConical,
  },
];
const readable = (key: string) =>
  ({
    count: 'Closed trades',
    netProfit: 'Net P&L',
    grossProfit: 'Gross profit',
    grossLoss: 'Gross loss',
    profitFactor: 'Profit factor',
    expectancy: 'Expectancy / trade',
    winRate: 'Win rate',
    averageWin: 'Average win',
    averageLoss: 'Average loss',
    holdingSeconds: 'Average holding time',
    winningStreak: 'Longest winning streak',
    losingStreak: 'Longest losing streak',
    payoffRatio: 'Win / loss ratio',
    maxDrawdown: 'Maximum drawdown',
    maxDrawdownPct: 'Maximum drawdown %',
    maxDrawdownSeconds: 'Longest drawdown',
    setup: 'Setup',
    tags: 'Tags',
    entryRationale: 'Why did you enter?',
    exitRationale: 'Why did you exit?',
    notes: 'Lessons & notes',
  })[key] ?? key;
function metricValue(
  key: string,
  value: number | null,
  currency: string | null | undefined,
) {
  if (value === null) return '—';
  if (!Number.isFinite(value)) return '∞';
  if (key.toLowerCase().includes('seconds'))
    return value >= 86400
      ? `${(value / 86400).toFixed(1)} days`
      : value >= 3600
        ? `${(value / 3600).toFixed(1)} hours`
        : `${Math.round(value / 60)} min`;
  if (['count', 'winningStreak', 'losingStreak'].includes(key))
    return String(value);
  if (key === 'winRate' || key === 'maxDrawdownPct')
    return `${value.toFixed(1)}%`;
  if (
    [
      'netProfit',
      'grossProfit',
      'grossLoss',
      'expectancy',
      'averageWin',
      'averageLoss',
      'maxDrawdown',
    ].includes(key)
  )
    return `${value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${currency ?? ''}`;
  return value.toFixed(2);
}
export default function WorkspaceHub({
  session,
  library,
  onPause,
  onBlind,
  onCheckpoint,
}: {
  session: StoredSession;
  library: ReturnType<typeof useServerSession>;
  onPause: () => void;
  onBlind: (count: number) => void;
  onCheckpoint: (command: CheckpointCommand) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState('sessions'),
    [notes, setNotes] = useState<any[]>([]),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [saving, setSaving] = useState(false),
    [length, setLength] = useState(100),
    [filter, setFilter] = useState(''),
    [group, setGroup] = useState('direction'),
    [autoCapture, setAutoCapture] = useState(
      () => localStorage.getItem('replay-auto-capture') === 'true',
    );
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const dialog = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  function navigate(next: string) {
    setTab(next);
    setError('');
    setFeedback('');
    content.current?.scrollTo(0, 0);
  }
  const validLength =
    Number.isInteger(length) &&
    length > 0 &&
    length <= session.market.bars.length - 2;
  const seen = useRef<{ session: string | null; orders: Set<string> }>({
    session: null,
    orders: new Set(),
  });
  const trades = useMemo(
    () =>
      closedTrades(
        session.account.orders,
        session.market.bars.slice(0, session.cursor + 1),
        session.account.financing,
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
  useEffect(() => {
    if (open) {
      if (library.record)
        api<any[]>(`/sessions/${library.record.id}/journal`)
          .then(setNotes)
          .catch((e) => setError(e.message));
    }
  }, [open, library.record?.id]);
  useEffect(() => {
    if (!open) return;
    const isolated: {
      element: HTMLElement;
      inert: boolean;
      hidden: string | null;
    }[] = [];
    let ancestor = dialog.current?.parentElement;
    while (ancestor && ancestor !== document.body) {
      for (const sibling of Array.from(
        ancestor.parentElement?.children ?? [],
      )) {
        if (sibling !== ancestor && sibling instanceof HTMLElement) {
          isolated.push({
            element: sibling,
            inert: sibling.inert,
            hidden: sibling.getAttribute('aria-hidden'),
          });
          sibling.setAttribute('aria-hidden', 'true');
          sibling.inert = true;
        }
      }
      ancestor = ancestor.parentElement;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current
      ?.querySelector<HTMLButtonElement>(
        '[aria-label="Close practice workspace"]',
      )
      ?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
      if (e.key === 'Tab') {
        const nodes = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
          ) ?? [],
        ).filter((node) => {
          if (
            node.tabIndex < 0 ||
            !node.getClientRects().length ||
            node.closest('[hidden]')
          )
            return false;
          let parent: HTMLElement | null = node.parentElement;
          while (parent && parent !== dialog.current) {
            if (
              parent instanceof HTMLDetailsElement &&
              !parent.open &&
              !parent.querySelector('summary')?.contains(node)
            )
              return false;
            parent = parent.parentElement;
          }
          return true;
        });
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      document.body.style.overflow = previousOverflow;
      isolated.forEach(({ element, inert, hidden }) => {
        element.inert = inert;
        if (hidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', hidden);
      });
      opener.current?.focus();
    };
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
    setSaving(true);
    setError('');
    setFeedback('');
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
      const stored = latest.find((n) => n.tradeId === tradeId) ?? {};
      const draft = notesRef.current.find((n) => n.tradeId === tradeId) ?? {};
      const next = {
        ...stored,
        ...draft,
        images: [
          ...new Set([
            ...(stored.images ?? []),
            ...(draft.images ?? []),
            image.url,
          ]),
        ],
      };
      await saveNote(tradeId, next);
      setFeedback('Chart added to this trade.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function saveNote(tradeId: string, note: any) {
    if (!library.record) return;
    setSaving(true);
    setFeedback('');
    setError('');
    try {
      await api(
        `/sessions/${library.record.id}/journal/${tradeId}`,
        note,
        'PUT',
      );
      setNotes((old) => [
        ...old.filter((n) => n.tradeId !== tradeId),
        { ...note, tradeId },
      ]);
      setFeedback('Notes saved.');
    } finally {
      setSaving(false);
    }
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
        borrowing: 0,
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
        ref={opener}
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
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label="Practice and research"
          >
            <header className="hub-header">
              <div>
                <span className="hub-eyebrow">YOUR TRADING WORKSPACE</span>
                <h2>Practice & research</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close practice workspace"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <div className="hub-layout">
              <nav className="hub-nav" aria-label="Practice sections">
                {destinations.map(({ id, label, description, icon: Icon }) => (
                  <button
                    key={id}
                    aria-label={label}
                    aria-pressed={tab === id}
                    onClick={() => navigate(id)}
                  >
                    <Icon size={19} aria-hidden="true" />
                    <span>
                      <strong className="hub-desktop-label">{label}</strong>
                      <strong className="hub-mobile-label">
                        {
                          {
                            sessions: 'Sessions',
                            journal: 'Journal',
                            analytics: 'Results',
                            blind: 'Practice',
                            strategies: 'Strategies',
                          }[id]
                        }
                      </strong>
                      <small>{description}</small>
                    </span>
                    <ArrowRight
                      className="hub-nav-arrow"
                      size={15}
                      aria-hidden="true"
                    />
                  </button>
                ))}
                <div className="hub-context">
                  <span>Current replay</span>
                  <strong>
                    {session.market.ticker}{' '}
                    <small>{session.market.interval}</small>
                  </strong>
                  <span>
                    {library.record?.name ?? 'Unsaved browser workspace'}
                  </span>
                  <small>
                    {library.record
                      ? library.status
                      : 'Save in Sessions to continue on another device.'}
                  </small>
                </div>
              </nav>
              <div className="hub-content" ref={content}>
                <PracticeGuide key={tab} tab={tab} />
                {(error || library.error) && (
                  <p role="alert">{error || library.error}</p>
                )}
                {feedback && (
                  <p className="hub-feedback success" role="status">
                    {feedback}
                  </p>
                )}
                {tab === 'sessions' && (
                  <>
                    <Checkpoints
                      session={session}
                      onCommand={onCheckpoint}
                      server={Boolean(library.record)}
                    />
                    <SessionLibrary
                      session={session}
                      library={library}
                      onClose={() => setOpen(false)}
                    />
                  </>
                )}
                {tab === 'journal' && (
                  <>
                    <div className="hub-section-heading">
                      <div>
                        <h3>Trade journal</h3>
                        <p>
                          Capture the reasoning behind your trades, then review
                          what worked.
                        </p>
                      </div>
                    </div>
                    <details className="hub-disclosure">
                      <summary>Capture settings & export</summary>
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
                        Automatically capture entry and exit charts for this
                        browser
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
                    </details>
                    {!library.record ? (
                      <div className="hub-empty">
                        <BookOpen size={28} aria-hidden="true" />
                        <h4>Give your trades a home</h4>
                        <p>
                          Save this replay to keep notes and screenshots across
                          devices.
                        </p>
                        <button
                          className="hub-primary"
                          onClick={() => navigate('sessions')}
                        >
                          Save a session to start
                        </button>
                      </div>
                    ) : journalTrades.length === 0 ? (
                      <div className="hub-empty">
                        <BookOpen size={28} aria-hidden="true" />
                        <h4>Your first trade is a starting point</h4>
                        <p>
                          Place a paper trade, then return here to record your
                          setup and reasoning.
                        </p>
                        <button
                          className="hub-primary"
                          onClick={() => setOpen(false)}
                        >
                          Return to chart
                        </button>
                      </div>
                    ) : (
                      journalTrades.map((t) => {
                        const note =
                          notes.find((n) => n.tradeId === t.id) ?? {};
                        return (
                          <details
                            className="hub-journal-trade"
                            key={t.id}
                            open={journalTrades.length === 1}
                          >
                            <summary>
                              <span>
                                <strong>
                                  {session.market.ticker} ·{' '}
                                  {t.direction === 'long' ? 'Long' : 'Short'}
                                </strong>
                                <small>
                                  {new Date(t.openedAt * 1000).toLocaleString()}
                                </small>
                              </span>
                              <span
                                className={t.pnl < 0 ? 'hub-loss' : 'hub-gain'}
                              >
                                {t.closedAt
                                  ? `${t.pnl.toFixed(2)} ${session.market.currency ?? ''}`
                                  : 'Open position'}
                              </span>
                            </summary>
                            <div className="hub-journal-editor">
                              <div className="hub-fields">
                                {[
                                  'setup',
                                  'tags',
                                  'entryRationale',
                                  'exitRationale',
                                  'notes',
                                ].map((field) => (
                                  <label key={field}>
                                    {readable(field)}
                                    <textarea
                                      aria-label={readable(field)}
                                      value={note[field] ?? ''}
                                      onChange={(e) =>
                                        setNotes((old) => [
                                          ...old.filter(
                                            (n) => n.tradeId !== t.id,
                                          ),
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
                              </div>
                              <div className="hub-actions">
                                <button
                                  className="hub-primary"
                                  disabled={saving}
                                  onClick={() =>
                                    saveNote(t.id, note).catch((e) =>
                                      setError(e.message),
                                    )
                                  }
                                >
                                  Save notes
                                </button>
                                <button
                                  disabled={saving}
                                  onClick={() => capture(t.id)}
                                >
                                  Capture chart
                                </button>
                              </div>
                              <div className="hub-image-list">
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
                              </div>
                            </div>
                          </details>
                        );
                      })
                    )}
                  </>
                )}
                {tab === 'analytics' && (
                  <>
                    <div className="hub-section-heading">
                      <div>
                        <h3>Closed-trade analysis</h3>
                        <p>
                          Find patterns in completed trades. Open positions
                          appear in the chart workspace.
                        </p>
                      </div>
                    </div>
                    {trades.length === 0 && (
                      <div className="hub-empty">
                        <BarChart3 size={28} aria-hidden="true" />
                        <h4>No completed trades yet</h4>
                        <p>
                          Close a paper position to see your win rate,
                          expectancy and trade breakdown.
                        </p>
                        <button onClick={() => setOpen(false)}>
                          Return to chart
                        </button>
                      </div>
                    )}
                    <label>
                      Filter setup, tag or direction
                      <input
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      />
                    </label>
                    <div className="metric-grid">
                      {Object.entries(stats)
                        .filter(([key]) =>
                          [
                            'count',
                            'netProfit',
                            'winRate',
                            'profitFactor',
                          ].includes(key),
                        )
                        .map(([key, value]) => (
                          <article key={key}>
                            <small>{readable(key)}</small>
                            <strong>
                              {metricValue(key, value, session.market.currency)}
                            </strong>
                          </article>
                        ))}
                    </div>
                    <details className="hub-disclosure">
                      <summary>More statistics & drawdown</summary>
                      <p>
                        Trade statistics follow your filter. Drawdown covers the
                        whole account.
                      </p>
                      <div className="metric-grid">
                        {Object.entries(stats)
                          .filter(
                            ([key]) =>
                              ![
                                'count',
                                'netProfit',
                                'winRate',
                                'profitFactor',
                              ].includes(key),
                          )
                          .map(([key, value]) => (
                            <article key={key}>
                              <small>{readable(key)}</small>
                              <strong>
                                {metricValue(
                                  key,
                                  value,
                                  session.market.currency,
                                )}
                              </strong>
                            </article>
                          ))}
                      </div>
                    </details>
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
                              'Borrowing',
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
                              t.borrowing,
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
                    <div
                      className="hub-table-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label="Performance table"
                    >
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
                              <td>
                                {t.direction === 'long' ? 'Long' : 'Short'}
                                <small>
                                  {new Date(
                                    t.openedAt * 1000,
                                  ).toLocaleDateString()}
                                </small>
                              </td>
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
                    </div>
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
                      Entry time zone:{' '}
                      {session.market.exchangeTimezone ?? 'UTC'}
                    </p>
                    <div
                      className="hub-table-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label="Performance table"
                    >
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
                    </div>
                    <p>
                      Trades are flat-to-flat episodes including partial exits
                      and allocated fees. Excursions are OHLC estimates.
                    </p>
                  </>
                )}
                {tab === 'blind' && (
                  <>
                    <div className="hub-section-heading">
                      <div>
                        <h3>Blind practice</h3>
                        <p>Make decisions without knowing what happens next.</p>
                      </div>
                      <EyeOff size={28} aria-hidden="true" />
                    </div>
                    <ol className="hub-steps">
                      <li>
                        <strong>Choose a length</strong>
                        <span>
                          Start with a short exercise or challenge yourself with
                          more candles.
                        </span>
                      </li>
                      <li>
                        <strong>Trade a hidden window</strong>
                        <span>
                          Dates are hidden and each new candle is a fresh
                          decision.
                        </span>
                      </li>
                      <li>
                        <strong>Finish & review</strong>
                        <span>
                          Close the exercise to reveal dates and review your
                          P&L.
                        </span>
                      </li>
                    </ol>
                    <p>
                      A random window hides calendar dates and unrevealed
                      prices. Your ticker stays visible. The account starts
                      fresh; finish to reveal dates and results.
                    </p>
                    <div className="hub-save-card">
                      <div
                        className="hub-actions"
                        aria-label="Exercise presets"
                      >
                        {[25, 50, 100].map((count) => (
                          <button
                            key={count}
                            aria-pressed={length === count}
                            disabled={count > session.market.bars.length - 2}
                            onClick={() => setLength(count)}
                          >
                            {count} candles
                          </button>
                        ))}
                      </div>
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
                      {!validLength && (
                        <p role="alert">
                          Choose a whole number between 1 and{' '}
                          {session.market.bars.length - 2}.
                        </p>
                      )}
                      <p className="hub-muted">
                        This starts a fresh paper account. Save your current
                        replay first if you want to keep it.
                      </p>
                      <button
                        className="hub-primary"
                        disabled={!validLength}
                        onClick={() => {
                          onBlind(length);
                          setOpen(false);
                        }}
                      >
                        Start blind exercise
                      </button>
                    </div>
                  </>
                )}
                <div hidden={tab !== 'strategies'}>
                  <StrategyBuilder
                    bars={session.market.bars}
                    finerMarket={session.finerMarket}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

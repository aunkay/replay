import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CandlestickChart,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crosshair,
  Database,
  Download,
  Expand,
  History,
  Layers3,
  LineChart,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SkipForward,
  SlidersHorizontal,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import MarketChart from './components/MarketChart';
import EquityChart from './components/EquityChart';
import IndicatorMenu from './components/IndicatorMenu';
import DrawingToolbar from './components/DrawingToolbar';
import ComparisonControls from './components/ComparisonControls';
import ChartDisplayControls from './components/ChartDisplayControls';
import { computeMultiNormalizedView } from './lib/multiNormalization';
import { useChartDisplay } from './lib/useChartDisplay';
import { useMobileViewport } from './lib/useMobileViewport';
import { useComparisons } from './lib/useComparison';
import { INDICATORS } from './lib/indicators';
import { type DrawingTool, type Drawing } from './lib/drawings';
import { useChartWorkspace } from './lib/chartWorkspace';
import {
  advanceBar,
  cancelOrder,
  closePosition,
  createAccount,
  getMetrics,
  submitOrder,
  type Candle,
  type EngineConfig,
  type OrderType,
  type Side,
  type TradingState,
} from './lib/engine';
import { isValidSession } from './lib/session';
import {
  createDemo,
  defaultPeriod,
  exportCsv,
  fetchMarketData,
  formatDate,
  INTERVALS,
  type MarketData,
} from './lib/data';

type Session = {
  market: MarketData;
  cursor: number;
  startCursor: number;
  account: TradingState;
};
type Dialog =
  'data' | 'settings' | 'help' | 'reset' | 'indicators' | 'compare' | null;
const STORAGE_KEY = 'replay-market-lab:v1';
const DEFAULT_CONFIG: EngineConfig = {
  initialCapital: 100000,
  commissionBps: 1,
  slippageBps: 1,
};
const WATCHLIST = [
  { ticker: 'AAPL', name: 'Apple', color: '#aebacb' },
  { ticker: 'NVDA', name: 'NVIDIA', color: '#9bc85e' },
  { ticker: 'MSFT', name: 'Microsoft', color: '#78afe8' },
  { ticker: 'TSLA', name: 'Tesla', color: '#ed8690' },
  { ticker: 'SPY', name: 'S&P 500 ETF', color: '#bb9bfc' },
  { ticker: 'BTC-USD', name: 'Bitcoin', color: '#e8b66d' },
];

function freshSession(
  market: MarketData,
  config = DEFAULT_CONFIG,
  at?: number,
): Session {
  const startCursor = Math.max(
    0,
    Math.min(
      at ?? Math.min(90, Math.floor(market.bars.length * 0.3)),
      market.bars.length - 1,
    ),
  );
  return {
    market,
    cursor: startCursor,
    startCursor,
    account: advanceBar(createAccount(config), market.bars[startCursor]),
  };
}

function initialSession(): Session {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || 'null',
    ) as Session | null;
    if (isValidSession(value)) return value;
  } catch {
    /* A missing or damaged saved session starts a fresh demo. */
  }
  return freshSession(createDemo());
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function App() {
  useMobileViewport();
  const [session, setSession] = useState<Session>(initialSession);
  const { market, cursor, startCursor, account } = session;
  const bar = market.bars[cursor];
  const [playing, setPlaying] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [mobileSection, setMobileSection] = useState('chart');
  const [speed, setSpeed] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tab, setTab] = useState<'overview' | 'trades' | 'orders'>('overview');
  const [side, setSide] = useState<Side>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [quantity, setQuantity] = useState('10');
  const [orderPrice, setOrderPrice] = useState('');
  const [showVolume, setShowVolume] = useState(true);
  const marketKey = `${market.source}:${market.ticker}:${market.interval}`;
  const chartWorkspace = useChartWorkspace(marketKey);
  const comparisons = useComparisons(market);
  const [comparisonSlot, setComparisonSlot] = useState(0);
  const benchmark = comparisons[comparisonSlot];
  const activeComparisonCount = comparisons.filter(
    (item) => item.ticker,
  ).length;
  const chartDisplay = useChartDisplay();
  const [benchmarkSymbol, setBenchmarkSymbol] = useState('SPY');
  const [comparisonError, setComparisonError] = useState('');
  const comparisonDialogRef = useRef(0);
  const comparisonLoadsRef = useRef(new Map<number, { ticker: string }>());
  const openComparison = (
    slot = comparisons.findIndex((item) => !item.ticker && !item.loading),
  ) => {
    if (slot < 0) return;
    comparisonDialogRef.current += 1;
    setComparisonSlot(slot);
    setBenchmarkSymbol(
      comparisons[slot].ticker ||
        ['SPY', 'QQQ', 'DIA', 'IWM', 'BTC-USD'].find(
          (symbol) =>
            symbol !== market.ticker &&
            !comparisons.some((item) => item.ticker === symbol),
        ) ||
        '',
    );
    comparisons[slot].clearError();
    setComparisonError('');
    setDialog('compare');
  };
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('cursor');
  const [drawingColor, setDrawingColor] = useState('#b29aff');
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(
    null,
  );
  const visibleDrawings = useMemo(
    () =>
      chartWorkspace.drawings.filter((drawing) =>
        drawing.points.every((point) => point.time <= bar.time),
      ),
    [chartWorkspace.drawings, bar.time],
  );
  const selectedDrawing = visibleDrawings.find(
    (drawing) => drawing.id === selectedDrawingId,
  );
  const onDrawingsChange = (next: Drawing[]) => {
    const hidden = chartWorkspace.drawings.filter((drawing) =>
      drawing.points.some((point) => point.time > bar.time),
    );
    chartWorkspace.changeDrawings([...hidden, ...next]);
  };
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [hoverBar, setHoverBar] = useState<Candle | null>(null);
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [ticker, setTicker] = useState(market.ticker);
  const [interval, setIntervalValue] = useState(market.interval);
  const [period, setPeriod] = useState(defaultPeriod(market.interval));
  const [customRange, setCustomRange] = useState(false);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [capital, setCapital] = useState(String(account.config.initialCapital));
  const [commission, setCommission] = useState(
    String(account.config.commissionBps),
  );
  const [slippage, setSlippage] = useState(String(account.config.slippageBps));
  const [resetTarget, setResetTarget] = useState(startCursor);
  const [saved, setSaved] = useState(true);
  const chartPanel = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousOrders = useRef(account.orders);
  const scrollToSection = (section: 'chart' | 'trade' | 'performance') => {
    setMobileSection(section);
    document
      .getElementById(`mobile-${section}`)
      ?.scrollIntoView({ block: 'start' });
  };
  const openSettings = () => {
    setCapital(String(account.config.initialCapital));
    setCommission(String(account.config.commissionBps));
    setSlippage(String(account.config.slippageBps));
    setDialog('settings');
  };
  const metrics = getMetrics(account, bar.close);
  const visibleBars = useMemo(
    () => market.bars.slice(0, cursor + 1),
    [market.bars, cursor],
  );
  const normalizedView = useMemo(
    () =>
      computeMultiNormalizedView(
        visibleBars,
        comparisons.map((item) => item.data?.bars ?? null),
        {
          normalization: chartDisplay.normalization,
          scale: chartDisplay.scale,
          window: chartDisplay.window,
        },
      ),
    [
      visibleBars,
      comparisons[0].data,
      comparisons[1].data,
      comparisons[2].data,
      comparisons[3].data,
      chartDisplay.normalization,
      chartDisplay.scale,
      chartDisplay.window,
    ],
  );
  const chartComparisons = useMemo(
    () =>
      comparisons.flatMap((item, index) => {
        const result = normalizedView.comparisons[index];
        return item.data && result
          ? [
              {
                ticker: item.data.ticker,
                color: item.color,
                anchor: result.anchor,
                points: result.points,
              },
            ]
          : [];
      }),
    [
      normalizedView,
      comparisons[0].data,
      comparisons[1].data,
      comparisons[2].data,
      comparisons[3].data,
      comparisons[0].color,
      comparisons[1].color,
      comparisons[2].color,
      comparisons[3].color,
    ],
  );
  const filled = account.orders.filter((order) => order.status === 'filled');
  const pending = account.orders.filter((order) => order.status === 'pending');
  const displayBar = hoverBar ?? bar;
  const previousClose = cursor > 0 ? market.bars[cursor - 1].close : bar.open;
  const change = bar.close - previousClose;
  const intraday = !['1d', '5d', '1wk', '1mo', '3mo'].includes(market.interval);
  const money = useCallback(
    (value: number, digits = 2) => {
      const currency = market.currency;
      const options = {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      };
      if (currency && /^[A-Z]{3}$/.test(currency)) {
        return new Intl.NumberFormat('en-US', {
          ...options,
          style: 'currency',
          currency,
        }).format(value);
      }
      // Yahoo uses case-sensitive subunits such as GBp and ZAc; preserve them.
      return `${new Intl.NumberFormat('en-US', options).format(value)}${currency ? ` ${currency}` : ''}`;
    },
    [market.currency],
  );
  const quoteDigits =
    bar.close < 0.01 ? 8 : bar.close < 10 ? 5 : bar.close < 100 ? 3 : 2;
  const quote = (value: number) => money(value, quoteDigits);
  const signed = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
  const price = (value: number) =>
    value.toLocaleString('en-US', {
      minimumFractionDigits: quoteDigits,
      maximumFractionDigits: quoteDigits,
    });
  const tone = (value: number) =>
    value > 0 ? 'positive' : value < 0 ? 'negative' : '';

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [session]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const pause = () => setPlaying(false);
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pause);
    window.addEventListener('replay:pause', pause);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('replay:pause', pause);
    };
  }, []);

  const overlayOpen = Boolean(dialog) || chartExpanded;
  useEffect(() => {
    if (!overlayOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `${-scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      Object.assign(body.style, previous);
      window.scrollTo(0, scrollY);
    };
  }, [overlayOpen]);

  useEffect(() => {
    if (!chartExpanded || dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    chartPanel.current
      ?.querySelector<HTMLButtonElement>('[aria-label="Exit fullscreen chart"]')
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setChartExpanded(false);
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        chartPanel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [chartExpanded, dialog]);

  const step = useCallback(() => {
    setSession((previous) => {
      const next = previous.cursor + 1;
      if (next >= previous.market.bars.length) return previous;
      return {
        ...previous,
        cursor: next,
        account: advanceBar(previous.account, previous.market.bars[next]),
      };
    });
    setHoverBar(null);
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (cursor >= market.bars.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setInterval(step, 1000 / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, step, cursor, market.bars.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        dialog ||
        target.closest('input,select,textarea,button,[contenteditable="true"]')
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault();
        setPlaying(false);
        step();
      }
      if (event.key.toLowerCase() === 'b') setSide('buy');
      if (event.key.toLowerCase() === 's') setSide('sell');
      if (event.key === '?') setDialog('help');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, step]);

  useEffect(() => {
    if (!dialog) return;
    setPlaying(false);
    const previousFocus = document.activeElement as HTMLElement | null;
    const timeout = window.setTimeout(
      () =>
        modalRef.current
          ?.querySelector<HTMLElement>(
            'input:not(:disabled),button:not(:disabled),select:not(:disabled)',
          )
          ?.focus(),
      0,
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) setDialog(null);
      if (event.key !== 'Tab') return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]',
      );
      if (!focusable?.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('keydown', onKey);
      previousFocus?.focus();
    };
  }, [dialog, loading]);

  useEffect(() => {
    const before = new Map(
      previousOrders.current.map((order) => [order.id, order.status]),
    );
    previousOrders.current = account.orders;
    const changed = account.orders.filter(
      (order) => before.get(order.id) !== order.status,
    );
    const result = changed.at(-1);
    if (!result) return;
    const action = result.side === 'buy' ? 'Buy' : 'Sell';
    const text =
      result.status === 'rejected'
        ? result.reason || 'Order rejected.'
        : result.status === 'pending'
          ? `${action} ${result.type} order placed for ${result.quantity} ${market.ticker}.`
          : result.status === 'cancelled'
            ? 'Order cancelled.'
            : `${result.side === 'buy' ? 'Bought' : 'Sold'} ${result.quantity} ${market.ticker} at ${money(result.fillPrice!)}.`;
    setNotice({ text, error: result.status === 'rejected' });
  }, [account.orders, market.ticker, money]);

  useEffect(() => {
    setDrawingTool('cursor');
    setSelectedDrawingId(null);
  }, [marketKey]);

  function openData(
    nextTicker = market.ticker,
    nextInterval = market.interval,
  ) {
    setTicker(nextTicker);
    setIntervalValue(nextInterval);
    setPeriod(defaultPeriod(nextInterval));
    setDataError('');
    setDialog('data');
  }

  async function loadData(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setDataError('');
    setPlaying(false);
    try {
      const params: Record<string, string> = {
        ticker: ticker.trim().toUpperCase(),
        interval,
      };
      if (customRange) {
        params.start = rangeStart;
        if (rangeEnd) params.end = rangeEnd;
      } else params.period = period;
      const nextMarket = await fetchMarketData(params);
      setSession(freshSession(nextMarket, account.config));
      setDrawingTool('cursor');
      setSelectedDrawingId(null);
      setHoverBar(null);
      setOrderPrice('');
      setTab('overview');
      setDialog(null);
      setNotice({
        text: `${nextMarket.bars.length.toLocaleString()} candles loaded for ${nextMarket.ticker}. Ready to replay.`,
      });
    } catch (error) {
      setDataError(
        error instanceof Error
          ? error.message
          : 'Unable to fetch market data. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  function placeOrder(event: React.FormEvent) {
    event.preventDefault();
    const request = {
      side,
      type: orderType,
      quantity: Number(quantity),
      ...(orderType === 'market' ? {} : { price: Number(orderPrice) }),
    };
    setSession((previous) => ({
      ...previous,
      account: submitOrder(
        previous.account,
        request,
        previous.market.bars[previous.cursor],
      ),
    }));
  }

  function seek(target: number) {
    setPlaying(false);
    setHoverBar(null);
    if (target < cursor) {
      setResetTarget(target);
      setDialog('reset');
      return;
    }
    setSession((previous) => {
      let nextAccount = previous.account;
      for (let i = previous.cursor + 1; i <= target; i++)
        nextAccount = advanceBar(nextAccount, previous.market.bars[i]);
      return { ...previous, cursor: target, account: nextAccount };
    });
  }

  function reset(at = startCursor, config = account.config) {
    setPlaying(false);
    setSession(freshSession(market, config, at));
    setDrawingTool('cursor');
    setSelectedDrawingId(null);
    setHoverBar(null);
    setDialog(null);
    setTab('overview');
    setNotice({ text: 'Fresh account. Your new replay session is ready.' });
  }

  function exportSession() {
    exportCsv(
      [
        [
          'Replay session',
          market.ticker,
          market.interval,
          market.source,
          market.currency ?? 'Currency unavailable',
        ],
        ['As of (UTC)', new Date(bar.time * 1000).toISOString()],
        ['Starting capital', account.config.initialCapital],
        ['Equity', metrics.equity],
        ['Realized P&L', metrics.realizedPnl],
        ['Unrealized P&L', metrics.unrealizedPnl],
        ['Total P&L', metrics.totalPnl],
        ['Fees paid', metrics.feesPaid],
        ['Max drawdown (%)', metrics.maxDrawdown],
        [],
        [
          'Order ID',
          'Side',
          'Type',
          'Quantity',
          'Requested price',
          'Status',
          'Created (UTC)',
          'Filled (UTC)',
          'Fill price',
          'Fee',
          'Realized P&L',
          'Reason',
        ],
        ...account.orders.map((order) => [
          order.id,
          order.side,
          order.type,
          order.quantity,
          order.price,
          order.status,
          new Date(order.createdAt * 1000).toISOString(),
          order.filledAt ? new Date(order.filledAt * 1000).toISOString() : '',
          order.fillPrice,
          order.fee,
          order.status === 'filled'
            ? (order.realizedPnl ?? -(order.fee ?? 0))
            : undefined,
          order.reason,
        ]),
        [],
        ['Equity date (UTC)', 'Equity'],
        ...account.equityHistory.map((point) => [
          new Date(point.time * 1000).toISOString(),
          point.equity,
        ]),
      ],
      `replay-${market.ticker}-${new Date(bar.time * 1000).toISOString().slice(0, 10)}.csv`,
    );
    setNotice({
      text: 'Session summary, orders, and equity history exported.',
    });
  }

  return (
    <div className="app-shell">
      <aside className="rail" inert={Boolean(dialog)}>
        <a className="brand-mark" href="#workspace" aria-label="Replay home">
          <span />
          <Play size={20} fill="currentColor" />
        </a>
        <div className="rail-main">
          <IconButton
            label="Replay workspace"
            active={tab === 'overview'}
            onClick={() => setTab('overview')}
          >
            <CandlestickChart />
          </IconButton>
          <IconButton
            label="Trade history"
            active={tab === 'trades'}
            onClick={() => setTab('trades')}
          >
            <History />
          </IconButton>
          <IconButton
            label="Open orders"
            active={tab === 'orders'}
            onClick={() => setTab('orders')}
          >
            <Layers3 />
          </IconButton>
          <span className="rail-divider" />
          <IconButton label="Load market data" onClick={() => openData()}>
            <Database />
          </IconButton>
        </div>
        <div className="rail-bottom">
          <IconButton
            label="How replay works"
            onClick={() => setDialog('help')}
          >
            <CircleHelp />
          </IconButton>
          <IconButton label="Account settings" onClick={openSettings}>
            <Settings2 />
          </IconButton>
          <div className="avatar" title="Local paper trading account">
            YO
          </div>
        </div>
      </aside>

      <div className="app-main" id="workspace" inert={Boolean(dialog)}>
        <header className="topbar">
          <div className="wordmark">
            replay<span className="wordmark-dot">.</span>
            <span className="wordmark-divider" />
            <span className="product-label">MARKET LAB</span>
          </div>
          <div className="topbar-links">
            <button
              className="topbar-link selected"
              onClick={() => setTab('overview')}
            >
              Workspace
            </button>
            <button className="topbar-link" onClick={() => setDialog('help')}>
              How it works <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <i /> Paper trading
            </span>
            <span className="local-badge">LOCAL WORKSPACE</span>
            <div className="mobile-header-actions">
              <IconButton
                label="Mobile account settings"
                onClick={openSettings}
              >
                <Settings2 size={20} />
              </IconButton>
              <IconButton label="Mobile help" onClick={() => setDialog('help')}>
                <CircleHelp size={20} />
              </IconButton>
            </div>
          </div>
        </header>

        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">THE MARKET, ON YOUR TERMS</div>
              <h1>
                Market replay <span>Go back. Trade forward.</span>
              </h1>
            </div>
            <div className="heading-actions">
              <button className="button ghost" onClick={exportSession}>
                <Download size={15} /> Export session
              </button>
              <button className="button primary" onClick={() => openData()}>
                <Plus size={17} /> Load market data
              </button>
            </div>
          </div>

          <div className="watchlist">
            <span className="watchlist-label">
              <Activity size={14} /> QUICK SELECT
            </span>
            {WATCHLIST.map((item) => (
              <button
                key={item.ticker}
                className={`watch-item ${market.ticker === item.ticker ? 'selected' : ''}`}
                onClick={() => openData(item.ticker)}
              >
                <span
                  className="watch-icon"
                  style={{
                    color: item.color,
                    backgroundColor: `${item.color}15`,
                  }}
                >
                  {item.ticker === 'BTC-USD' ? '₿' : item.ticker.slice(0, 1)}
                </span>
                <strong>
                  {item.ticker === 'BTC-USD' ? 'BTC' : item.ticker}
                </strong>
                <span className="watch-name">{item.name}</span>
                {market.ticker === item.ticker && (
                  <span className="watch-dot" />
                )}
              </button>
            ))}
            <IconButton
              label="Search for another ticker"
              onClick={() => openData()}
            >
              <Plus size={16} />
            </IconButton>
          </div>

          <div className="trading-layout">
            <section
              className={`chart-panel panel ${chartExpanded ? 'chart-expanded' : ''}`}
              id="mobile-chart"
              role={chartExpanded ? 'dialog' : undefined}
              aria-modal={chartExpanded ? true : undefined}
              aria-label={chartExpanded ? 'Expanded chart' : undefined}
              ref={chartPanel}
              style={{
                minHeight:
                  740 +
                  chartWorkspace.oscillatorCount * 115 +
                  activeComparisonCount * 110,
              }}
            >
              {chartExpanded && (
                <div className="chart-expanded-heading">
                  <strong>
                    {market.ticker} · {market.interval} · Chart
                  </strong>
                  <IconButton
                    label="Exit fullscreen chart"
                    onClick={() => setChartExpanded(false)}
                  >
                    <X size={20} />
                  </IconButton>
                </div>
              )}
              <div className="chart-toolbar">
                <button className="symbol-picker" onClick={() => openData()}>
                  <Search size={15} />
                  <strong>{market.ticker}</strong>
                  <ChevronDown size={13} />
                </button>
                <span className="toolbar-separator" />
                <div className="interval-buttons">
                  {[
                    ['5m', '5m'],
                    ['15m', '15m'],
                    ['60m', '1h'],
                    ['1d', '1D'],
                    ['1wk', '1W'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={market.interval === value ? 'selected' : ''}
                      onClick={() => {
                        if (value !== market.interval)
                          openData(market.ticker, value);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  className="extra-interval"
                  onClick={() => openData()}
                  title="All intervals"
                >
                  <ChevronDown size={14} />
                </button>
                <span className="toolbar-separator" />
                <IconButton
                  label={
                    chartType === 'candles'
                      ? 'Switch to line chart'
                      : 'Switch to candlestick chart'
                  }
                  onClick={() =>
                    setChartType((value) =>
                      value === 'candles' ? 'line' : 'candles',
                    )
                  }
                  active={chartType === 'line'}
                >
                  {chartType === 'candles' ? (
                    <CandlestickChart size={17} />
                  ) : (
                    <LineChart size={17} />
                  )}
                </IconButton>
                <button
                  className={`indicator-button ${chartWorkspace.indicators.length ? 'active' : ''}`}
                  onClick={() => setDialog('indicators')}
                  aria-label="Indicators"
                  title="Add and manage technical indicators"
                >
                  <TrendingUp size={16} />
                  <span>Indicators</span>
                  {chartWorkspace.indicators.length > 0 && (
                    <b>{chartWorkspace.indicators.length}</b>
                  )}
                </button>
                <IconButton
                  label="Toggle volume"
                  active={showVolume}
                  onClick={() => setShowVolume((value) => !value)}
                >
                  <BarChart3 size={17} />
                </IconButton>
                <button
                  className={`indicator-button compare-button ${activeComparisonCount ? 'active' : ''}`}
                  onClick={() => openComparison()}
                  disabled={comparisons.every(
                    (item) => item.ticker || item.loading,
                  )}
                  aria-label="Compare"
                  title={
                    activeComparisonCount >= 4
                      ? 'Maximum 5 tickers: base plus 4 comparisons'
                      : 'Compare with another ticker'
                  }
                >
                  <Plus size={16} />
                  <span>
                    Compare
                    {activeComparisonCount > 0
                      ? ` (${activeComparisonCount + 1}/5)`
                      : ''}
                  </span>
                </button>
                <div className="toolbar-right">
                  <span className="replay-label">
                    <i /> REPLAY MODE
                  </span>
                  <IconButton
                    label="Fullscreen chart"
                    onClick={() => setChartExpanded((value) => !value)}
                    active={chartExpanded}
                  >
                    <Expand size={16} />
                  </IconButton>
                </div>
              </div>

              <div className="chart-heading">
                <div className="instrument-logo">
                  {market.ticker === 'BTC-USD'
                    ? '₿'
                    : market.ticker.slice(0, 1)}
                </div>
                <div>
                  <h2>
                    {market.name || market.ticker}
                    <span>·</span>
                    {market.interval.toUpperCase()}
                    <span className="exchange-label">
                      {market.exchange || 'Yahoo Finance'}
                    </span>
                  </h2>
                  <div className="instrument-price">
                    {quote(bar.close)}
                    <span className={tone(change)}>
                      {change >= 0 ? '+' : ''}
                      {price(change)} (
                      {((change / previousClose) * 100).toFixed(2)}%)
                    </span>
                  </div>
                </div>
                <div
                  className={`data-source ${market.source === 'demo' ? 'demo' : ''}`}
                  title={
                    market.source === 'demo'
                      ? 'Synthetic sample prices, not historical Apple prices'
                      : 'Adjusted historical prices via yfinance'
                  }
                >
                  <i />
                  {market.source === 'demo' ? 'SAMPLE DATA' : 'YAHOO FINANCE'}
                </div>
              </div>
              <div className="ohlc-row">
                <span>
                  O <b>{price(displayBar.open)}</b>
                </span>
                <span>
                  H <b>{price(displayBar.high)}</b>
                </span>
                <span>
                  L <b>{price(displayBar.low)}</b>
                </span>
                <span>
                  C{' '}
                  <b
                    className={
                      displayBar.close >= displayBar.open
                        ? 'positive'
                        : 'negative'
                    }
                  >
                    {price(displayBar.close)}
                  </b>
                </span>
                <span className="volume-label">
                  Vol{' '}
                  <b>
                    {Intl.NumberFormat('en-US', {
                      notation: 'compact',
                      maximumFractionDigits: 2,
                    }).format(displayBar.volume)}
                  </b>
                </span>
              </div>
              {chartWorkspace.indicators.length > 0 && (
                <div
                  className="indicator-legend"
                  aria-label="Active chart indicators"
                >
                  {chartWorkspace.indicators.map((instance) => {
                    const definition = INDICATORS.find(
                      (item) => item.id === instance.indicatorId,
                    )!;
                    return (
                      <div
                        className="indicator-chip"
                        key={instance.id}
                        style={{ color: instance.color }}
                        data-testid="indicator-chip"
                      >
                        <button
                          title={definition.description}
                          onClick={() => setDialog('indicators')}
                        >
                          {definition.shortName}
                          {definition.minPeriod !== definition.maxPeriod
                            ? ` (${instance.period})`
                            : ''}
                        </button>
                        <button
                          aria-label={`Remove ${definition.name} (${instance.period})`}
                          onClick={() =>
                            chartWorkspace.setIndicators(
                              chartWorkspace.indicators.filter(
                                (item) => item.id !== instance.id,
                              ),
                            )
                          }
                        >
                          <X size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <ChartDisplayControls
                settings={chartDisplay}
                view={normalizedView}
                market={market}
                currentPrice={bar.close}
              />
              {comparisons.map((item, index) => (
                <ComparisonControls
                  key={index}
                  base={market}
                  comparison={item}
                  result={
                    normalizedView.comparisons[index] ?? {
                      anchor: null,
                      points: [],
                      latest: null,
                    }
                  }
                  currentTime={bar.time}
                  onEdit={() => openComparison(index)}
                  showError={dialog !== 'compare' || comparisonSlot !== index}
                />
              ))}
              <DrawingToolbar
                tool={drawingTool}
                onTool={(tool) => {
                  setDrawingTool(tool);
                  setPlaying(false);
                  setSelectedDrawingId(null);
                }}
                color={selectedDrawing?.color || drawingColor}
                onColor={(color) => {
                  setDrawingColor(color);
                  if (selectedDrawing)
                    chartWorkspace.changeDrawings(
                      chartWorkspace.drawings.map((item) =>
                        item.id === selectedDrawing.id
                          ? { ...item, color }
                          : item,
                      ),
                    );
                }}
                hasSelection={Boolean(selectedDrawing)}
                hasDrawings={chartWorkspace.drawings.length > 0}
                canUndo={chartWorkspace.canUndo}
                canRedo={chartWorkspace.canRedo}
                onUndo={() => {
                  chartWorkspace.undo();
                  setSelectedDrawingId(null);
                }}
                onRedo={chartWorkspace.redo}
                onDelete={() => {
                  chartWorkspace.changeDrawings(
                    chartWorkspace.drawings.filter(
                      (item) => item.id !== selectedDrawingId,
                    ),
                  );
                  setSelectedDrawingId(null);
                }}
                onClear={() => {
                  chartWorkspace.changeDrawings([]);
                  setSelectedDrawingId(null);
                }}
              />
              <MarketChart
                bars={visibleBars}
                orders={account.orders}
                position={account.position}
                showVolume={showVolume}
                indicators={chartWorkspace.indicators}
                chartType={chartType}
                comparisons={chartComparisons}
                display={normalizedView.display}
                onCrosshair={setHoverBar}
                drawingTool={drawingTool}
                drawings={visibleDrawings}
                onDrawingsChange={onDrawingsChange}
                onDrawingToolComplete={() => setDrawingTool('cursor')}
                drawingColor={drawingColor}
                selectedDrawingId={selectedDrawingId}
                onDrawingSelect={setSelectedDrawingId}
              />
              {!chartWorkspace.saved && (
                <div className="chart-storage-note" role="status">
                  Chart settings cannot be saved in this browser.
                </div>
              )}
              <div className="chart-footer">
                <span>
                  <Crosshair size={12} />
                  {formatDate(bar.time, intraday)}{' '}
                  <span className="muted">UTC</span>
                </span>
                <span>
                  {market.currency || 'Currency unavailable'}{' '}
                  <span className="footer-divider">|</span>{' '}
                  {market.source === 'demo'
                    ? 'Synthetic demo'
                    : 'Adjusted prices'}{' '}
                  <span className="footer-divider">|</span>{' '}
                  <a
                    href="https://www.tradingview.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Charts by TradingView
                  </a>
                </span>
              </div>

              <div className="replay-controls">
                <div className="replay-control-top">
                  <div className="replay-control-title">
                    <span className="replay-icon">
                      <History size={17} />
                    </span>
                    <div>
                      <strong>Bar replay</strong>
                      <span>
                        {playing
                          ? 'Playing through history'
                          : cursor === market.bars.length - 1
                            ? 'End of available history'
                            : 'Your pace. Your decisions.'}
                      </span>
                    </div>
                  </div>
                  <button
                    className="replay-date"
                    onClick={() => {
                      setResetTarget(startCursor);
                      setDialog('reset');
                    }}
                  >
                    <Clock3 size={13} />
                    {formatDate(bar.time, intraday)}
                    <ChevronDown size={13} />
                  </button>
                  <div className="playback-buttons">
                    <IconButton
                      label="Restart replay"
                      onClick={() => {
                        setResetTarget(startCursor);
                        setDialog('reset');
                      }}
                    >
                      <RotateCcw size={16} />
                    </IconButton>
                    <button
                      className={`play-button ${playing ? 'playing' : ''}`}
                      aria-label={playing ? 'Pause replay' : 'Play replay'}
                      title="Play / pause (Space)"
                      disabled={cursor >= market.bars.length - 1}
                      onClick={() => setPlaying((value) => !value)}
                    >
                      {playing ? (
                        <Pause size={17} fill="currentColor" />
                      ) : (
                        <Play size={17} fill="currentColor" />
                      )}
                    </button>
                    <IconButton
                      label="Next candle"
                      disabled={cursor >= market.bars.length - 1}
                      onClick={() => {
                        setPlaying(false);
                        step();
                      }}
                    >
                      <SkipForward size={17} />
                    </IconButton>
                    <select
                      aria-label="Replay speed"
                      className="speed-select"
                      value={speed}
                      onChange={(event) => setSpeed(Number(event.target.value))}
                    >
                      {[0.5, 1, 2, 5, 10].map((value) => (
                        <option key={value} value={value}>
                          {value}×
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="replay-progress">
                  <span>{formatDate(market.bars[0].time)}</span>
                  <input
                    aria-label="Replay timeline"
                    type="range"
                    min={0}
                    max={market.bars.length - 1}
                    value={cursor}
                    style={
                      {
                        '--progress': `${(cursor / (market.bars.length - 1)) * 100}%`,
                      } as React.CSSProperties
                    }
                    onChange={(event) => seek(Number(event.target.value))}
                  />
                  <span>
                    {cursor + 1}
                    <span className="muted"> / {market.bars.length} bars</span>
                  </span>
                </div>
              </div>
            </section>

            <aside className="order-panel panel" id="mobile-trade">
              <div className="panel-title">
                <h2>Order ticket</h2>
                <span className="small-badge">PAPER</span>
              </div>
              <div className="order-market">
                <div>
                  <strong>{market.ticker}</strong>
                  <span>{market.name}</span>
                </div>
                <span className="order-market-price">
                  {quote(bar.close)}
                  <small>Replay price</small>
                </span>
              </div>
              <form onSubmit={placeOrder}>
                <div className="side-switch">
                  <button
                    type="button"
                    className={side === 'buy' ? 'buy selected' : ''}
                    onClick={() => setSide('buy')}
                  >
                    <ArrowDownLeft size={16} /> Buy / Long
                  </button>
                  <button
                    type="button"
                    className={side === 'sell' ? 'sell selected' : ''}
                    onClick={() => setSide('sell')}
                  >
                    <ArrowUpRight size={16} /> Sell / Short
                  </button>
                </div>
                <div className="order-type-tabs">
                  {(['market', 'limit', 'stop'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={orderType === type ? 'selected' : ''}
                      onClick={() => {
                        setOrderType(type);
                        setOrderPrice(bar.close.toFixed(quoteDigits));
                      }}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
                <label className="field-label" htmlFor="quantity">
                  Quantity <span>Units</span>
                </label>
                <div className="quantity-input">
                  <input
                    id="quantity"
                    type="number"
                    inputMode="decimal"
                    min="0.000001"
                    step="any"
                    required
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                  <span>{market.ticker}</span>
                </div>
                <div className="quantity-presets">
                  {[1, 10, 25, 100].map((amount) => (
                    <button
                      type="button"
                      key={amount}
                      className={Number(quantity) === amount ? 'selected' : ''}
                      onClick={() => setQuantity(String(amount))}
                    >
                      {amount}
                    </button>
                  ))}
                </div>
                {orderType !== 'market' && (
                  <>
                    <label className="field-label" htmlFor="order-price">
                      {orderType === 'limit' ? 'Limit price' : 'Stop trigger'}{' '}
                      <span>{market.currency || 'Currency unavailable'}</span>
                    </label>
                    <input
                      id="order-price"
                      className="text-input"
                      type="number"
                      inputMode="decimal"
                      min="0.000001"
                      step="any"
                      required
                      value={orderPrice}
                      onChange={(event) => setOrderPrice(event.target.value)}
                    />
                  </>
                )}
                <div className="order-estimate">
                  <div>
                    <span>Est. order value</span>
                    <strong>
                      {money(
                        (Number(quantity) || 0) *
                          (orderType === 'market'
                            ? bar.close
                            : Number(orderPrice) || 0),
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Commission</span>
                    <span>{account.config.commissionBps / 100}%</span>
                  </div>
                  <div>
                    <span>
                      Buying power{' '}
                      <span title="1× account equity less open exposure. Short sales require equity coverage.">
                        <CircleHelp size={11} />
                      </span>
                    </span>
                    <span>{money(metrics.buyingPower)}</span>
                  </div>
                </div>
                <button className={`submit-order ${side}`} type="submit">
                  {side === 'buy' ? (
                    <Plus size={17} />
                  ) : (
                    <ArrowUpRight size={17} />
                  )}
                  {side === 'buy' ? 'Buy' : 'Sell'} {market.ticker}
                  <span>{orderType.toUpperCase()}</span>
                </button>
                <p className="execution-note">
                  {orderType === 'market'
                    ? 'Fills at this candle’s close, plus slippage.'
                    : 'Eligible from the next candle. Gaps fill at the open.'}
                </p>
              </form>
              <div className="position-card">
                <div className="position-title">
                  <span>Your position</span>
                  <span
                    className={`position-badge ${account.position.quantity === 0 ? '' : account.position.quantity > 0 ? 'long' : 'short'}`}
                  >
                    {account.position.quantity === 0
                      ? 'FLAT'
                      : account.position.quantity > 0
                        ? 'LONG'
                        : 'SHORT'}
                  </span>
                </div>
                {account.position.quantity !== 0 ? (
                  <>
                    <div className="position-amount">
                      {Math.abs(account.position.quantity).toLocaleString()}{' '}
                      <span>{market.ticker}</span>
                    </div>
                    <div className="position-detail">
                      <span>Average entry</span>
                      <span>{quote(account.position.averagePrice)}</span>
                    </div>
                    <div className="position-detail">
                      <span>Unrealized P&L</span>
                      <strong className={tone(metrics.unrealizedPnl)}>
                        {signed(metrics.unrealizedPnl)}
                      </strong>
                    </div>
                    <button
                      className="close-position"
                      onClick={() => {
                        setSession((previous) => ({
                          ...previous,
                          account: closePosition(
                            previous.account,
                            previous.market.bars[previous.cursor],
                          ),
                        }));
                      }}
                    >
                      Close position <X size={13} />
                    </button>
                  </>
                ) : (
                  <div className="empty-position">
                    <Wallet size={23} />
                    <span>A clean slate.</span>
                    <small>Place an order to open a position.</small>
                  </div>
                )}
              </div>
              <div className="account-footnote">
                <span className="shield-dot">
                  <Check size={11} />
                </span>
                Virtual funds. Real practice.
              </div>
            </aside>
          </div>

          <section className="performance-panel panel" id="mobile-performance">
            <div className="performance-header">
              <div className="performance-tabs">
                <button
                  className={tab === 'overview' ? 'selected' : ''}
                  onClick={() => setTab('overview')}
                >
                  <Activity size={15} />
                  Performance
                </button>
                <button
                  className={tab === 'trades' ? 'selected' : ''}
                  onClick={() => setTab('trades')}
                >
                  Trade history <span>{filled.length}</span>
                </button>
                <button
                  className={tab === 'orders' ? 'selected' : ''}
                  onClick={() => setTab('orders')}
                >
                  Orders <span>{pending.length}</span>
                </button>
              </div>
              <div className="performance-header-right">
                <span className="saved-status">
                  <i />
                  {saved ? 'Saved locally' : 'Storage unavailable'}
                </span>
                <IconButton
                  label="Export performance CSV"
                  onClick={exportSession}
                >
                  <ArrowDownToLine size={16} />
                </IconButton>
              </div>
            </div>
            {tab === 'overview' ? (
              <>
                <div className="metrics-grid">
                  <div className="metric">
                    <span>
                      Account equity <Wallet size={13} />
                    </span>
                    <strong>{money(metrics.equity)}</strong>
                    <small>
                      Started with {money(account.config.initialCapital, 0)}
                    </small>
                  </div>
                  <div className="metric">
                    <span>
                      Total P&L <TrendingUp size={13} />
                    </span>
                    <strong className={tone(metrics.totalPnl)}>
                      {signed(metrics.totalPnl)}
                      <em>
                        {metrics.returnPct >= 0 ? '+' : ''}
                        {metrics.returnPct.toFixed(2)}%
                      </em>
                    </strong>
                    <small>Realized + unrealized, after fees</small>
                  </div>
                  <div className="metric">
                    <span>
                      Realized P&L <Check size={13} />
                    </span>
                    <strong className={tone(metrics.realizedPnl)}>
                      {signed(metrics.realizedPnl)}
                    </strong>
                    <small>
                      {metrics.closedTrades} closing{' '}
                      {metrics.closedTrades === 1 ? 'trade' : 'trades'}
                    </small>
                  </div>
                  <div className="metric">
                    <span>
                      Win rate <Crosshair size={13} />
                    </span>
                    <strong>
                      {metrics.closedTrades
                        ? `${metrics.winRate.toFixed(1)}%`
                        : '—'}
                      <em className="neutral">
                        {metrics.closedTrades
                          ? 'CLOSED TRADES'
                          : 'NO CLOSED TRADES'}
                      </em>
                    </strong>
                    <small>
                      Max. drawdown <b>{metrics.maxDrawdown.toFixed(2)}%</b>
                    </small>
                  </div>
                </div>
                <div className="equity-section">
                  <div className="equity-label">
                    <span>
                      <span className="purple-dot" />
                      Equity curve
                    </span>
                    <small>
                      {formatDate(market.bars[startCursor].time)} —{' '}
                      {formatDate(bar.time)}
                    </small>
                  </div>
                  <div className="equity-chart-container">
                    <EquityChart
                      points={account.equityHistory}
                      initialCapital={account.config.initialCapital}
                    />
                  </div>
                  <div className="equity-stats">
                    <span>
                      Unrealized P&L{' '}
                      <strong className={tone(metrics.unrealizedPnl)}>
                        {signed(metrics.unrealizedPnl)}
                      </strong>
                    </span>
                    <span>
                      Fees paid <strong>{money(metrics.feesPaid)}</strong>
                    </span>
                    <span>
                      Gross exposure <strong>{money(metrics.exposure)}</strong>
                    </span>
                    <span>
                      Cash balance <strong>{money(metrics.cash)}</strong>
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>
                        {tab === 'trades' ? 'Filled at (UTC)' : 'Created (UTC)'}
                      </th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Type</th>
                      <th>Quantity</th>
                      <th>{tab === 'trades' ? 'Fill price' : 'Order price'}</th>
                      <th>{tab === 'trades' ? 'Fee' : 'Status'}</th>
                      <th>{tab === 'trades' ? 'Realized P&L' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tab === 'trades' ? filled : account.orders)
                      .slice()
                      .reverse()
                      .map((order) => (
                        <tr key={order.id}>
                          <td>
                            {formatDate(
                              (tab === 'trades'
                                ? order.filledAt
                                : order.createdAt)!,
                              intraday,
                            )}
                          </td>
                          <td className="table-symbol">{market.ticker}</td>
                          <td>
                            <span className={`side-tag ${order.side}`}>
                              {order.side.toUpperCase()}
                            </span>
                          </td>
                          <td className="capitalize">{order.type}</td>
                          <td>{order.quantity}</td>
                          <td>
                            {order.fillPrice != null && tab === 'trades'
                              ? quote(order.fillPrice)
                              : order.price != null
                                ? quote(order.price)
                                : 'Market'}
                          </td>
                          <td>
                            {tab === 'trades' ? (
                              money(order.fee || 0)
                            ) : (
                              <span
                                className={`status-tag ${order.status}`}
                                title={order.reason}
                              >
                                {order.status}
                              </span>
                            )}
                          </td>
                          <td>
                            {tab === 'trades' ? (
                              <span
                                className={tone(
                                  order.realizedPnl ?? -(order.fee ?? 0),
                                )}
                              >
                                {signed(order.realizedPnl ?? -(order.fee ?? 0))}
                              </span>
                            ) : order.status === 'pending' ? (
                              <button
                                className="cancel-order"
                                onClick={() =>
                                  setSession((previous) => ({
                                    ...previous,
                                    account: cancelOrder(
                                      previous.account,
                                      order.id,
                                    ),
                                  }))
                                }
                              >
                                Cancel <X size={12} />
                              </button>
                            ) : (
                              <span className="order-reason">
                                {order.reason || '—'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {(tab === 'trades' ? filled : account.orders).length === 0 && (
                  <div className="table-empty">
                    <BookOpen size={27} />
                    <strong>
                      {tab === 'trades'
                        ? 'Your trading story starts here'
                        : 'No orders yet'}
                    </strong>
                    <span>
                      {tab === 'trades'
                        ? 'Executed orders will appear here as you trade through history.'
                        : 'Place a market, limit, or stop order using the order ticket.'}
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>
          <footer className="workspace-footer">
            <span>
              <span className="purple-dot" />
              {market.source === 'demo'
                ? 'Demo session · synthetic prices. Load market data for real history.'
                : `Historical data via yfinance · ${market.warnings[0] || 'Simulation uses adjusted prices.'}`}
            </span>
            <button onClick={() => setDialog('help')}>
              Keyboard shortcuts <kbd>?</kbd>
            </button>
          </footer>
        </main>
      </div>

      <nav
        className="mobile-workspace-nav"
        aria-label="Mobile workspace"
        inert={Boolean(dialog) || chartExpanded}
      >
        <button
          type="button"
          aria-label="Go to chart"
          aria-current={mobileSection === 'chart' ? 'true' : undefined}
          onClick={() => scrollToSection('chart')}
        >
          <CandlestickChart size={21} />
          <span>Chart</span>
        </button>
        <button
          type="button"
          aria-label="Go to order ticket"
          aria-current={mobileSection === 'trade' ? 'true' : undefined}
          onClick={() => scrollToSection('trade')}
        >
          <Wallet size={21} />
          <span>Trade</span>
        </button>
        <button
          type="button"
          aria-label="Go to performance"
          aria-current={mobileSection === 'performance' ? 'true' : undefined}
          onClick={() => scrollToSection('performance')}
        >
          <Activity size={21} />
          <span>Results</span>
        </button>
        <button
          type="button"
          className="mobile-play"
          aria-label={
            playing ? 'Pause from mobile toolbar' : 'Play from mobile toolbar'
          }
          disabled={cursor >= market.bars.length - 1}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? (
            <Pause size={21} />
          ) : (
            <Play size={21} fill="currentColor" />
          )}
          <span>{playing ? 'Pause' : 'Play'}</span>
        </button>
        <button
          type="button"
          aria-label="Next candle from mobile toolbar"
          disabled={cursor >= market.bars.length - 1}
          onClick={() => {
            setPlaying(false);
            step();
          }}
        >
          <SkipForward size={21} />
          <span>Next</span>
        </button>
      </nav>

      {notice && (
        <div className={`toast ${notice.error ? 'error' : ''}`} role="status">
          {notice.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{notice.text}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading)
              setDialog(null);
          }}
        >
          <div
            className={`modal ${dialog === 'help' ? 'help-modal' : dialog === 'indicators' ? 'indicators-modal' : ''}`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <div className="modal-heading">
              <span className="modal-icon">
                {dialog === 'data' ? (
                  <Database size={22} />
                ) : dialog === 'help' ? (
                  <BookOpen size={22} />
                ) : dialog === 'reset' ? (
                  <History size={22} />
                ) : (
                  <SlidersHorizontal size={22} />
                )}
              </span>
              <IconButton
                label="Close dialog"
                disabled={loading}
                onClick={() => setDialog(null)}
              >
                <X size={19} />
              </IconButton>
            </div>
            {dialog === 'indicators' && (
              <IndicatorMenu
                indicators={chartWorkspace.indicators}
                onChange={chartWorkspace.setIndicators}
              />
            )}
            {dialog === 'compare' && (
              <>
                <h2 id="dialog-title">Compare symbol</h2>
                <p className="modal-description">
                  Compare up to 5 tickers, including {market.ticker}, using the
                  same {market.interval} candles and history.
                </p>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setComparisonError('');
                    const symbol = benchmarkSymbol.trim().toUpperCase();
                    const generation = comparisonDialogRef.current;
                    if (
                      comparisons.some(
                        (item, index) =>
                          index !== comparisonSlot && item.ticker === symbol,
                      ) ||
                      [...comparisonLoadsRef.current].some(
                        ([slot, request]) =>
                          slot !== comparisonSlot && request.ticker === symbol,
                      )
                    ) {
                      setComparisonError(
                        'That ticker is already on the chart. Choose a different ticker.',
                      );
                      return;
                    }
                    const reservation = { ticker: symbol };
                    comparisonLoadsRef.current.set(comparisonSlot, reservation);
                    const loaded = await benchmark.load(symbol);
                    if (
                      comparisonLoadsRef.current.get(comparisonSlot) ===
                      reservation
                    )
                      comparisonLoadsRef.current.delete(comparisonSlot);
                    if (loaded) {
                      chartDisplay.enableComparisonDefaults();
                      if (comparisonDialogRef.current === generation)
                        setDialog((current) =>
                          current === 'compare' ? null : current,
                        );
                    }
                  }}
                >
                  <label className="field-label" htmlFor="benchmark-ticker">
                    Benchmark ticker
                  </label>
                  <div className="search-input">
                    <Search size={17} />
                    <input
                      id="benchmark-ticker"
                      required
                      autoComplete="off"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="search"
                      maxLength={30}
                      value={benchmarkSymbol}
                      disabled={benchmark.loading}
                      placeholder="SPY, QQQ, BTC-USD…"
                      onChange={(event) =>
                        setBenchmarkSymbol(event.target.value.toUpperCase())
                      }
                    />
                  </div>
                  <div className="ticker-suggestions">
                    {['SPY', 'QQQ', 'DIA', 'IWM', 'BTC-USD']
                      .filter(
                        (symbol) =>
                          symbol !== market.ticker &&
                          !comparisons.some(
                            (item, index) =>
                              index !== comparisonSlot &&
                              item.ticker === symbol,
                          ),
                      )
                      .map((symbol) => (
                        <button
                          key={symbol}
                          type="button"
                          disabled={benchmark.loading}
                          onClick={() => setBenchmarkSymbol(symbol)}
                        >
                          {symbol}
                        </button>
                      ))}
                  </div>
                  <div className="info-box">
                    <LineChart size={18} />
                    <span>
                      All tickers share the chart display controls and matching
                      timestamps. Compare relative returns or normalize a window
                      of shared candles. Orders stay on {market.ticker}.
                    </span>
                  </div>
                  {(comparisonError || benchmark.error) && (
                    <div className="form-error" role="alert">
                      {comparisonError || benchmark.error}
                    </div>
                  )}
                  <button
                    className="button primary modal-submit"
                    type="submit"
                    disabled={benchmark.loading}
                  >
                    {benchmark.loading ? (
                      <>
                        <LoaderCircle className="spin" size={17} />
                        Loading benchmark…
                      </>
                    ) : (
                      <>
                        {benchmark.ticker
                          ? 'Update comparison'
                          : 'Add comparison'}
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </form>
              </>
            )}
            {dialog === 'data' && (
              <>
                <h2 id="dialog-title">Find your market.</h2>
                <p className="modal-description">
                  Load historical candles from Yahoo Finance and start a new
                  replay session.
                </p>
                <form onSubmit={loadData}>
                  <label className="field-label" htmlFor="ticker">
                    Ticker symbol
                  </label>
                  <div className="search-input">
                    <Search size={17} />
                    <input
                      id="ticker"
                      required
                      autoComplete="off"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="search"
                      maxLength={30}
                      value={ticker}
                      placeholder="AAPL, MSFT, BTC-USD, EURUSD=X…"
                      onChange={(event) =>
                        setTicker(event.target.value.toUpperCase())
                      }
                    />
                  </div>
                  <div className="ticker-suggestions">
                    {['AAPL', 'NVDA', 'SPY', 'BTC-USD', 'EURUSD=X'].map(
                      (symbol) => (
                        <button
                          key={symbol}
                          type="button"
                          onClick={() => setTicker(symbol)}
                        >
                          {symbol}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="form-row">
                    <div>
                      <label className="field-label" htmlFor="interval">
                        Candle interval
                      </label>
                      <select
                        id="interval"
                        className="text-input"
                        value={interval}
                        onChange={(event) => {
                          setIntervalValue(event.target.value);
                          setPeriod(defaultPeriod(event.target.value));
                        }}
                      >
                        {INTERVALS.map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field-label" htmlFor="period">
                        History range
                      </label>
                      <select
                        id="period"
                        className="text-input"
                        value={customRange ? 'custom' : period}
                        onChange={(event) => {
                          setCustomRange(event.target.value === 'custom');
                          if (event.target.value !== 'custom')
                            setPeriod(event.target.value);
                        }}
                      >
                        {[
                          ['1d', '1 day'],
                          ['5d', '5 days'],
                          ['1mo', '1 month'],
                          ['3mo', '3 months'],
                          ['6mo', '6 months'],
                          ['1y', '1 year'],
                          ['2y', '2 years'],
                          ['5y', '5 years'],
                          ['10y', '10 years'],
                          ['max', 'All available'],
                          ['custom', 'Custom dates'],
                        ].map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {customRange && (
                    <div className="form-row">
                      <div>
                        <label className="field-label" htmlFor="range-start">
                          Start date
                        </label>
                        <input
                          id="range-start"
                          className="text-input"
                          required
                          type="date"
                          value={rangeStart}
                          onChange={(event) =>
                            setRangeStart(event.target.value)
                          }
                        />
                      </div>
                      <div>
                        <label className="field-label" htmlFor="range-end">
                          End date (exclusive)
                        </label>
                        <input
                          id="range-end"
                          className="text-input"
                          required
                          type="date"
                          value={rangeEnd}
                          onChange={(event) => setRangeEnd(event.target.value)}
                        />
                      </div>
                    </div>
                  )}
                  <div className="info-box">
                    <Clock3 size={16} />
                    <span>
                      {interval === '1m'
                        ? '1-minute data is limited to recent history and a 7-day window.'
                        : ['2m', '5m', '15m', '30m', '90m'].includes(interval)
                          ? 'Intraday data is available within the last 60 days.'
                          : ['60m', '1h'].includes(interval)
                            ? 'Hourly data is available within the last 730 days.'
                            : 'Daily and longer intervals are best for exploring long-term history.'}{' '}
                      Loading data resets your account and orders.
                    </span>
                  </div>
                  {dataError && (
                    <div className="form-error" role="alert">
                      {dataError}
                    </div>
                  )}
                  <button
                    className="button primary modal-submit"
                    disabled={loading}
                    type="submit"
                  >
                    {loading ? (
                      <>
                        <LoaderCircle className="spin" size={17} />
                        Fetching market history…
                      </>
                    ) : (
                      <>
                        Load & start replay <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </form>
                <button
                  className="demo-link"
                  disabled={loading}
                  onClick={() => {
                    setSession(freshSession(createDemo(), account.config));
                    setDrawingTool('cursor');
                    setSelectedDrawingId(null);
                    setHoverBar(null);
                    setDialog(null);
                    setTab('overview');
                  }}
                >
                  Explore with synthetic sample data <ChevronRight size={13} />
                </button>
              </>
            )}
            {dialog === 'settings' && (
              <>
                <h2 id="dialog-title">Make it your account.</h2>
                <p className="modal-description">
                  Set your starting balance and execution costs. Applying
                  settings starts a fresh account at this candle.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    try {
                      reset(cursor, {
                        initialCapital: Number(capital),
                        commissionBps: Number(commission),
                        slippageBps: Number(slippage),
                      });
                    } catch (error) {
                      setNotice({
                        text:
                          error instanceof Error
                            ? error.message
                            : 'Invalid settings',
                        error: true,
                      });
                    }
                  }}
                >
                  <label className="field-label" htmlFor="capital">
                    Starting balance{' '}
                    <span>{market.currency || 'Currency unavailable'}</span>
                  </label>
                  <input
                    id="capital"
                    required
                    className="text-input"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    max="1000000000000"
                    step="any"
                    value={capital}
                    onChange={(event) => setCapital(event.target.value)}
                  />
                  <div className="form-row">
                    <div>
                      <label className="field-label" htmlFor="commission">
                        Commission (bps)
                      </label>
                      <input
                        id="commission"
                        required
                        className="text-input"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="1000"
                        step="any"
                        value={commission}
                        onChange={(event) => setCommission(event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="slippage">
                        Slippage (bps)
                      </label>
                      <input
                        id="slippage"
                        required
                        className="text-input"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="1000"
                        step="any"
                        value={slippage}
                        onChange={(event) => setSlippage(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="info-box">
                    <CircleHelp size={16} />
                    <span>
                      1 basis point = 0.01%. Commission applies to every fill.
                      Slippage applies to market and stop orders. Exposure is
                      limited to 1× equity when opening positions.
                    </span>
                  </div>
                  <button className="button primary modal-submit" type="submit">
                    Apply & start fresh <ArrowRight size={17} />
                  </button>
                </form>
              </>
            )}
            {dialog === 'reset' && (
              <>
                <h2 id="dialog-title">A new starting point.</h2>
                <p className="modal-description">
                  Choose where to begin. Your balance returns to{' '}
                  {money(account.config.initialCapital)} and all positions,
                  orders, and performance are cleared.
                </p>
                <label className="field-label" htmlFor="replay-start">
                  Replay starts on
                </label>
                <input
                  id="replay-start"
                  className="text-input"
                  type={intraday ? 'datetime-local' : 'date'}
                  value={new Date(market.bars[resetTarget].time * 1000)
                    .toISOString()
                    .slice(0, intraday ? 16 : 10)}
                  min={new Date(market.bars[0].time * 1000)
                    .toISOString()
                    .slice(0, intraday ? 16 : 10)}
                  max={new Date(market.bars[market.bars.length - 1].time * 1000)
                    .toISOString()
                    .slice(0, intraday ? 16 : 10)}
                  onChange={(event) => {
                    const target =
                      Date.parse(
                        `${event.target.value}${intraday ? ':00Z' : 'T00:00:00Z'}`,
                      ) / 1000;
                    if (!Number.isFinite(target)) return;
                    const found = market.bars.findIndex(
                      (candle) => candle.time >= target,
                    );
                    setResetTarget(found < 0 ? market.bars.length - 1 : found);
                  }}
                />
                <div className="reset-timeline">
                  <input
                    aria-label="Replay starting candle"
                    type="range"
                    min="0"
                    max={market.bars.length - 1}
                    value={resetTarget}
                    onChange={(event) =>
                      setResetTarget(Number(event.target.value))
                    }
                  />
                  <span>
                    Candle {resetTarget + 1} of {market.bars.length}
                  </span>
                </div>
                <button
                  className="button primary modal-submit"
                  onClick={() => reset(resetTarget)}
                >
                  <RotateCcw size={16} /> Reset account & replay
                </button>
              </>
            )}
            {dialog === 'help' && (
              <>
                <h2 id="dialog-title">Practice with perspective.</h2>
                <p className="modal-description">
                  A focused workspace for testing your trading decisions against
                  historical candles.
                </p>
                <div className="help-steps">
                  <div>
                    <span>01</span>
                    <div>
                      <strong>Pick a market and a moment</strong>
                      <p>
                        Load any Yahoo Finance ticker, choose an interval, then
                        use the replay date to choose a starting candle. Sample
                        data is synthetic and labeled.
                      </p>
                    </div>
                  </div>
                  <div>
                    <span>02</span>
                    <div>
                      <strong>Reveal the market, one bar at a time</strong>
                      <p>
                        Play automatically, change speed, or step forward. The
                        chart and account use only revealed candles. Rewinding
                        resets your trades.
                      </p>
                    </div>
                  </div>
                  <div>
                    <span>03</span>
                    <div>
                      <strong>Trade, review, repeat</strong>
                      <p>
                        Buy opens a long or covers a short; sell closes a long
                        or opens a short. The account supports one instrument
                        and 1× exposure. Pending orders do not reserve funds and
                        are checked for buying power when filled.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="help-model">
                  <strong>How fills work</strong>
                  <p>
                    Market orders execute at the visible close. Limit and stop
                    orders are eligible on later candles; gaps use the opening
                    price. Intrabar fills use OHLC prices, with orders processed
                    in creation order. Slippage and commissions apply as
                    configured. Win rate counts profitable closing fills after
                    that fill’s fee; total P&L includes all fees. Drawdown is
                    measured from initial equity and subsequent marked equity
                    peaks. Short borrow fees, dividends, interest, liquidity,
                    and forced liquidation are not modeled.
                  </p>
                </div>
                <div className="help-model">
                  <strong>Chart studies and drawing tools</strong>
                  <p>
                    Open Indicators to choose from 50 studies. Add multiple
                    copies and adjust periods and colors. Oscillators have
                    separate panes; readings warm up using only revealed
                    candles. Choose a drawing tool, then click endpoints or
                    drag. Parallel channels use a third point for width. Select
                    a drawing to move it or adjust its handles. Delete removes
                    it; Undo and Redo restore edits. Press Escape to cancel
                    placement. Studies and drawings are saved locally, with
                    drawings separated by market and interval.
                  </p>
                </div>
                <div className="keyboard-grid">
                  <span>
                    Play / pause <kbd>Space</kbd>
                  </span>
                  <span>
                    Next candle <kbd>→</kbd>
                  </span>
                  <span>
                    Buy ticket <kbd>B</kbd>
                  </span>
                  <span>
                    Sell ticket <kbd>S</kbd>
                  </span>
                </div>
                <p className="help-storage">
                  Your session is saved in this browser. CSV export includes
                  your orders and equity history. Account values use the
                  ticker’s quote currency; currency conversion is not modeled.
                </p>
                <p className="attribution">
                  TradingView Lightweight Charts™
                  <br />
                  Copyright (с) 2025 TradingView, Inc.{' '}
                  <a
                    href="https://www.tradingview.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    tradingview.com
                  </a>
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

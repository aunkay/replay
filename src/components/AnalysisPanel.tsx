import { useEffect, useMemo, useState } from 'react';
import MarketChart from './MarketChart';
import { panelMarketRequest } from '../lib/panelMarket';
import { createWorkspaceId } from '../lib/workspaceId';
import IndicatorMenu from './IndicatorMenu';
import DrawingToolbar from './DrawingToolbar';
import { fetchMarketData, INTERVALS, type MarketData } from '../lib/data';
import { computeMultiNormalizedView } from '../lib/multiNormalization';
import {
  NORMALIZATION_OPTIONS,
  type ChartDisplaySettings,
} from '../lib/chartNormalization';
import type { IndicatorInstance } from '../lib/indicators';
import type { Drawing, DrawingTool } from '../lib/drawings';
import type { StoredSession } from '../lib/session';
export type PanelSettings = {
  id: string;
  name?: string;
  chartType?: 'candles' | 'line';
  drawingNamespaces?: Record<string, Drawing[]>;
  ticker: string;
  interval: string;
  indicators: IndicatorInstance[];
  drawings: Drawing[];
  normalization: ChartDisplaySettings;
  comparisons: string[];
};
export const newPanel = (ticker: string, interval: string): PanelSettings => ({
  id: createWorkspaceId(),
  ticker,
  interval,
  indicators: [],
  drawings: [],
  normalization: { normalization: 'price', scale: 'linear', window: 100 },
  comparisons: [],
});
export default function AnalysisPanel({
  settings,
  onChange,
  session,
  symbols,
  clock,
  liveStreams,
  blind,
  syncGroup,
  syncCrosshair,
  syncViewport,
}: {
  settings: PanelSettings;
  onChange: (p: PanelSettings) => void;
  session: StoredSession;
  symbols: string[];
  clock: number;
  liveStreams?: any[];
  blind?: boolean;
  syncGroup?: string;
  syncCrosshair?: boolean;
  syncViewport?: boolean;
}) {
  const [market, setMarket] = useState<MarketData | null>(null),
    [benchmarks, setBenchmarks] = useState<MarketData[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [tool, setTool] = useState<DrawingTool>('cursor'),
    [color, setColor] = useState('#b29aff'),
    [selection, setSelection] = useState<string | null>(null),
    [menu, setMenu] = useState(false),
    [expanded, setExpanded] = useState(false),
    [history, setHistory] = useState<{
      past: Drawing[][];
      future: Drawing[][];
    }>({ past: [], future: [] });
  const changeDrawings = (drawings: Drawing[]) => {
    setHistory((old) => ({
      past: [...old.past, settings.drawings].slice(-50),
      future: [],
    }));
    onChange({ ...settings, drawings });
  };
  const switchMarket = (ticker: string, interval: string) => {
    const namespaces = {
      ...settings.drawingNamespaces,
      [`${settings.ticker}:${settings.interval}`]: settings.drawings,
    };
    setHistory({ past: [], future: [] });
    onChange({
      ...settings,
      ticker,
      interval,
      drawingNamespaces: namespaces,
      drawings: namespaces[`${ticker}:${interval}`] ?? [],
      comparisons: settings.comparisons.filter((t) => t !== ticker),
    });
  };
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setLoading(true);
    if (!liveStreams) {
      setMarket(null);
      setBenchmarks([]);
    }
    const load = async (ticker: string) => {
      const live = liveStreams?.find(
        (s) => s.ticker === ticker && s.interval === settings.interval,
      )?.market;
      if (live) return live as MarketData;
      if (liveStreams) return null;
      if (
        ticker === session.market.ticker &&
        settings.interval === session.market.interval
      )
        return session.market;
      return fetchMarketData(
        panelMarketRequest(session.market, ticker, settings.interval),
        controller.signal,
      );
    };
    Promise.all([load(settings.ticker), ...settings.comparisons.map(load)])
      .then(([base, ...others]) => {
        if (!controller.signal.aborted) {
          setMarket(base);
          setBenchmarks(others.filter((m): m is MarketData => m !== null));
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setMarket(null);
          setBenchmarks([]);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    settings.ticker,
    settings.interval,
    settings.comparisons.join(','),
    session.market.ticker,
    session.market.interval,
    session.market.fetchedAt,
    session.market.request?.start,
    session.market.request?.end,
    session.market.request?.period,
    liveStreams,
  ]);
  const bars = useMemo(
    () =>
      (market?.ticker === settings.ticker &&
      market.interval === settings.interval
        ? market
        : null
      )?.bars.filter((b, i, list) =>
        liveStreams
          ? true
          : (b.endTime ?? list[i + 1]?.time ?? Infinity) <= clock,
      ) ?? [],
    [market, clock, liveStreams, settings.ticker, settings.interval],
  );
  const normalized = useMemo(
    () =>
      computeMultiNormalizedView(
        bars,
        benchmarks.map((m) =>
          m.bars.filter(
            (b, i, list) =>
              liveStreams ||
              (b.endTime ?? list[i + 1]?.time ?? Infinity) <= clock,
          ),
        ),
        settings.normalization,
      ),
    [bars, benchmarks, clock, settings.normalization, liveStreams],
  );
  return (
    <section
      className={`analysis-panel panel ${expanded ? 'analysis-expanded' : ''}`}
      id={`analysis-${settings.id}`}
      data-panel-interval={settings.interval}
      data-panel-candles={bars.length}
      aria-label={`Analysis chart ${settings.name ?? settings.id}`}
    >
      <header>
        <input
          aria-label="Panel name"
          placeholder="Chart name"
          value={settings.name ?? ''}
          onChange={(e) => onChange({ ...settings, name: e.target.value })}
        />
        <select
          aria-label="Panel ticker"
          value={settings.ticker}
          onChange={(e) => switchMarket(e.target.value, settings.interval)}
        >
          {symbols.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Panel interval"
          value={settings.interval}
          onChange={(e) => switchMarket(settings.ticker, e.target.value)}
        >
          {INTERVALS.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <button onClick={() => setMenu(!menu)}>Indicators</button>
        <button onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </header>
      <div className="analysis-settings">
        <strong>
          {settings.ticker}{' '}
          {bars
            .at(-1)
            ?.close.toLocaleString('en-US', { maximumFractionDigits: 6 }) ??
            '—'}
        </strong>
        <select
          aria-label="Panel chart type"
          value={settings.chartType ?? 'candles'}
          onChange={(e) =>
            onChange({
              ...settings,
              chartType: e.target.value as 'candles' | 'line',
            })
          }
        >
          <option value="candles">Candles</option>
          <option value="line">Line</option>
        </select>
        <label>
          Window
          <input
            aria-label="Panel normalization window"
            type="number"
            min="2"
            max="500"
            value={settings.normalization.window}
            onChange={(e) => {
              const window = Number(e.target.value);
              if (Number.isInteger(window) && window >= 2 && window <= 500)
                onChange({
                  ...settings,
                  normalization: { ...settings.normalization, window },
                });
            }}
          />
        </label>
        <select
          aria-label="Panel normalization"
          value={settings.normalization.normalization}
          onChange={(e) =>
            onChange({
              ...settings,
              normalization: {
                ...settings.normalization,
                normalization: e.target.value as any,
              },
            })
          }
        >
          {NORMALIZATION_OPTIONS.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Panel scale"
          value={settings.normalization.scale}
          onChange={(e) =>
            onChange({
              ...settings,
              normalization: {
                ...settings.normalization,
                scale: e.target.value as any,
              },
            })
          }
        >
          <option value="linear">Linear</option>
          <option value="log">Logarithmic</option>
        </select>
        <details>
          <summary>Comparisons</summary>
          {symbols
            .filter((s) => s !== settings.ticker)
            .map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  checked={settings.comparisons.includes(s)}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      comparisons: e.target.checked
                        ? [...settings.comparisons, s]
                        : settings.comparisons.filter((t) => t !== s),
                    })
                  }
                />
                {s}
              </label>
            ))}
        </details>
      </div>
      {error && (
        <p className="analysis-empty" role="alert">
          {error}
        </p>
      )}
      {loading && !bars.length && (
        <p role="status">
          Loading {settings.ticker} · {settings.interval}…
        </p>
      )}
      {menu && (
        <div className="analysis-indicators">
          <IndicatorMenu
            indicators={settings.indicators}
            onChange={(indicators) => onChange({ ...settings, indicators })}
          />
          <button onClick={() => setMenu(false)}>Close indicators</button>
        </div>
      )}
      <DrawingToolbar
        tool={tool}
        onTool={setTool}
        color={color}
        onColor={setColor}
        hasSelection={!!selection}
        hasDrawings={settings.drawings.length > 0}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={() => {
          const drawings = history.past.at(-1);
          if (drawings) {
            setHistory({
              past: history.past.slice(0, -1),
              future: [...history.future, settings.drawings],
            });
            onChange({ ...settings, drawings });
          }
        }}
        onRedo={() => {
          const drawings = history.future.at(-1);
          if (drawings) {
            setHistory({
              past: [...history.past, settings.drawings],
              future: history.future.slice(0, -1),
            });
            onChange({ ...settings, drawings });
          }
        }}
        onDelete={() =>
          onChange({
            ...settings,
            drawings: settings.drawings.filter((d) => d.id !== selection),
          })
        }
        onClear={() => changeDrawings([])}
      />
      {bars.length ? (
        <MarketChart
          bars={bars}
          orders={
            settings.ticker === session.market.ticker
              ? session.account.orders
              : []
          }
          position={
            settings.ticker === session.market.ticker
              ? session.account.position
              : { quantity: 0, averagePrice: 0 }
          }
          showVolume
          indicators={settings.indicators}
          comparisons={normalized.comparisons.flatMap((r, i) =>
            r
              ? [
                  {
                    ticker: benchmarks[i].ticker,
                    color: [
                      '#f0b86e',
                      '#6db5f8',
                      '#ed819f',
                      '#6fd8d3',
                      '#e3c5ff',
                    ][i],
                    anchor: r.anchor,
                    points: r.points,
                  },
                ]
              : [],
          )}
          display={normalized.display}
          chartType={settings.chartType ?? 'candles'}
          drawingTool={tool}
          drawings={settings.drawings.filter((d) =>
            d.points.every((p) => p.time <= clock),
          )}
          onDrawingsChange={changeDrawings}
          onDrawingToolComplete={() => setTool('cursor')}
          drawingColor={color}
          selectedDrawingId={selection}
          onDrawingSelect={setSelection}
          blind={blind}
          syncGroup={syncGroup}
          syncCrosshair={syncCrosshair}
          syncViewport={syncViewport}
        />
      ) : !loading && !error ? (
        <p className="analysis-empty" role="status">
          No completed {settings.interval} candles at the current replay time.
          {market?.bars.length
            ? `${blind ? '' : ` Available history starts ${new Date(market.bars[0].time * 1000).toISOString().slice(0, 10)}.`} Advance the base replay into the available range, or load a more recent base chart. Each panel can use a different interval; future candles stay hidden.`
            : ' Waiting for market data.'}
        </p>
      ) : null}
    </section>
  );
}

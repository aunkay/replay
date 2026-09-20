import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  TrackingModeExitMode,
  createChart,
  createSeriesMarkers,
  type BarPrice,
  type IChartApi,
  type IPaneApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IRange,
  type PriceFormat,
  type SeriesMarker,
  type Time,
  type MouseEventParams,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Order } from '../lib/engine';
import {
  computeIndicator,
  INDICATORS,
  type IndicatorInstance,
} from '../lib/indicators';
import type { Drawing, DrawingTool } from '../lib/drawings';
import {
  normalizationLabel,
  normalizationValue,
  type NormalizationContext,
} from '../lib/chartNormalization';
import BracketHandles from './BracketHandles';
import DrawingLayer from './DrawingLayer';
import { ComparisonAxisLabel } from './ComparisonAxisLabel';

// Only the chart that owns the current gesture broadcasts viewport changes.
// Library callbacks arrive on later animation frames, so a synchronous flag
// cannot prevent two different candle grids from feeding ranges back forever.
const viewportOwners = new Map<string, HTMLElement>();

export type ChartComparison = {
  ticker: string;
  color: string;
  anchor: { time: number; baseClose: number; benchmarkClose: number } | null;
  points: { time: number; value: number }[];
};

interface MarketChartProps {
  bars: Candle[];
  orders: Order[];
  position: { quantity: number; averagePrice: number };
  showVolume: boolean;
  indicators: IndicatorInstance[];
  comparisons: ChartComparison[];
  display: NormalizationContext;
  chartType: 'candles' | 'line';
  onProtectionEdit?: (stop?: number, target?: number) => void;
  blind?: boolean;
  syncGroup?: string;
  syncCrosshair?: boolean;
  syncViewport?: boolean;
  syncPrimary?: boolean;
  onCrosshair?: (bar: Candle | null) => void;
  drawingTool: DrawingTool;
  drawings: Drawing[];
  onDrawingsChange: (drawings: Drawing[]) => void;
  onDrawingToolComplete: () => void;
  drawingColor: string;
  selectedDrawingId: string | null;
  onDrawingSelect: (id: string | null) => void;
}

interface ChartInstance {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  line: ISeriesApi<'Line'>;
  volume: ISeriesApi<'Histogram'>;
  candleMarkers: ISeriesMarkersPluginApi<Time>;
  lineMarkers: ISeriesMarkersPluginApi<Time>;
  entryLines: [IPriceLine, IPriceLine];
}

type IndicatorSeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;
type IndicatorPlotState = {
  kind: 'line' | 'histogram';
  series: IndicatorSeries;
  lastTime: number | null;
};
type IndicatorState = {
  indicatorId: IndicatorInstance['indicatorId'];
  pane: IPaneApi<Time> | null;
  plots: Map<string, IndicatorPlotState>;
  signature: string;
};
type IndicatorLabel = {
  id: string;
  name: string;
  title: string;
  pane: number;
  color: string;
  plots: {
    key: string;
    label: string;
    color: string;
    value: number | null;
    time: number | null;
  }[];
};
type RenderedComparison = {
  ticker: string;
  normalization: NormalizationContext['normalization'];
  scale: NormalizationContext['scale'];
  points: number;
  lastTime: number | null;
  lastLabel: string | null;
  baseLabel: string | null;
};
type RenderedDisplay = {
  normalization: NormalizationContext['normalization'];
  scale: NormalizationContext['scale'];
  baseLabel: string | null;
  anchorTime: number | null;
  anchorPrice: number | null;
  sampleCount: number;
};

const GREEN = '#35cda0';
const RED = '#ed6a78';
const timestamp = (time: number) => time as UTCTimestamp;

function priceFormat(price: number) {
  const absolute = Math.abs(price);
  const precision =
    absolute < 0.0001 ? 8 : absolute < 0.01 ? 6 : absolute < 10 ? 4 : 2;
  return { type: 'price' as const, precision, minMove: 10 ** -precision };
}

function mainPriceFormat(
  price: number,
  display: NormalizationContext,
  includePrice = false,
): PriceFormat {
  if (display.normalization === 'price') return priceFormat(price);
  // Express the visible label precision as a raw-price tick increment. All
  // stored candles and drawing coordinates retain their original price units.
  const targetStep =
    display.normalization === 'zscore'
      ? (display.statistics?.deviation ?? 0) / 100
      : display.normalization === 'minmax'
        ? ((display.statistics?.max ?? 0) - (display.statistics?.min ?? 0)) /
          10_000
        : (display.anchorPrice ?? 0) / 10_000;
  const tickStep = 10 ** Math.floor(Math.log10(targetStep));
  const minMove =
    tickStep > 0 && Number.isFinite(tickStep) && Number.isFinite(1 / tickStep)
      ? tickStep
      : priceFormat(price).minMove;
  const rawFormat = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: priceFormat(price).precision,
    maximumFractionDigits: priceFormat(price).precision,
  });
  const formatter = (rawPrice: number) => {
    const normalized = normalizationLabel(rawPrice, display);
    return includePrice
      ? `${rawFormat.format(rawPrice)} · ${normalized}`
      : normalized;
  };
  return {
    type: 'custom',
    minMove,
    formatter,
    tickmarksFormatter: (values) => values.map(formatter),
  };
}

function sameBar(a: Candle, b: Candle) {
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}

function isAppendedData(previous: Candle[], bars: Candle[]) {
  return (
    previous.length > 0 &&
    bars.length >= previous.length &&
    sameBar(previous[0], bars[0]) &&
    sameBar(previous[previous.length - 1], bars[previous.length - 1])
  );
}

function sizePanes(chart: IChartApi, height: number) {
  const panes = chart.panes();
  if (panes.length < 2) {
    panes[0]?.setStretchFactor(1);
    return;
  }
  const count = panes.length - 1;
  const available = Math.max(
    180,
    height - chart.timeScale().height() - count * 4,
  );
  const oscillatorHeight = Math.max(
    70,
    Math.min(100, (available * 0.3) / count),
  );
  panes[0].setStretchFactor(
    Math.max(180, available - count * oscillatorHeight),
  );
  for (const pane of panes.slice(1)) pane.setStretchFactor(oscillatorHeight);
}

function volumeAt(bar: Candle) {
  return {
    time: timestamp(bar.time),
    value: bar.volume,
    color:
      bar.close >= bar.open
        ? 'rgba(53, 205, 160, 0.18)'
        : 'rgba(237, 106, 120, 0.18)',
  };
}

function IndicatorLegends({
  chart,
  labels,
  display,
}: {
  chart: IChartApi;
  labels: IndicatorLabel[];
  display: NormalizationContext;
}) {
  const [paneTops, setPaneTops] = useState<number[]>([0]);
  useEffect(() => {
    let mounted = true;
    let frame = 0;
    const refresh = () => {
      if (!mounted || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!mounted) return;
        let top = 0;
        const positions = chart.panes().map((pane) => {
          const current = top;
          top += pane.getHeight() + 1;
          return current;
        });
        setPaneTops((previous) =>
          previous.length === positions.length &&
          previous.every((value, index) => value === positions[index])
            ? previous
            : positions,
        );
      });
    };
    const element = chart.chartElement();
    const resize = new ResizeObserver(refresh);
    const mutations = new MutationObserver(refresh);
    resize.observe(element);
    mutations.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    refresh();
    return () => {
      mounted = false;
      resize.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [chart, labels.length]);

  const format = (value: number) =>
    new Intl.NumberFormat('en-US', {
      maximumFractionDigits:
        Math.abs(value) < 0.01 ? 6 : Math.abs(value) < 10 ? 4 : 2,
      ...(Math.abs(value) >= 1_000_000 ? { notation: 'compact' as const } : {}),
    }).format(value);
  const overlayFormat = mainPriceFormat(1, display);
  let overlayRow = 0;
  return (
    <div
      className="chart-indicator-values"
      aria-label="Indicator values"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2,
        overflow: 'hidden',
      }}
    >
      {labels.map((label) => {
        const row = label.pane === 0 ? overlayRow++ : 0;
        return (
          <div
            key={label.id}
            role="group"
            aria-label={`${label.name} indicator values`}
            data-indicator-id={label.id}
            data-pane={label.pane}
            style={{
              position: 'absolute',
              left: 10,
              right: 82,
              top: (paneTops[label.pane] ?? 0) + 7 + row * 18,
              display: 'flex',
              alignItems: 'baseline',
              gap: 9,
              fontSize: 10,
              lineHeight: '14px',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textShadow: '0 1px 3px #101318, 0 -1px 3px #101318',
            }}
          >
            <span style={{ color: label.color, flexShrink: 0 }}>
              {label.title}
            </span>
            {label.plots.every((plot) => plot.value === null) ? (
              <span style={{ color: '#788493' }}>Warming up</span>
            ) : (
              label.plots.map((plot) => (
                <span
                  key={plot.key}
                  aria-label={`${plot.label} value`}
                  data-plot-key={plot.key}
                  data-value={plot.value ?? undefined}
                  data-time={plot.time ?? undefined}
                  title={plot.label}
                  style={{ color: plot.color }}
                >
                  {plot.value === null
                    ? '—'
                    : label.pane === 0 && overlayFormat.type === 'custom'
                      ? overlayFormat.formatter(plot.value as BarPrice)
                      : format(plot.value)}
                </span>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MarketChart({
  bars,
  orders,
  position,
  showVolume,
  indicators,
  comparisons,
  display,
  chartType,
  onCrosshair,
  onProtectionEdit,
  blind = false,
  syncGroup,
  syncCrosshair = true,
  syncViewport = true,
  syncPrimary = false,
  drawingTool,
  drawings,
  onDrawingsChange,
  onDrawingToolComplete,
  drawingColor,
  selectedDrawingId,
  onDrawingSelect,
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ChartInstance | null>(null);
  const [ready, setReady] = useState<ChartInstance | null>(null);
  const [paneCount, setPaneCount] = useState(0);
  const [volumeTooltip, setVolumeTooltip] = useState<{
    bar: Candle;
    x: number;
    y: number;
  } | null>(null);
  const [indicatorLabels, setIndicatorLabels] = useState<IndicatorLabel[]>([]);
  const [renderedComparisons, setRenderedComparisons] = useState<
    RenderedComparison[]
  >([]);
  const renderedComparison = renderedComparisons[0] ?? null;
  const [renderedDisplay, setRenderedDisplay] =
    useState<RenderedDisplay | null>(null);
  const displayRef = useRef(display);
  displayRef.current = display;
  const comparisonStatesRef = useRef(
    new Map<
      string,
      {
        series: ISeriesApi<'Line'>;
        axisLabel: ComparisonAxisLabel;
        key: string;
        points: { time: UTCTimestamp; value: number }[];
      }
    >(),
  );
  const previousBarsRef = useRef<Candle[]>([]);
  const pendingReplayRangeRef = useRef<IRange<number> | null>(null);
  const previousIndicatorBarsRef = useRef<Candle[]>([]);
  const indicatorStatesRef = useRef(new Map<string, IndicatorState>());
  const barsByTimeRef = useRef(new Map<number, Candle>());
  const crosshairCallbackRef = useRef(onCrosshair);
  crosshairCallbackRef.current = onCrosshair;

  useEffect(() => {
    if (!containerRef.current) return;
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#101318' },
        textColor: '#788493',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 11,
        attributionLogo: true,
        panes: {
          separatorColor: '#293140',
          separatorHoverColor: '#536078',
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: '#1a2029' },
        horzLines: { color: '#1a2029' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#526075',
          labelBackgroundColor: '#2a3342',
          style: LineStyle.Dashed,
        },
        horzLine: {
          color: '#526075',
          labelBackgroundColor: '#2a3342',
          style: LineStyle.Dashed,
        },
      },
      rightPriceScale: {
        borderColor: '#242b36',
        scaleMargins: { top: 0.12, bottom: 0.22 },
      },
      timeScale: {
        borderColor: '#242b36',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 8,
        minBarSpacing: 2,
        shiftVisibleRangeOnNewBar: false,
      },
      localization: { locale: 'en-US' },
      handleScroll: {
        horzTouchDrag: true,
        vertTouchDrag: !coarsePointer.matches,
      },
      handleScale: { pinch: true },
      trackingMode: { exitMode: TrackingModeExitMode.OnTouchEnd },
    });
    const updateTouchScrolling = () =>
      chart.applyOptions({
        handleScroll: {
          horzTouchDrag: true,
          vertTouchDrag: !coarsePointer.matches,
        },
      });
    coarsePointer.addEventListener('change', updateTouchScrolling);
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: GREEN,
      downColor: RED,
      wickUpColor: GREEN,
      wickDownColor: RED,
      borderVisible: false,
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1,
    });
    const line = chart.addSeries(LineSeries, {
      color: GREEN,
      lineWidth: 2,
      visible: false,
      priceLineStyle: LineStyle.Dashed,
      crosshairMarkerRadius: 4,
    });
    const entryOptions = {
      price: 0,
      color: '#9d8af7',
      lineWidth: 1 as const,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      lineVisible: false,
      title: 'AVG',
    };
    const candleMarkers = createSeriesMarkers(candles, []);
    const lineMarkers = createSeriesMarkers(line, []);
    instanceRef.current = {
      chart,
      candles,
      line,
      volume,
      candleMarkers,
      lineMarkers,
      entryLines: [
        candles.createPriceLine(entryOptions),
        line.createPriceLine(entryOptions),
      ],
    };
    setReady(instanceRef.current);
    const resizeObserver = new ResizeObserver(() => {
      if (instanceRef.current?.chart === chart && containerRef.current) {
        sizePanes(chart, containerRef.current.clientHeight);
      }
    });
    resizeObserver.observe(containerRef.current);
    const crosshairHandler = (event: MouseEventParams<Time>) => {
      const bar =
        typeof event.time === 'number'
          ? (barsByTimeRef.current.get(event.time) ?? null)
          : null;
      crosshairCallbackRef.current?.(bar);
      const point = event.point;
      setVolumeTooltip(
        bar && point && event.paneIndex === 0
          ? {
              bar,
              x: Math.max(
                8,
                Math.min(
                  point.x + 12,
                  (containerRef.current?.clientWidth ?? 220) - 210,
                ),
              ),
              y: Math.max(8, point.y - 70),
            }
          : null,
      );
    };
    chart.subscribeCrosshairMove(crosshairHandler);
    // A tap also inspects volume without requiring the chart's long-press gesture.
    chart.subscribeClick(crosshairHandler);
    return () => {
      coarsePointer.removeEventListener('change', updateTouchScrolling);
      resizeObserver.disconnect();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.unsubscribeClick(crosshairHandler);
      candleMarkers.detach();
      lineMarkers.detach();
      chart.remove();
      instanceRef.current = null;
      previousBarsRef.current = [];
      pendingReplayRangeRef.current = null;
      previousIndicatorBarsRef.current = [];
      indicatorStatesRef.current.clear();
      barsByTimeRef.current.clear();
      comparisonStatesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const { chart, candles, line, volume, candleMarkers, lineMarkers } =
      instance;
    if (syncGroup && syncPrimary && containerRef.current)
      viewportOwners.set(syncGroup, containerRef.current);
    const previous = previousBarsRef.current;
    const previousRange = chart.timeScale().getVisibleLogicalRange();
    const canAppend = isAppendedData(previous, bars);

    if (canAppend) {
      for (let index = previous.length; index < bars.length; index += 1) {
        const bar = bars[index];
        candles.update({ ...bar, time: timestamp(bar.time) });
        line.update({ time: timestamp(bar.time), value: bar.close });
        volume.update(volumeAt(bar));
        barsByTimeRef.current.set(bar.time, bar);
      }
    } else {
      // Clear annotations before replacing data, since a replay reset may remove their bars.
      candleMarkers.setMarkers([]);
      lineMarkers.setMarkers([]);
      candles.setData(
        bars.map((bar) => ({ ...bar, time: timestamp(bar.time) })),
      );
      line.setData(
        bars.map((bar) => ({ time: timestamp(bar.time), value: bar.close })),
      );
      volume.setData(bars.map(volumeAt));
      barsByTimeRef.current = new Map(bars.map((bar) => [bar.time, bar]));
    }

    if (bars.length) {
      const format = mainPriceFormat(
        bars[bars.length - 1].close,
        displayRef.current,
        comparisons.length > 0,
      );
      candles.applyOptions({ priceFormat: format });
      line.applyOptions({ priceFormat: format });
      if (!canAppend || !previousRange) {
        pendingReplayRangeRef.current = {
          from: Math.max(-2, bars.length - 90),
          to: bars.length + 6,
        };
      } else if (bars.length > previous.length) {
        const delta =
          previousRange.to >= previous.length - 2
            ? bars.length - previous.length
            : 0;
        pendingReplayRangeRef.current = {
          from: previousRange.from + delta,
          to: previousRange.to + delta,
        };
      }
    }
    previousBarsRef.current = bars;
  }, [bars]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const { chart } = instance;
    const states = indicatorStatesRef.current;
    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    const canAppend = isAppendedData(previousIndicatorBarsRef.current, bars);
    const desired = new Map(
      indicators.map((indicator) => [indicator.id, indicator]),
    );
    let topologyChanged = false;

    // A pane owns all the plots of one oscillator. Removing its pane also removes
    // its series; price overlays are removed individually from the main pane.
    const removeIndicator = (state: IndicatorState) => {
      if (state.pane) chart.removePane(state.pane.paneIndex());
      else
        for (const plot of state.plots.values())
          chart.removeSeries(plot.series);
    };
    for (const [id, state] of states) {
      const next = desired.get(id);
      if (!next || next.indicatorId !== state.indicatorId) {
        removeIndicator(state);
        states.delete(id);
        topologyChanged = true;
      }
    }

    let oscillatorIndex = 1;
    const nextLabels: IndicatorLabel[] = [];
    for (const indicator of indicators) {
      const definition = INDICATORS.find(
        (candidate) => candidate.id === indicator.indicatorId,
      );
      if (!definition) continue;
      let state = states.get(indicator.id);
      if (!state) {
        state = {
          indicatorId: indicator.indicatorId,
          pane: definition.pane === 'oscillator' ? chart.addPane(true) : null,
          plots: new Map(),
          signature: '',
        };
        states.set(indicator.id, state);
        topologyChanged = true;
      }
      if (state.pane) {
        if (state.pane.paneIndex() !== oscillatorIndex) {
          state.pane.moveTo(oscillatorIndex);
          topologyChanged = true;
        }
        oscillatorIndex += 1;
      }

      const plots = computeIndicator(indicator, bars);
      const plotKeys = new Set(plots.map((plot) => plot.key));
      for (const [key, existing] of state.plots) {
        if (!plotKeys.has(key)) {
          chart.removeSeries(existing.series);
          state.plots.delete(key);
        }
      }
      const signature = `${indicator.indicatorId}:${indicator.period}:${indicator.color}`;
      const appendPlots = canAppend && signature === state.signature;
      const currentPrice = bars.at(-1)?.close ?? 1;
      const label: IndicatorLabel = {
        id: indicator.id,
        name: definition.name,
        title: `${definition.shortName}${definition.minPeriod !== definition.maxPeriod ? ` (${indicator.period})` : ''}`,
        pane: state.pane?.paneIndex() ?? 0,
        color: indicator.color,
        plots: [],
      };

      for (const plot of plots) {
        const color = plot.color || indicator.color;
        const options = {
          color,
          title: `${definition.shortName}${definition.minPeriod !== definition.maxPeriod ? ` ${indicator.period}` : ''}${plot.label !== definition.shortName ? ` · ${plot.label}` : ''}`,
          priceScaleId: 'right',
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat:
            definition.pane === 'overlay'
              ? mainPriceFormat(
                  currentPrice,
                  displayRef.current,
                  comparisons.length > 0,
                )
              : { type: 'price' as const, precision: 2, minMove: 0.01 },
        };
        let existing = state.plots.get(plot.key);
        if (existing && existing.kind !== plot.kind) {
          chart.removeSeries(existing.series);
          state.plots.delete(plot.key);
          existing = undefined;
        }
        const isNew = !existing;
        if (!existing) {
          const paneIndex = state.pane?.paneIndex() ?? 0;
          const series =
            plot.kind === 'histogram'
              ? chart.addSeries(HistogramSeries, options, paneIndex)
              : chart.addSeries(
                  LineSeries,
                  {
                    ...options,
                    lineWidth: 1,
                    lineVisible: definition.id !== 'psar',
                    pointMarkersVisible: definition.id === 'psar',
                    pointMarkersRadius: 2,
                    crosshairMarkerRadius: 3,
                  },
                  paneIndex,
                );
          existing = { series, kind: plot.kind, lastTime: null };
          state.plots.set(plot.key, existing);
        } else if (existing.kind === 'line') {
          (existing.series as ISeriesApi<'Line'>).applyOptions({
            ...options,
            lineVisible: definition.id !== 'psar',
            pointMarkersVisible: definition.id === 'psar',
            pointMarkersRadius: 2,
          });
        } else existing.series.applyOptions(options);

        // Indicator calculations receive only revealed candles. Restrict their
        // output to those same timestamps as an additional look-ahead boundary.
        const data = plot.data
          .filter(
            (point) =>
              Number.isFinite(point.value) &&
              barsByTimeRef.current.has(point.time),
          )
          .map((point) => ({
            time: timestamp(point.time),
            value: point.value,
            ...(plot.kind === 'histogram'
              ? { color: point.value < 0 ? RED : color }
              : {}),
          }));
        if (!isNew && appendPlots) {
          for (const point of data) {
            if (existing.lastTime === null || point.time > existing.lastTime) {
              existing.series.update(point);
            }
          }
        } else existing.series.setData(data);
        existing.lastTime = data.at(-1)?.time ?? null;
        label.plots.push({
          key: plot.key,
          label: plot.label,
          color,
          value: data.at(-1)?.value ?? null,
          time: data.at(-1)?.time ?? null,
        });
      }

      if (state.pane && state.plots.size) {
        state.pane.priceScale('right').applyOptions({
          autoScale: true,
          borderColor: '#242b36',
          scaleMargins: { top: 0.18, bottom: 0.15 },
        });
      }
      state.signature = signature;
      nextLabels.push(label);
    }

    if (topologyChanged) {
      sizePanes(chart, containerRef.current?.clientHeight ?? 400);
      setPaneCount(chart.panes().length - 1);
    }
    if (visibleRange) chart.timeScale().setVisibleLogicalRange(visibleRange);
    previousIndicatorBarsRef.current = bars;
    setIndicatorLabels(nextLabels);
  }, [bars, indicators]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const { chart, candles, line } = instance;
    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    const currentPrice = bars.at(-1)?.close ?? 1;
    const format = mainPriceFormat(
      currentPrice,
      display,
      comparisons.length > 0,
    );

    // Keep every price and drawing in the original quote units. Only axis
    // formatting changes, so the normalization anchor stays fixed while panning.
    candles.applyOptions({ priceFormat: format });
    line.applyOptions({ priceFormat: format });
    for (const indicator of indicatorStatesRef.current.values()) {
      if (!indicator.pane) {
        for (const plot of indicator.plots.values()) {
          plot.series.applyOptions({ priceFormat: format });
        }
      }
    }
    const scale = chart.priceScale('right', 0);
    const mode =
      display.scale === 'log'
        ? PriceScaleMode.Logarithmic
        : PriceScaleMode.Normal;
    if (scale.options().mode !== mode) scale.applyOptions({ mode });

    const appliedDisplay: RenderedDisplay = {
      normalization:
        candles.options().priceFormat.type === 'custom'
          ? display.normalization
          : 'price',
      scale:
        scale.options().mode === PriceScaleMode.Logarithmic ? 'log' : 'linear',
      baseLabel: bars.length
        ? candles.priceFormatter().format(currentPrice)
        : null,
      anchorTime: display.anchorTime,
      anchorPrice: display.anchorPrice,
      sampleCount: display.statistics?.count ?? candles.data().length,
    };
    setRenderedDisplay(appliedDisplay);

    const states = comparisonStatesRef.current;
    const desired = new Set(comparisons.map((item) => item.ticker));
    for (const [ticker, state] of states) {
      if (!desired.has(ticker)) {
        chart.removeSeries(state.series);
        states.delete(ticker);
      }
    }
    const labels: RenderedComparison[] = [];
    for (const comparison of comparisons) {
      let state = states.get(comparison.ticker);
      if (!state) {
        const series = chart.addSeries(
          LineSeries,
          {
            priceScaleId: 'right',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerRadius: 4,
          },
          0,
        );
        const axisLabel = new ComparisonAxisLabel(series);
        series.attachPrimitive(axisLabel);
        state = { series, axisLabel, key: '', points: [] };
        states.set(comparison.ticker, state);
      }
      const benchmark = state.series;
      benchmark.applyOptions({
        title: comparison.ticker,
        color: comparison.color,
        priceFormat: mainPriceFormat(currentPrice, display),
      });
      const points = [
        ...new Map(
          comparison.points
            .filter(
              (point) =>
                Number.isFinite(point.value) &&
                barsByTimeRef.current.has(point.time),
            )
            .map((point) => [point.time, point.value] as const),
        ),
      ]
        .sort(([a], [b]) => a - b)
        .map(([time, value]) => ({ time: timestamp(time), value }));
      const key = `${comparison.ticker}:${comparison.anchor?.time}:${comparison.anchor?.baseClose}:${comparison.anchor?.benchmarkClose}:${JSON.stringify(display)}`;
      const append =
        key === state.key &&
        points.length >= state.points.length &&
        state.points.every(
          (point, index) =>
            point.time === points[index].time &&
            point.value === points[index].value,
        );
      if (append) {
        for (let index = state.points.length; index < points.length; index++)
          benchmark.update(points[index]);
      } else benchmark.setData(points);
      state.key = key;
      state.points = points;
      const rendered = benchmark.data();
      const last = rendered.at(-1);
      const lastLabel =
        last && 'value' in last
          ? benchmark.priceFormatter().format(last.value)
          : null;
      state.axisLabel.update(
        last && 'value' in last ? last.value : null,
        lastLabel === null ? '' : `${comparison.ticker} ${lastLabel}`,
        comparison.color,
      );
      labels.push({
        ticker: benchmark.options().title,
        normalization: appliedDisplay.normalization,
        scale: appliedDisplay.scale,
        points: rendered.length,
        lastTime: last && typeof last.time === 'number' ? last.time : null,
        lastLabel,
        baseLabel: appliedDisplay.baseLabel,
      });
    }
    setRenderedComparisons(labels);
    if (visibleRange) chart.timeScale().setVisibleLogicalRange(visibleRange);
  }, [comparisons, bars, display]);

  useEffect(() => {
    const range = pendingReplayRangeRef.current;
    pendingReplayRangeRef.current = null;
    if (!range || !instanceRef.current) return;
    // Lightweight Charts applies range changes on its next frame. Indicator
    // and comparison effects can otherwise read the old range and overwrite
    // replay's queued movement. Commit replay's range after those updates.
    instanceRef.current.chart.timeScale().setVisibleLogicalRange(range);
  }, [bars, indicators, comparisons, display]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const markers: SeriesMarker<Time>[] = orders
      .filter(
        (order) =>
          order.status === 'filled' &&
          order.filledAt !== undefined &&
          barsByTimeRef.current.has(order.filledAt),
      )
      .sort((a, b) => a.filledAt! - b.filledAt!)
      .map((order) => ({
        id: order.id,
        time: timestamp(order.filledAt!),
        position: order.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: order.side === 'buy' ? GREEN : RED,
        shape: order.side === 'buy' ? 'arrowUp' : 'arrowDown',
        text: `${order.side === 'buy' ? 'B' : 'S'} ${order.quantity}`,
        size: 1,
      }));
    instance.candleMarkers.setMarkers(markers);
    instance.lineMarkers.setMarkers(markers);
  }, [orders, bars]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    instance.candles.applyOptions({ visible: chartType === 'candles' });
    instance.line.applyOptions({ visible: chartType === 'line' });
    instance.volume.applyOptions({ visible: showVolume });
    instance.chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.12, bottom: showVolume ? 0.22 : 0.1 },
    });
  }, [chartType, showVolume]);

  useEffect(() => {
    if (!instanceRef.current) return;
    for (const entryLine of instanceRef.current.entryLines) {
      entryLine.applyOptions({
        price: position.averagePrice,
        lineVisible: position.quantity !== 0,
        axisLabelVisible: position.quantity !== 0,
        title: `${position.quantity > 0 ? 'LONG' : 'SHORT'} AVG`,
      });
    }
  }, [position.quantity, position.averagePrice]);

  useEffect(() => {
    if (!ready) return;
    ready.chart.applyOptions({
      localization: {
        timeFormatter: blind
          ? (time: Time) =>
              `Candle ${bars.findIndex((b) => b.time === time) + 1}`
          : undefined,
      },
      timeScale: {
        tickMarkFormatter: blind
          ? (time: Time) => `${bars.findIndex((b) => b.time === time) + 1}`
          : undefined,
      },
    });
  }, [ready, blind, bars]);

  useEffect(() => {
    if (!ready || !syncGroup) return;
    const source = containerRef.current!;
    if (syncPrimary) viewportOwners.set(syncGroup, source);
    const claimViewport = () => {
      if (syncViewport) {
        viewportOwners.set(syncGroup, source);
        window.dispatchEvent(
          new CustomEvent('replay:range-request', {
            detail: { group: syncGroup },
          }),
        );
      }
    };
    source.addEventListener('pointerdown', claimViewport, {
      capture: true,
      passive: true,
    });
    source.addEventListener('wheel', claimViewport, {
      capture: true,
      passive: true,
    });
    let applying = false;
    const crosshair = (event: MouseEventParams<Time>) => {
      if (!applying && syncCrosshair && event.sourceEvent)
        window.dispatchEvent(
          new CustomEvent('replay:chart-sync', {
            detail: { group: syncGroup, source, time: event.time },
          }),
        );
    };
    const range = (range: IRange<Time> | null) => {
      if (range) {
        source.dataset.visibleTimeFrom = String(range.from);
        source.dataset.visibleTimeTo = String(range.to);
      }
      if (!viewportOwners.has(syncGroup) && syncPrimary)
        viewportOwners.set(syncGroup, source);
      if (
        !applying &&
        range &&
        syncViewport &&
        viewportOwners.get(syncGroup) === source
      )
        window.dispatchEvent(
          new CustomEvent('replay:range-sync', {
            detail: { group: syncGroup, source, range },
          }),
        );
    };
    const receive = (event: Event) => {
      const message = (event as CustomEvent).detail;
      if (message.group !== syncGroup || message.source === source) return;
      if (
        (message.range && !syncViewport) ||
        (!message.range && !syncCrosshair)
      )
        return;
      applying = true;
      try {
        if (message.range) {
          const available = previousBarsRef.current;
          if (!available.length) return;
          const from = Math.max(Number(message.range.from), available[0].time);
          const to = Math.min(Number(message.range.to), available.at(-1)!.time);
          // Never scroll a recipient into an unavailable/future-only range.
          if (Number.isFinite(from) && Number.isFinite(to) && from < to)
            ready.chart
              .timeScale()
              .setVisibleRange({ from: timestamp(from), to: timestamp(to) });
        } else if (message.time) {
          const available = previousBarsRef.current;
          // Resolve the candle containing this instant, rather than requiring
          // identical 2m/5m opening timestamps. Do not cross session gaps.
          let low = 0,
            high = available.length - 1,
            found = -1;
          while (low <= high) {
            const mid = (low + high) >>> 1;
            if (available[mid].time <= message.time) {
              found = mid;
              low = mid + 1;
            } else high = mid - 1;
          }
          const candidate = available[found];
          const end = candidate?.endTime ?? available[found + 1]?.time;
          const bar =
            candidate &&
            (candidate.time === message.time ||
              (end !== undefined && message.time < end))
              ? candidate
              : undefined;
          const price =
            bar && normalizationValue(bar.close, displayRef.current);
          if (price !== null && price !== undefined)
            ready.chart.setCrosshairPosition(
              price,
              timestamp(bar!.time),
              ready.candles,
            );
          else ready.chart.clearCrosshairPosition();
        } else ready.chart.clearCrosshairPosition();
      } finally {
        applying = false;
      }
    };
    const requestedRange = (event: Event) => {
      if ((event as CustomEvent).detail.group === syncGroup)
        range(ready.chart.timeScale().getVisibleRange());
    };
    window.addEventListener('replay:range-request', requestedRange);
    let initialRangeFrame = requestAnimationFrame(() => {
      initialRangeFrame = requestAnimationFrame(() => {
        if (syncViewport)
          window.dispatchEvent(
            new CustomEvent('replay:range-request', {
              detail: { group: syncGroup },
            }),
          );
      });
    });
    ready.chart.subscribeCrosshairMove(crosshair);
    ready.chart.timeScale().subscribeVisibleTimeRangeChange(range);
    window.addEventListener('replay:chart-sync', receive);
    window.addEventListener('replay:range-sync', receive);
    return () => {
      ready.chart.unsubscribeCrosshairMove(crosshair);
      ready.chart.timeScale().unsubscribeVisibleTimeRangeChange(range);
      window.removeEventListener('replay:chart-sync', receive);
      window.removeEventListener('replay:range-sync', receive);
      cancelAnimationFrame(initialRangeFrame);
      window.removeEventListener('replay:range-request', requestedRange);
      source.removeEventListener('pointerdown', claimViewport, true);
      source.removeEventListener('wheel', claimViewport, true);
      if (viewportOwners.get(syncGroup) === source)
        viewportOwners.delete(syncGroup);
    };
  }, [ready, syncGroup, syncCrosshair, syncViewport, syncPrimary]);

  useEffect(() => {
    if (!ready) return;
    const series = chartType === 'candles' ? ready.candles : ready.line;
    const lines = orders
      .filter((o) => o.reduceOnly && o.status === 'pending')
      .flatMap((o) => {
        const price = normalizationValue(o.price!, display);
        return !Number.isFinite(price)
          ? []
          : [
              series.createPriceLine({
                price,
                color: o.role === 'stopLoss' ? '#ef6377' : '#35cda0',
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: o.role === 'stopLoss' ? 'STOP' : 'TARGET',
              }),
            ];
      });
    return () => lines.forEach((line) => series.removePriceLine(line));
  }, [ready, orders, display, chartType]);

  useEffect(() => {
    setVolumeTooltip(null);
  }, [bars, showVolume]);

  return (
    <div
      className="market-chart"
      role="group"
      aria-label="Chart workspace"
      data-indicator-panes={paneCount}
      data-chart-normalization={renderedDisplay?.normalization}
      data-chart-scale={renderedDisplay?.scale}
      data-chart-base-label={renderedDisplay?.baseLabel ?? undefined}
      data-chart-anchor={renderedDisplay?.anchorTime ?? undefined}
      data-chart-anchor-price={renderedDisplay?.anchorPrice ?? undefined}
      data-chart-sample-count={renderedDisplay?.sampleCount}
      data-comparison-series={JSON.stringify(renderedComparisons)}
      data-comparison-count={renderedComparisons.length}
      data-comparison-ticker={renderedComparison?.ticker}
      data-comparison-normalization={renderedComparison?.normalization}
      data-comparison-scale={renderedComparison?.scale}
      data-comparison-points={renderedComparison?.points}
      data-comparison-last-time={renderedComparison?.lastTime ?? undefined}
      data-comparison-last-label={renderedComparison?.lastLabel ?? undefined}
      data-comparison-base-label={renderedComparison?.baseLabel ?? undefined}
    >
      <div
        ref={containerRef}
        className="chart-canvas"
        role="img"
        aria-label="Interactive historical price chart with executed trade markers"
        style={{ position: 'absolute', inset: 0 }}
      />
      {ready &&
        onProtectionEdit &&
        orders.some((o) => o.reduceOnly && o.status === 'pending') && (
          <BracketHandles
            chart={ready.chart}
            series={chartType === 'candles' ? ready.candles : ready.line}
            orders={orders}
            display={display}
            onChange={onProtectionEdit}
          />
        )}
      {showVolume && volumeTooltip && (
        <div
          role="tooltip"
          aria-label="Historical volume"
          className="volume-tooltip"
          style={{ left: volumeTooltip.x, top: volumeTooltip.y }}
        >
          <time>
            {blind
              ? `Candle ${bars.findIndex((b) => b.time === volumeTooltip.bar.time) + 1}`
              : new Date(volumeTooltip.bar.time * 1000)
                  .toISOString()
                  .replace('T', ' ')
                  .slice(0, 16)}{' '}
            UTC
          </time>
          <strong>
            Volume:{' '}
            {volumeTooltip.bar.volume.toLocaleString('en-US', {
              maximumFractionDigits: 8,
            })}
          </strong>
        </div>
      )}
      {ready && ready === instanceRef.current && indicatorLabels.length > 0 && (
        <IndicatorLegends
          chart={ready.chart}
          labels={indicatorLabels}
          display={display}
        />
      )}
      {ready && ready === instanceRef.current && (
        <DrawingLayer
          chart={ready.chart}
          series={chartType === 'candles' ? ready.candles : ready.line}
          bars={bars}
          tool={drawingTool}
          drawings={drawings}
          onChange={onDrawingsChange}
          onToolComplete={onDrawingToolComplete}
          color={drawingColor}
          selectedId={selectedDrawingId}
          onSelect={onDrawingSelect}
        />
      )}
    </div>
  );
}

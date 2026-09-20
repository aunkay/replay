import { useEffect, useRef } from 'react';
import {
  BaselineSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

interface EquityChartProps {
  points: { time: number; equity: number }[];
  initialCapital: number;
}

export default function EquityChart({
  points,
  initialCapital,
}: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#101318' },
        textColor: '#788493',
        fontSize: 10,
        attributionLogo: true,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: '#1a2029' } },
      rightPriceScale: {
        visible: false,
        scaleMargins: { top: 0.14, bottom: 0.16 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: false,
        rightOffset: 0,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScale: false,
      handleScroll: false,
    });
    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: initialCapital },
      topLineColor: '#35cda0',
      topFillColor1: 'rgba(53, 205, 160, 0.18)',
      topFillColor2: 'rgba(53, 205, 160, 0.02)',
      bottomLineColor: '#ed6a78',
      bottomFillColor1: 'rgba(237, 106, 120, 0.02)',
      bottomFillColor2: 'rgba(237, 106, 120, 0.18)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // The baseline follows initialCapital through the data effect without recreating the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    // Executions can change equity at the same candle; retain its latest account value.
    const latestByTime = new Map(
      points.map((point) => [point.time, point.equity]),
    );
    seriesRef.current.setData(
      [...latestByTime]
        .sort(([a], [b]) => a - b)
        .map(([time, value]) => ({ time: time as UTCTimestamp, value })),
    );
    seriesRef.current.applyOptions({
      baseValue: { type: 'price', price: initialCapital },
    });
    chartRef.current.timeScale().fitContent();
  }, [points, initialCapital]);

  return (
    <div
      ref={containerRef}
      className="equity-chart"
      style={{ height: 120, width: '100%' }}
      role="img"
      aria-label="Account equity over the replay period"
    />
  );
}

import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { Order } from '../lib/engine';
import {
  normalizationValue,
  type NormalizationContext,
} from '../lib/chartNormalization';
function rawPrice(value: number, display: NormalizationContext) {
  const anchor = display.anchorPrice ?? NaN,
    stats = display.statistics;
  switch (display.normalization) {
    case 'price':
      return value;
    case 'percent':
      return anchor * (1 + value / 100);
    case 'indexed':
      return (anchor * value) / 100;
    case 'ratio':
      return anchor * value;
    case 'logReturn':
      return anchor * Math.exp(value / 100);
    case 'zscore':
      return stats ? stats.mean + value * stats.deviation : NaN;
    case 'minmax':
      return stats ? stats.min + (value / 100) * (stats.max - stats.min) : NaN;
  }
}
export default function BracketHandles({
  chart,
  series,
  orders,
  display,
  onChange,
}: {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'>;
  orders: Order[];
  display: NormalizationContext;
  onChange: (
    stop?: number,
    target?: number,
    id?: string,
    price?: number,
  ) => void;
}) {
  const [coordinates, setCoordinates] = useState<Record<string, number>>({}),
    [preview, setPreview] = useState<{
      id: string;
      price: number;
      y: number;
    } | null>(null),
    root = useRef<HTMLDivElement>(null);
  const active = orders.filter((o) => o.status === 'pending' && o.reduceOnly);
  useEffect(() => {
    let frame = 0;
    let alive = true;
    const update = () => {
      if (!alive) return;
      const next: Record<string, number> = {};
      for (const o of active) {
        const price = normalizationValue(o.price!, display);
        if (Number.isFinite(price)) {
          const y = series.priceToCoordinate(price);
          if (y !== null) next[o.id] = y;
        }
      }
      setCoordinates((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
      frame = requestAnimationFrame(update);
    };
    update();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [chart, series, orders, display]);
  function apply(order: Order, price: number) {
    if (!Number.isFinite(price) || price <= 0) return;
    const stop = active.find((o) => o.role === 'stopLoss')?.price,
      target = active.find((o) => o.role === 'takeProfit')?.price;
    onChange(
      order.role === 'stopLoss' ? price : stop,
      order.role === 'takeProfit' ? price : target,
      order.id,
      price,
    );
  }
  return (
    <div className="bracket-handles" ref={root}>
      {active
        .filter((o) => coordinates[o.id] !== undefined)
        .map((order) => (
          <button
            key={order.id}
            type="button"
            aria-label={`Drag ${order.role === 'stopLoss' ? 'stop-loss' : 'take-profit'} price`}
            style={{
              top: Math.max(
                8,
                Math.min(
                  (preview?.id === order.id
                    ? preview.y
                    : coordinates[order.id]) - 14,
                  (root.current?.clientHeight ?? 500) - 50,
                ),
              ),
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              setPreview({
                id: order.id,
                price: order.price!,
                y: coordinates[order.id],
              });
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId))
                return;
              const y =
                event.clientY - root.current!.getBoundingClientRect().top;
              const normalized = series.coordinateToPrice(y);
              if (normalized !== null)
                setPreview({
                  id: order.id,
                  y,
                  price: rawPrice(normalized, display),
                });
            }}
            onPointerUp={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId))
                return;
              event.currentTarget.releasePointerCapture(event.pointerId);
              if (preview?.id === order.id)
                apply(order, Number(preview.price.toPrecision(10)));
              setPreview(null);
            }}
            onPointerCancel={() => setPreview(null)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                apply(
                  order,
                  order.price! * (event.key === 'ArrowUp' ? 1.001 : 0.999),
                );
              }
            }}
          >
            {order.role === 'stopLoss' ? 'Stop' : 'Target'}{' '}
            {(preview?.id === order.id ? preview.price : order.price)?.toFixed(
              2,
            )}{' '}
            ↕
          </button>
        ))}
    </div>
  );
}

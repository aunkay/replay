export type DrawingTool =
  | 'cursor'
  | 'trendline'
  | 'ray'
  | 'extended'
  | 'horizontal'
  | 'vertical'
  | 'rectangle'
  | 'ellipse'
  | 'channel'
  | 'fib'
  | 'arrow'
  | 'text'
  | 'measure';

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  tool: Exclude<DrawingTool, 'cursor'>;
  points: DrawingPoint[];
  color: string;
  text?: string;
}

export type ScreenPoint = { x: number; y: number };
export type DrawingBounds = { width: number; height: number };
export const DRAWING_TOOLS: ReadonlyArray<{ id: DrawingTool; label: string }> =
  [
    { id: 'cursor', label: 'Cursor' },
    { id: 'trendline', label: 'Trend line' },
    { id: 'ray', label: 'Ray' },
    { id: 'extended', label: 'Extended line' },
    { id: 'horizontal', label: 'Horizontal line' },
    { id: 'vertical', label: 'Vertical line' },
    { id: 'rectangle', label: 'Rectangle' },
    { id: 'ellipse', label: 'Ellipse' },
    { id: 'channel', label: 'Parallel channel' },
    { id: 'fib', label: 'Fibonacci retracement' },
    { id: 'arrow', label: 'Arrow' },
    { id: 'text', label: 'Text' },
    { id: 'measure', label: 'Measure' },
  ];

export function drawingPointCount(tool: DrawingTool): number {
  if (tool === 'cursor') return 0;
  if (tool === 'horizontal' || tool === 'vertical' || tool === 'text') return 1;
  return tool === 'channel' ? 3 : 2;
}

/** Persisted annotations are untrusted input, just like saved account data. */
export function isValidDrawing(value: unknown): value is Drawing {
  if (!value || typeof value !== 'object') return false;
  const drawing = value as Drawing;
  return (
    typeof drawing.id === 'string' &&
    drawing.id.length > 0 &&
    DRAWING_TOOLS.some(({ id }) => id !== 'cursor' && id === drawing.tool) &&
    /^#[0-9a-f]{6}$/i.test(drawing.color) &&
    (drawing.text === undefined ||
      (typeof drawing.text === 'string' && drawing.text.length <= 200)) &&
    Array.isArray(drawing.points) &&
    drawing.points.length === drawingPointCount(drawing.tool) &&
    drawing.points.every(
      (point) =>
        point && Number.isFinite(point.time) && Number.isFinite(point.price),
    )
  );
}

/** Interpolate actual candle timestamps, preserving positions across market gaps. */
export function logicalToDrawingTime(
  logical: number,
  bars: ReadonlyArray<{ time: number }>,
): number | null {
  if (!bars.length || !Number.isFinite(logical)) return null;
  const bounded = Math.max(0, Math.min(bars.length - 1, logical));
  const lower = Math.floor(bounded);
  const upper = Math.min(bars.length - 1, lower + 1);
  return (
    bars[lower].time + (bars[upper].time - bars[lower].time) * (bounded - lower)
  );
}

export function drawingTimeToLogical(
  time: number,
  bars: ReadonlyArray<{ time: number }>,
): number | null {
  if (!bars.length || !Number.isFinite(time)) return null;
  if (bars.length === 1) return time === bars[0].time ? 0 : null;
  // Extrapolation keeps annotations off-screen when replay temporarily hides their candles.
  if (time <= bars[0].time)
    return (time - bars[0].time) / (bars[1].time - bars[0].time);
  const last = bars.length - 1;
  if (time >= bars[last].time)
    return (
      last + (time - bars[last].time) / (bars[last].time - bars[last - 1].time)
    );
  let lo = 0;
  let hi = last;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (bars[mid].time <= time) lo = mid;
    else hi = mid;
  }
  return lo + (time - bars[lo].time) / (bars[hi].time - bars[lo].time);
}

/** Liang–Barsky clipping also handles vertical and horizontal rays without division by zero. */
export function clipDrawingLine(
  a: ScreenPoint,
  b: ScreenPoint,
  bounds: DrawingBounds,
  mode: 'segment' | 'ray' | 'extended' = 'segment',
): [ScreenPoint, ScreenPoint] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (![a.x, a.y, b.x, b.y, bounds.width, bounds.height].every(Number.isFinite))
    return null;
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) return null;
  let minimum = mode === 'extended' ? -Infinity : 0;
  let maximum = mode === 'segment' ? 1 : Infinity;
  for (const [p, q] of [
    [-dx, a.x],
    [dx, bounds.width - a.x],
    [-dy, a.y],
    [dy, bounds.height - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (p < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum > maximum) return null;
  }
  return [
    { x: a.x + minimum * dx, y: a.y + minimum * dy },
    { x: a.x + maximum * dx, y: a.y + maximum * dy },
  ];
}

export function channelPoints(
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
): ScreenPoint[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const square = dx * dx + dy * dy;
  if (square < 1e-9) return [a, b, c, c];
  const projection = ((c.x - a.x) * dx + (c.y - a.y) * dy) / square;
  const offset = {
    x: c.x - a.x - projection * dx,
    y: c.y - a.y - projection * dy,
  };
  return [
    a,
    b,
    { x: b.x + offset.x, y: b.y + offset.y },
    { x: a.x + offset.x, y: a.y + offset.y },
  ];
}

export const FIBONACCI_LEVELS = [
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618,
] as const;

export function fibonacciLevels(
  a: ScreenPoint,
  b: ScreenPoint,
  firstPrice: number,
  lastPrice: number,
) {
  return FIBONACCI_LEVELS.map((ratio) => ({
    ratio,
    y: a.y + (b.y - a.y) * ratio,
    price: firstPrice + (lastPrice - firstPrice) * ratio,
  }));
}

/** Move all anchors together, clamping the whole drawing rather than distorting its endpoints. */
export function translateDrawing(
  points: DrawingPoint[],
  logicalDelta: number,
  priceDelta: number,
  bars: ReadonlyArray<{ time: number }>,
): DrawingPoint[] {
  if (!bars.length) return points;
  const indices = points.map(
    (point) => drawingTimeToLogical(point.time, bars) ?? 0,
  );
  const boundedDelta = Math.max(
    -Math.min(...indices),
    Math.min(bars.length - 1 - Math.max(...indices), logicalDelta),
  );
  return points.map((point, index) => ({
    time:
      logicalToDrawingTime(indices[index] + boundedDelta, bars) ?? point.time,
    price: point.price + priceDelta,
  }));
}

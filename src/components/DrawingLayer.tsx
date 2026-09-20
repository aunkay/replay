import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';
import type { Candle } from '../lib/engine';
import { createWorkspaceId } from '../lib/workspaceId';
import {
  channelPoints,
  clipDrawingLine,
  DRAWING_TOOLS,
  drawingPointCount,
  drawingTimeToLogical,
  fibonacciLevels,
  logicalToDrawingTime,
  translateDrawing,
  type Drawing,
  type DrawingPoint,
  type DrawingTool,
  type ScreenPoint,
} from '../lib/drawings';
import './DrawingLayer.css';

export interface DrawingLayerProps {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'>;
  bars: Candle[];
  tool: DrawingTool;
  drawings: Drawing[];
  onChange: (drawings: Drawing[]) => void;
  onToolComplete: () => void;
  color: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

type Drag = {
  id: string;
  handle?: number;
  points: DrawingPoint[];
  start: ScreenPoint;
  logical: number;
  price: number;
  nextPoints?: DrawingPoint[];
};
type Gesture = {
  screen: ScreenPoint;
  anchor: DrawingPoint;
  prior: DrawingPoint[];
};
type Pane = { width: number; height: number; left: number };

function Shapes({
  drawing,
  points,
  pane,
  hit = false,
}: {
  drawing: Drawing;
  points: ScreenPoint[];
  pane: Pane;
  hit?: boolean;
}) {
  const [a, b = a, c = b] = points;
  if (!a) return null;
  const line = (
    from: ScreenPoint,
    to: ScreenPoint,
    key?: string | number,
    dash?: string,
  ) => (
    <line
      key={key}
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      strokeDasharray={dash}
    />
  );
  const label = (point: ScreenPoint, value: string, key?: string | number) =>
    hit ? null : (
      <text
        key={key}
        x={point.x}
        y={point.y}
        fill={drawing.color}
        stroke="#101318"
        strokeWidth="3"
        paintOrder="stroke"
        fontSize="11"
        fontFamily="Inter, sans-serif"
      >
        {value}
      </text>
    );
  const left = Math.min(a.x, b.x),
    top = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x),
    height = Math.abs(b.y - a.y);
  let shape: ReactNode;
  switch (drawing.tool) {
    case 'horizontal':
      shape = (
        <>
          {line({ x: 0, y: a.y }, { x: pane.width, y: a.y })}
          {label(
            { x: 8, y: a.y - 7 },
            drawing.points[0].price.toLocaleString('en-US', {
              maximumFractionDigits: 6,
            }),
          )}
        </>
      );
      break;
    case 'vertical':
      shape = line({ x: a.x, y: 0 }, { x: a.x, y: pane.height });
      break;
    case 'ray':
    case 'extended': {
      const clipped = clipDrawingLine(a, b, pane, drawing.tool);
      shape = clipped ? line(...clipped) : null;
      break;
    }
    case 'rectangle':
      shape = (
        <rect
          x={left}
          y={top}
          width={Math.max(1, width)}
          height={Math.max(1, height)}
          fill={hit ? 'transparent' : `${drawing.color}16`}
          pointerEvents={hit ? 'all' : 'none'}
        />
      );
      break;
    case 'ellipse':
      shape = (
        <ellipse
          cx={left + width / 2}
          cy={top + height / 2}
          rx={Math.max(1, width / 2)}
          ry={Math.max(1, height / 2)}
          fill={hit ? 'transparent' : `${drawing.color}16`}
          pointerEvents={hit ? 'all' : 'none'}
        />
      );
      break;
    case 'channel': {
      const vertices = channelPoints(a, b, c);
      shape = (
        <>
          <polygon
            points={vertices.map((point) => `${point.x},${point.y}`).join(' ')}
            fill={hit ? 'transparent' : `${drawing.color}12`}
            pointerEvents={hit ? 'all' : 'none'}
          />
          {line(
            {
              x: (vertices[0].x + vertices[3].x) / 2,
              y: (vertices[0].y + vertices[3].y) / 2,
            },
            {
              x: (vertices[1].x + vertices[2].x) / 2,
              y: (vertices[1].y + vertices[2].y) / 2,
            },
            'middle',
            '5 5',
          )}
        </>
      );
      break;
    }
    case 'fib':
      shape = (
        <>
          {fibonacciLevels(
            a,
            b,
            drawing.points[0].price,
            drawing.points[1]?.price ?? drawing.points[0].price,
          ).map((level) => (
            <g key={level.ratio}>
              {line({ x: left, y: level.y }, { x: left + width, y: level.y })}
              {label(
                { x: left + 4, y: level.y - 5 },
                `${(level.ratio * 100).toFixed(1)}% · ${level.price.toLocaleString('en-US', { maximumFractionDigits: 6 })}`,
              )}
            </g>
          ))}
        </>
      );
      break;
    case 'arrow': {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const wing = (offset: number) => ({
        x: b.x - 12 * Math.cos(angle + offset),
        y: b.y - 12 * Math.sin(angle + offset),
      });
      const first = wing(0.45),
        second = wing(-0.45);
      shape = (
        <>
          {line(a, b)}
          <polyline
            points={`${first.x},${first.y} ${b.x},${b.y} ${second.x},${second.y}`}
          />
        </>
      );
      break;
    }
    case 'text':
      shape = hit ? (
        <rect
          x={a.x - 4}
          y={a.y - 19}
          width={Math.max(35, (drawing.text?.length ?? 0) * 8)}
          height={26}
          fill="transparent"
          pointerEvents="all"
        />
      ) : (
        <text
          x={a.x}
          y={a.y}
          fill={drawing.color}
          fontSize="14"
          fontFamily="Inter, sans-serif"
          stroke="#101318"
          strokeWidth="4"
          paintOrder="stroke"
        >
          {drawing.text}
        </text>
      );
      break;
    case 'measure': {
      const difference =
        (drawing.points[1]?.price ?? drawing.points[0].price) -
        drawing.points[0].price;
      const percent =
        drawing.points[0].price === 0
          ? 0
          : (difference / drawing.points[0].price) * 100;
      const hours =
        Math.abs(
          (drawing.points[1]?.time ?? drawing.points[0].time) -
            drawing.points[0].time,
        ) / 3600;
      shape = (
        <>
          <rect
            x={left}
            y={top}
            width={width}
            height={height}
            fill={hit ? 'transparent' : `${drawing.color}15`}
            pointerEvents={hit ? 'all' : 'none'}
          />
          {line(a, b, 'diagonal', '4 4')}
          {label(
            { x: Math.max(3, left), y: Math.max(14, top - 8) },
            `${difference >= 0 ? '+' : ''}${difference.toLocaleString('en-US', { maximumFractionDigits: 6 })} (${percent.toFixed(2)}%) · ${hours >= 24 ? `${(hours / 24).toFixed(1)} days` : `${hours.toFixed(1)} h`}`,
          )}
        </>
      );
      break;
    }
    default:
      shape = line(a, b);
  }
  return (
    <g
      className={hit ? 'drawing-hit-shape' : undefined}
      fill="none"
      stroke={hit ? 'transparent' : drawing.color}
      strokeWidth={hit ? 14 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents={hit ? 'stroke' : 'none'}
    >
      {shape}
    </g>
  );
}

export default function DrawingLayer(props: DrawingLayerProps) {
  const { chart, series, bars, tool, drawings, color, selectedId } = props;
  const latest = useRef(props);
  latest.current = props;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const activePointer = useRef<number | null>(null);
  const touches = useRef(new Set<number>());
  const multipleTouches = useRef(false);
  const [touchInput, setTouchInput] = useState(
    () => window.matchMedia('(pointer: coarse)').matches,
  );
  const touchInputRef = useRef(touchInput);
  const [draft, setDraft] = useState<DrawingPoint[]>([]);
  const [preview, setPreview] = useState<DrawingPoint | null>(null);
  const [textPoint, setTextPoint] = useState<DrawingPoint | null>(null);
  const [textValue, setTextValue] = useState('');
  const [dragPreview, setDragPreview] = useState<{
    id: string;
    points: DrawingPoint[];
  } | null>(null);
  const [pane, setPane] = useState<Pane>({ width: 0, height: 0, left: 0 });
  const [, setRevision] = useState(0);
  const clipId = useId().replaceAll(':', '');

  function releasePointer(id: number | null) {
    if (id === null) return;
    try {
      if (svg.current?.hasPointerCapture(id))
        svg.current.releasePointerCapture(id);
    } catch {
      /* A WebView may already have released a cancelled pointer. */
    }
  }

  function cancelInteraction() {
    const id = activePointer.current;
    activePointer.current = null;
    gesture.current = null;
    drag.current = null;
    setDraft([]);
    setPreview(null);
    setTextPoint(null);
    setDragPreview(null);
    releasePointer(id);
  }

  function capturePointer(event: ReactPointerEvent) {
    if (
      multipleTouches.current ||
      (event.pointerType === 'touch' && !event.isPrimary)
    ) {
      cancelInteraction();
      return false;
    }
    activePointer.current = event.pointerId;
    try {
      svg.current?.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic events and interrupted WebView touches may have no capture. */
    }
    return true;
  }

  useEffect(() => {
    const down = (event: PointerEvent) => {
      const touch = event.pointerType === 'touch';
      touchInputRef.current = touch;
      setTouchInput(touch);
      if (!touch) return;
      touches.current.add(event.pointerId);
      if (touches.current.size > 1 || !event.isPrimary) {
        multipleTouches.current = true;
        cancelInteraction();
      }
    };
    const up = (event: PointerEvent) => {
      touches.current.delete(event.pointerId);
      if (touches.current.size === 0) multipleTouches.current = false;
    };
    const cancel = (event: PointerEvent) => {
      if (activePointer.current === event.pointerId) cancelInteraction();
      up(event);
    };
    const blur = () => {
      touches.current.clear();
      multipleTouches.current = false;
      cancelInteraction();
    };
    const visibility = () => {
      if (document.hidden) blur();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      releasePointer(activePointer.current);
    };
  }, []);

  useLayoutEffect(() => {
    try {
      const size = chart.paneSize(0);
      const left = chart.priceScale('left').width();
      if (
        size.width !== pane.width ||
        size.height !== pane.height ||
        left !== pane.left
      )
        setPane({ ...size, left });
    } catch {
      /* Parent chart disposal can precede the layer cleanup. */
    }
  });

  useEffect(() => {
    let mounted = true;
    let frame = 0;
    const refresh = () => {
      if (!mounted || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (mounted) setRevision((revision) => revision + 1);
      });
    };
    const element = chart.chartElement();
    const timeScale = chart.timeScale();
    const resize = new ResizeObserver(refresh);
    resize.observe(element);
    const mutations = new MutationObserver(refresh);
    mutations.observe(element, {
      attributes: true,
      attributeFilter: ['style', 'width', 'height'],
      childList: true,
      subtree: true,
    });
    timeScale.subscribeVisibleLogicalRangeChange(refresh);
    timeScale.subscribeVisibleTimeRangeChange(refresh);
    let touchTap: {
      id: number;
      x: number;
      y: number;
      started: number;
    } | null = null;
    const move = (event: PointerEvent) => {
      if (
        touchTap?.id === event.pointerId &&
        Math.hypot(event.clientX - touchTap.x, event.clientY - touchTap.y) > 8
      )
        touchTap = null;
      if (event.buttons) refresh();
    };
    const deselect = (event: PointerEvent) => {
      if (
        latest.current.tool === 'cursor' &&
        !drag.current &&
        !(event.target as Element).closest('[data-drawing-id]')
      )
        latest.current.onSelect(null);
      if (
        event.pointerType === 'touch' &&
        event.isPrimary &&
        !multipleTouches.current &&
        latest.current.tool === 'cursor'
      )
        touchTap = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          started: event.timeStamp,
        };
      refresh();
    };
    // Observe taps without cancelling events or capturing the chart's pointers.
    // Native chart taps omit a quick second tap during double-tap detection, so
    // drawing selection needs its own movement/duration/cancellation checks.
    const selectTouchDrawing = (event: PointerEvent) => {
      const tap = touchTap;
      touchTap = null;
      if (
        !tap ||
        tap.id !== event.pointerId ||
        event.timeStamp - tap.started > 450 ||
        Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8 ||
        !touchInputRef.current ||
        latest.current.tool !== 'cursor' ||
        multipleTouches.current ||
        !svg.current
      )
        return;
      const bounds = svg.current.getBoundingClientRect();
      const paneSize = chart.paneSize(0);
      const left = chart.priceScale('left').width();
      const x = event.clientX - bounds.left - left;
      const y = event.clientY - bounds.top;
      if (x < 0 || y < 0 || x > paneSize.width || y > paneSize.height) return;
      const point = new DOMPoint(event.clientX, event.clientY);
      const groups = [
        ...svg.current.querySelectorAll<SVGGElement>('[data-drawing-id]'),
      ].reverse();
      for (const group of groups) {
        for (const shape of group.querySelectorAll<SVGGeometryElement>(
          '.drawing-hit-shape line, .drawing-hit-shape polyline, .drawing-hit-shape rect, .drawing-hit-shape ellipse, .drawing-hit-shape polygon',
        )) {
          const matrix = shape.getScreenCTM();
          if (!matrix) continue;
          const local = point.matrixTransform(matrix.inverse());
          const previous = shape.style.pointerEvents;
          shape.style.pointerEvents = 'all';
          let hit = false;
          try {
            hit =
              shape.isPointInStroke(local) ||
              (getComputedStyle(shape).fill !== 'none' &&
                shape.isPointInFill(local));
          } finally {
            shape.style.pointerEvents = previous;
          }
          if (hit) {
            latest.current.onSelect(group.dataset.drawingId ?? null);
            return;
          }
        }
      }
      latest.current.onSelect(null);
    };
    const cancelTap = () => {
      touchTap = null;
    };
    const additionalTouch = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && multipleTouches.current) cancelTap();
    };
    element.addEventListener('pointerdown', deselect);
    element.addEventListener('wheel', refresh, { passive: true });
    window.addEventListener('pointerdown', additionalTouch, { passive: true });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', selectTouchDrawing, { passive: true });
    window.addEventListener('pointerup', refresh);
    window.addEventListener('pointercancel', cancelTap, { passive: true });
    window.addEventListener('blur', cancelTap);
    refresh();
    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      element.removeEventListener('pointerdown', deselect);
      element.removeEventListener('wheel', refresh);
      window.removeEventListener('pointerdown', additionalTouch);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', selectTouchDrawing);
      window.removeEventListener('pointerup', refresh);
      window.removeEventListener('pointercancel', cancelTap);
      window.removeEventListener('blur', cancelTap);
      try {
        timeScale.unsubscribeVisibleLogicalRangeChange(refresh);
        timeScale.unsubscribeVisibleTimeRangeChange(refresh);
      } catch {
        /* Chart may already have been disposed. */
      }
    };
  }, [chart]);

  useEffect(() => {
    cancelInteraction();
  }, [tool]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      if (event.key === 'Escape') {
        cancelInteraction();
        latest.current.onSelect(null);
        latest.current.onToolComplete();
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        latest.current.selectedId
      ) {
        event.preventDefault();
        latest.current.onChange(
          latest.current.drawings.filter(
            (drawing) => drawing.id !== latest.current.selectedId,
          ),
        );
        latest.current.onSelect(null);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  function screenPoint(event: {
    clientX: number;
    clientY: number;
  }): ScreenPoint {
    const bounds = svg.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(pane.width, event.clientX - bounds.left - pane.left),
      ),
      y: Math.max(0, Math.min(pane.height, event.clientY - bounds.top)),
    };
  }

  function anchor(point: ScreenPoint): DrawingPoint | null {
    const logical = chart.timeScale().coordinateToLogical(point.x);
    const price = series.coordinateToPrice(point.y);
    const time = logical === null ? null : logicalToDrawingTime(logical, bars);
    return time !== null && price !== null && Number.isFinite(price)
      ? { time, price }
      : null;
  }

  function project(point: DrawingPoint): ScreenPoint | null {
    const logical = drawingTimeToLogical(point.time, bars);
    const x =
      logical === null
        ? null
        : chart.timeScale().logicalToCoordinate(logical as Logical);
    const y = series.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x, y };
  }

  function finish(points: DrawingPoint[], text?: string) {
    const current = latest.current;
    if (current.tool === 'cursor') return;
    const drawing: Drawing = {
      id: `drawing-${createWorkspaceId()}`,
      tool: current.tool,
      points,
      color: current.color,
      ...(text ? { text } : {}),
    };
    current.onChange([...current.drawings, drawing]);
    current.onSelect(drawing.id);
    setDraft([]);
    setPreview(null);
    setTextPoint(null);
    gesture.current = null;
    current.onToolComplete();
  }

  function startPoint(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool === 'cursor' || textPoint || event.button !== 0) return;
    event.preventDefault();
    if (!capturePointer(event)) return;
    const screen = screenPoint(event);
    const point = anchor(screen);
    if (!point) {
      cancelInteraction();
      return;
    }
    svg.current?.focus({ preventScroll: true });
    props.onSelect(null);
    gesture.current = { screen, anchor: point, prior: draft };
    if (!draft.length) {
      setDraft([point]);
    }
    setPreview(point);
  }

  function startDrag(
    event: ReactPointerEvent,
    drawing: Drawing,
    handle?: number,
  ) {
    if (tool !== 'cursor' || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    if (!capturePointer(event)) return;
    const start = screenPoint(event);
    const logical = chart.timeScale().coordinateToLogical(start.x);
    const price = series.coordinateToPrice(start.y);
    if (logical === null || price === null) {
      cancelInteraction();
      return;
    }
    props.onSelect(drawing.id);
    svg.current?.focus({ preventScroll: true });
    drag.current = {
      id: drawing.id,
      handle,
      points: drawing.points,
      start,
      logical,
      price,
    };
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (
      multipleTouches.current ||
      (activePointer.current !== null &&
        event.pointerId !== activePointer.current) ||
      (event.pointerType === 'touch' &&
        event.pointerId !== activePointer.current)
    )
      return;
    const screen = screenPoint(event);
    const point = anchor(screen);
    if (!point) return;
    const active = drag.current;
    if (active) {
      const logical = chart.timeScale().coordinateToLogical(screen.x);
      if (logical === null) return;
      const points =
        active.handle === undefined
          ? translateDrawing(
              active.points,
              logical - active.logical,
              point.price - active.price,
              bars,
            )
          : active.points.map((old, index) =>
              index === active.handle ? point : old,
            );
      active.nextPoints = points;
      setDragPreview({ id: active.id, points });
    } else if (tool !== 'cursor' && draft.length) setPreview(point);
  }

  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerId !== activePointer.current) return;
    if (multipleTouches.current) {
      cancelInteraction();
      return;
    }
    const initial = gesture.current;
    const moved = drag.current;
    activePointer.current = null;
    if (moved?.nextPoints)
      latest.current.onChange(
        latest.current.drawings.map((drawing) =>
          drawing.id === moved.id
            ? { ...drawing, points: moved.nextPoints! }
            : drawing,
        ),
      );
    setDragPreview(null);
    gesture.current = null;
    drag.current = null;
    releasePointer(event.pointerId);
    if (!initial || tool === 'cursor') return;
    const screen = screenPoint(event);
    const point = anchor(screen);
    if (!point) return;
    if (tool === 'text') {
      setDraft([]);
      setPreview(null);
      setTextPoint(point);
      setTextValue('');
      return;
    }
    const count = drawingPointCount(tool);
    if (count === 1) {
      finish([point]);
      return;
    }
    const movedEnough =
      Math.hypot(screen.x - initial.screen.x, screen.y - initial.screen.y) >= 5;
    const points = initial.prior.length
      ? [...initial.prior, point]
      : movedEnough
        ? [initial.anchor, point]
        : [initial.anchor];
    if (points.length >= count) finish(points);
    else {
      setDraft(points);
      setPreview(point);
    }
  }

  const draftPoints = draft.length
    ? [...draft, ...(preview ? [preview] : [])]
    : [];
  const draftTool =
    tool === 'channel' && draftPoints.length < 3 ? 'trendline' : tool;
  const textScreen = textPoint ? project(textPoint) : null;
  const draftDrawing: Drawing | null =
    draftTool !== 'cursor' && draftPoints.length > 1
      ? { id: 'draft', tool: draftTool, color, points: draftPoints }
      : null;

  return (
    <>
      <svg
        ref={svg}
        className={`drawing-layer ${tool !== 'cursor' ? 'drawing-active' : ''} ${touchInput ? 'drawing-touch' : ''}`}
        role="region"
        aria-label="Drawing canvas"
        tabIndex={-1}
        onPointerDown={startPoint}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={cancelInteraction}
        onLostPointerCapture={(event) => {
          if (event.pointerId === activePointer.current) cancelInteraction();
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect width={pane.width} height={pane.height} />
          </clipPath>
        </defs>
        <g
          transform={`translate(${pane.left}, 0)`}
          clipPath={`url(#${clipId})`}
        >
          <rect
            data-testid="drawing-surface"
            width={pane.width}
            height={pane.height}
            fill="transparent"
            pointerEvents={tool !== 'cursor' && !textPoint ? 'all' : 'none'}
          />
          {drawings.map((storedDrawing) => {
            const drawing =
              dragPreview?.id === storedDrawing.id
                ? { ...storedDrawing, points: dragPreview.points }
                : storedDrawing;
            const projected = drawing.points.map(project);
            if (projected.some((point) => point === null)) return null;
            const points = projected as ScreenPoint[];
            const selected = drawing.id === selectedId;
            return (
              <g
                key={drawing.id}
                data-testid={`drawing-${drawing.id}`}
                data-drawing-id={drawing.id}
                data-drawing-tool={drawing.tool}
                role="button"
                aria-label={`${DRAWING_TOOLS.find(({ id }) => id === drawing.tool)?.label ?? drawing.tool} drawing`}
                aria-pressed={selected}
                tabIndex={tool === 'cursor' ? 0 : -1}
                onPointerDown={(event) => startDrag(event, drawing)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onSelect(drawing.id);
                  }
                }}
              >
                <Shapes drawing={drawing} points={points} pane={pane} />
                {tool === 'cursor' && (
                  <Shapes drawing={drawing} points={points} pane={pane} hit />
                )}
                {selected &&
                  tool === 'cursor' &&
                  points.map((point, index) => (
                    <g key={index}>
                      <circle
                        data-testid={`drawing-handle-${index}`}
                        aria-label={`Drawing anchor ${index + 1}`}
                        cx={point.x}
                        cy={point.y}
                        r={touchInput ? 22 : 9}
                        fill="transparent"
                        pointerEvents="all"
                        className="drawing-handle"
                        onPointerDown={(event) =>
                          startDrag(event, drawing, index)
                        }
                      />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={5}
                        fill="#101318"
                        stroke={drawing.color}
                        strokeWidth={2}
                        pointerEvents="none"
                      />
                    </g>
                  ))}
              </g>
            );
          })}
          {draftDrawing && (
            <g opacity={0.8} data-testid="drawing-preview">
              <Shapes
                drawing={draftDrawing}
                points={draftDrawing.points
                  .map(project)
                  .filter((point): point is ScreenPoint => point !== null)}
                pane={pane}
              />
            </g>
          )}
        </g>
      </svg>
      {tool !== 'cursor' && !textPoint && (
        <div className="drawing-instructions" role="status">
          {draft.length === 0
            ? drawingPointCount(tool) === 1
              ? touchInput
                ? 'Tap to place'
                : 'Click to place'
              : touchInput
                ? 'Tap or drag to start'
                : 'Click or drag to start'
            : tool === 'channel' && draft.length === 2
              ? touchInput
                ? 'Tap to set channel width'
                : 'Click to set channel width'
              : touchInput
                ? 'Tap to finish'
                : 'Click to finish'}{' '}
          · {touchInput ? 'Cursor cancels' : 'Esc to cancel'}
        </div>
      )}
      {textPoint && textScreen && (
        <form
          className="drawing-text-editor"
          style={{
            left: Math.max(
              5,
              Math.min(pane.width - 235, textScreen.x + pane.left),
            ),
            top: Math.max(5, Math.min(pane.height - 80, textScreen.y)),
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (textValue.trim()) finish([textPoint], textValue.trim());
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              setTextPoint(null);
              props.onToolComplete();
            }
          }}
        >
          <input
            autoFocus
            aria-label="Text annotation"
            placeholder="Add a chart note…"
            maxLength={200}
            value={textValue}
            onChange={(event) => setTextValue(event.target.value)}
          />
          <div>
            <button type="submit" disabled={!textValue.trim()}>
              Add text
            </button>
            <button
              type="button"
              onClick={() => {
                setTextPoint(null);
                props.onToolComplete();
              }}
            >
              Cancel text
            </button>
          </div>
        </form>
      )}
    </>
  );
}

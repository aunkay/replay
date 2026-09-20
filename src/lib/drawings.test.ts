import { describe, expect, it } from 'vitest';
import {
  channelPoints,
  clipDrawingLine,
  drawingPointCount,
  drawingTimeToLogical,
  fibonacciLevels,
  isValidDrawing,
  logicalToDrawingTime,
  translateDrawing,
  type Drawing,
} from './drawings';

describe('drawing geometry', () => {
  const bounds = { width: 100, height: 80 };

  it('extends a ray forward to the first chart boundary', () => {
    expect(
      clipDrawingLine({ x: 20, y: 20 }, { x: 30, y: 30 }, bounds, 'ray'),
    ).toEqual([
      { x: 20, y: 20 },
      { x: 80, y: 80 },
    ]);
    expect(
      clipDrawingLine({ x: 30, y: 30 }, { x: 20, y: 20 }, bounds, 'ray'),
    ).toEqual([
      { x: 30, y: 30 },
      { x: 0, y: 0 },
    ]);
  });

  it('clips infinite horizontal and vertical lines without division by zero', () => {
    expect(
      clipDrawingLine({ x: 30, y: 15 }, { x: 70, y: 15 }, bounds, 'extended'),
    ).toEqual([
      { x: 0, y: 15 },
      { x: 100, y: 15 },
    ]);
    const vertical = clipDrawingLine(
      { x: 30, y: 15 },
      { x: 30, y: 70 },
      bounds,
      'extended',
    )!;
    expect(vertical[0].x).toBe(30);
    expect(vertical[0].y).toBeCloseTo(0);
    expect(vertical[1]).toEqual({ x: 30, y: 80 });
  });

  it('rejects lines outside the chart and zero-length drafts', () => {
    expect(
      clipDrawingLine({ x: -5, y: 0 }, { x: -5, y: 50 }, bounds, 'extended'),
    ).toBeNull();
    expect(
      clipDrawingLine({ x: 10, y: 10 }, { x: 10, y: 10 }, bounds, 'ray'),
    ).toBeNull();
    expect(
      clipDrawingLine({ x: 120, y: 10 }, { x: 150, y: 10 }, bounds, 'ray'),
    ).toBeNull();
  });

  it('clips finite segments without extending their endpoints', () => {
    expect(
      clipDrawingLine({ x: -10, y: 10 }, { x: 20, y: 40 }, bounds),
    ).toEqual([
      { x: 0, y: 20 },
      { x: 20, y: 40 },
    ]);
  });

  it('builds a parallel channel through the third point', () => {
    const [a, b, c, d] = channelPoints(
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 10 },
    );
    expect({ x: c.x - d.x, y: c.y - d.y }).toEqual({
      x: b.x - a.x,
      y: b.y - a.y,
    });
    expect((d.x - a.x) * (b.x - a.x) + (d.y - a.y) * (b.y - a.y)).toBeCloseTo(
      0,
    );
    expect(d).toEqual({ x: -5, y: 5 });
    expect(c).toEqual({ x: 15, y: 25 });
  });

  it('keeps Fibonacci price levels aligned with the price axis in both directions', () => {
    const upward = fibonacciLevels(
      { x: 10, y: 70 },
      { x: 80, y: 20 },
      100,
      200,
    );
    const middle = upward.find((level) => level.ratio === 0.5)!;
    expect(middle).toEqual({ ratio: 0.5, y: 45, price: 150 });
    const golden = upward.find((level) => level.ratio === 0.618)!;
    expect(golden.price).toBeCloseTo(161.8);
    expect(golden.y).toBeCloseTo(39.1);
    const downward = fibonacciLevels(
      { x: 10, y: 20 },
      { x: 80, y: 70 },
      200,
      100,
    );
    expect(downward.find((level) => level.ratio === 0.618)!.price).toBeCloseTo(
      138.2,
    );
  });
});

describe('persistent time and price anchors', () => {
  // Market closes create unequal timestamp gaps despite equally spaced chart bars.
  const bars = [{ time: 100 }, { time: 200 }, { time: 500 }, { time: 600 }];

  it('round-trips between-bar positions across a market gap', () => {
    expect(logicalToDrawingTime(1.5, bars)).toBe(350);
    expect(drawingTimeToLogical(350, bars)).toBe(1.5);
    expect(drawingTimeToLogical(500, bars)).toBe(2);
  });

  it('clamps new anchors to revealed history without inventing future candles', () => {
    expect(logicalToDrawingTime(-5, bars)).toBe(100);
    expect(logicalToDrawingTime(99, bars)).toBe(600);
    expect(logicalToDrawingTime(2, [])).toBeNull();
    expect(logicalToDrawingTime(5, [{ time: 100 }])).toBe(100);
  });

  it('moves a drawing by chart bars rather than elapsed seconds', () => {
    const points = [
      { time: 100, price: 20 },
      { time: 200, price: 30 },
    ];
    expect(translateDrawing(points, 1, 5, bars)).toEqual([
      { time: 200, price: 25 },
      { time: 500, price: 35 },
    ]);
    expect(points).toEqual([
      { time: 100, price: 20 },
      { time: 200, price: 30 },
    ]);
  });

  it('clamps the entire translated drawing while preserving its geometry', () => {
    expect(
      translateDrawing(
        [
          { time: 200, price: 20 },
          { time: 500, price: 30 },
        ],
        10,
        -5,
        bars,
      ),
    ).toEqual([
      { time: 500, price: 15 },
      { time: 600, price: 25 },
    ]);
    expect(
      translateDrawing(
        [
          { time: 200, price: 20 },
          { time: 500, price: 30 },
        ],
        -10,
        0,
        bars,
      ),
    ).toEqual([
      { time: 100, price: 20 },
      { time: 200, price: 30 },
    ]);
  });

  it('validates saved drawings and rejects unsafe geometry or inconsistent anchor counts', () => {
    const valid: Drawing = {
      id: 'one',
      tool: 'trendline',
      color: '#abcdef',
      points: [
        { time: 150.5, price: 20 },
        { time: 200, price: 30 },
      ],
    };
    expect(isValidDrawing(valid)).toBe(true);
    expect(isValidDrawing({ ...valid, tool: 'unknown' })).toBe(false);
    expect(isValidDrawing({ ...valid, tool: 'cursor' })).toBe(false);
    expect(
      isValidDrawing({ ...valid, color: 'url(https://example.com)' }),
    ).toBe(false);
    expect(
      isValidDrawing({
        ...valid,
        points: [{ time: Infinity, price: 20 }, valid.points[1]],
      }),
    ).toBe(false);
    expect(isValidDrawing({ ...valid, points: valid.points.slice(0, 1) })).toBe(
      false,
    );
    expect(isValidDrawing({ ...valid, text: 'x'.repeat(201) })).toBe(false);
    expect(drawingPointCount('channel')).toBe(3);
    expect(drawingPointCount('text')).toBe(1);
  });
});

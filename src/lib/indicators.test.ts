import { describe, expect, it } from 'vitest';
import type { Candle } from './engine';
import {
  computeIndicator,
  INDICATORS,
  type IndicatorId,
  type IndicatorInstance,
} from './indicators';

const start = Date.parse('2025-01-06T10:00:00Z') / 1000;
function candles(closes: number[], volumes?: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: start + i * 900,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: volumes?.[i] ?? 1_000,
  }));
}
function instance(
  indicatorId: IndicatorId,
  period?: number,
): IndicatorInstance {
  return {
    id: `test-${indicatorId}`,
    indicatorId,
    period:
      period ??
      INDICATORS.find((item) => item.id === indicatorId)!.defaultPeriod,
    color: '#ab89ef',
  };
}
const values = (id: IndicatorId, bars: Candle[], period?: number, plot = 0) =>
  computeIndicator(instance(id, period), bars)[plot].data.map(
    (point) => point.value,
  );
function expectNumbers(actual: number[], expected: number[], precision = 9) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) =>
    expect(value).toBeCloseTo(expected[i], precision),
  );
}

describe('indicator catalog', () => {
  it('provides exactly the 50 promised indicators with usable metadata', () => {
    const ids =
      'sma ema wma dema tema hma vwma smma zlema kama t3 alma linreg bbands donchian keltner ichimoku supertrend psar vwap rsi stochastic stochrsi macd ppo roc momentum cci williamsr awesome ultimate trix cmo dpo tsi fisher adx aroon vortex atr natr stddev bbwidth percentb choppiness obv ad cmf mfi force'.split(
        ' ',
      );
    expect(INDICATORS.map((entry) => entry.id)).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
    for (const entry of INDICATORS) {
      expect(entry.name.length).toBeGreaterThan(2);
      expect(entry.shortName.length).toBeGreaterThan(1);
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.defaultPeriod).toBeGreaterThanOrEqual(entry.minPeriod);
      expect(entry.defaultPeriod).toBeLessThanOrEqual(entry.maxPeriod);
    }
  });
});

describe('hand-calculated moving averages', () => {
  const bars = candles([10, 12, 14, 12, 16]);
  it('SMA, WMA, EMA and Wilder SMMA use their distinct weights and full seeds', () => {
    expectNumbers(values('sma', bars, 3), [12, 38 / 3, 14]);
    expectNumbers(values('wma', bars, 3), [76 / 6, 76 / 6, 86 / 6]);
    expectNumbers(values('ema', bars, 3), [12, 12, 14]);
    expectNumbers(values('smma', bars, 3), [12, 12, 40 / 3]);
    expectNumbers(values('dema', bars, 3), [46 / 3]);
  });

  it('volume weights differ from a price-only average and ignore empty volume windows', () => {
    expectNumbers(
      values('vwma', candles([10, 20, 30], [1, 3, 2]), 2),
      [17.5, 24],
    );
    expect(values('vwma', candles([10, 20, 30], [0, 0, 0]), 2)).toEqual([]);
  });

  it('HMA, ZLEMA and the regression endpoint remove lag on a straight rising line', () => {
    const line = candles(Array.from({ length: 15 }, (_, i) => i + 10));
    expectNumbers(
      values('hma', line, 4),
      line.slice(4).map((bar) => bar.close),
    );
    expectNumbers(
      values('zlema', line, 3),
      line.slice(3).map((bar) => bar.close),
    );
    expectNumbers(
      values('linreg', line, 4),
      line.slice(3).map((bar) => bar.close),
    );
  });

  it('KAMA applies a squared fast smoothing factor on a perfectly efficient trend', () => {
    const trend = candles([10, 11, 12, 13, 14]);
    const first = 12 + ((13 - 12) * 4) / 9;
    const second = first + ((14 - first) * 4) / 9;
    expectNumbers(values('kama', trend, 3), [first, second]);
  });

  it('TEMA and T3 preserve a constant price after their full cascaded warm-up', () => {
    const fixed = candles(Array(20).fill(20));
    const tema = computeIndicator(instance('tema', 3), fixed)[0].data;
    const t3 = computeIndicator(instance('t3', 3), fixed)[0].data;
    expect(tema[0].time).toBe(fixed[6].time);
    expect(t3[0].time).toBe(fixed[12].time);
    expectNumbers(
      tema.map((point) => point.value),
      Array(14).fill(20),
    );
    expectNumbers(
      t3.map((point) => point.value),
      Array(8).fill(20),
    );
  });

  it('ALMA applies the documented Gaussian weights without reversing their age', () => {
    // p=2, offset .85, sigma 6: oldest exponent −3.25125, newest −.10125.
    const oldest = Math.exp(-3.25125),
      newest = Math.exp(-0.10125);
    expectNumbers(values('alma', candles([10, 20]), 2), [
      (10 * oldest + 20 * newest) / (oldest + newest),
    ]);
  });
});

describe('hand-calculated volatility and channels', () => {
  it('Bollinger bands use population deviation, with matching %B and width', () => {
    const bars = candles([10, 12, 14]);
    const std = Math.sqrt(8 / 3);
    const plots = computeIndicator(instance('bbands', 3), bars);
    expectNumbers(
      plots[0].data.map((point) => point.value),
      [12],
    );
    expectNumbers(
      plots[1].data.map((point) => point.value),
      [12 + 2 * std],
    );
    expectNumbers(
      plots[2].data.map((point) => point.value),
      [12 - 2 * std],
    );
    expectNumbers(values('stddev', bars, 3), [std]);
    expectNumbers(values('bbwidth', bars, 3), [(100 * 4 * std) / 12]);
    expectNumbers(values('percentb', bars, 3), [
      (14 - (12 - 2 * std)) / (4 * std),
    ]);
  });

  it('ATR includes overnight gaps and Wilder smoothing; NATR normalizes by close', () => {
    const bars = candles([10, 20, 19]); // True ranges = 2, 11, 2.
    expectNumbers(values('atr', bars, 2), [6.5, 4.25]);
    expectNumbers(values('natr', bars, 2), [32.5, (100 * 4.25) / 19]);
    const plots = computeIndicator(instance('keltner', 2), bars);
    expectNumbers(
      plots[0].data.map((point) => point.value),
      [15, 53 / 3],
    );
    expectNumbers(
      plots[1].data.map((point) => point.value),
      [28, 53 / 3 + 8.5],
    );
    expectNumbers(
      plots[2].data.map((point) => point.value),
      [2, 53 / 3 - 8.5],
    );
  });

  it('Donchian bands use high/low extrema and Ichimoku spans stay at calculation time', () => {
    const bars = candles(Array.from({ length: 12 }, (_, i) => 10 + i));
    const channel = computeIndicator(instance('donchian', 3), bars);
    expect(channel.map((plot) => plot.data[0].value)).toEqual([11, 13, 9]);
    const cloud = computeIndicator(instance('ichimoku', 2), bars);
    expect(cloud[0].data[0]).toEqual({ time: bars[1].time, value: 10.5 });
    expect(cloud[1].data[0]).toEqual({ time: bars[4].time, value: 12 });
    expect(cloud[2].data[0]).toEqual({ time: bars[4].time, value: 12.75 });
    expect(cloud[3].data[0]).toEqual({ time: bars[9].time, value: 14.5 });
  });

  it('Supertrend trails its band and reverses after a closing-price breakout', () => {
    const bars = candles([10, 10, 20, 19, 5]);
    // ATR(2): 2, 6.5, 4.25, 9.625. Close20 breaks upper16. The reversal
    // retains the prior upper31.75 because the new basic band33.875 is higher.
    expectNumbers(values('supertrend', bars, 2), [16, 4, 6.25, 31.75]);
  });

  it('PSAR constrains the stop to previous lows and reverses to the prior extreme', () => {
    const bars = candles([10, 11, 12, 8]);
    expectNumbers(values('psar', bars), [9, 9, 13]);
  });

  it('Choppiness matches a two-bar true-range calculation', () => {
    const bars = candles([10, 11]);
    expectNumbers(values('choppiness', bars, 2), [
      (100 * Math.log10(4 / 3)) / Math.log10(2),
    ]);
  });
});

describe('hand-calculated momentum and directional movement', () => {
  it('RSI and CMO separate gains/losses and use the stated smoothing', () => {
    const bars = candles([10, 12, 11, 13]);
    expectNumbers(values('rsi', bars, 2), [200 / 3, (100 * 1.5) / 1.75]);
    expectNumbers(values('cmo', bars, 2), [100 / 3, 100 / 3]);
    expectNumbers(values('momentum', bars, 2), [1, 1]);
    expectNumbers(values('roc', bars, 2), [10, 100 / 12]);
  });

  it('Stochastic uses 3/3 smoothing and Williams %R retains its negative scale', () => {
    const bars = candles(Array.from({ length: 10 }, (_, i) => 10 + i));
    const stochastic = computeIndicator(instance('stochastic', 3), bars);
    expect(stochastic[0].data[0].time).toBe(bars[4].time);
    expect(stochastic[1].data[0].time).toBe(bars[6].time);
    expectNumbers(
      stochastic[0].data.map((point) => point.value),
      Array(6).fill(75),
    );
    expectNumbers(
      stochastic[1].data.map((point) => point.value),
      Array(4).fill(75),
    );
    expectNumbers(values('williamsr', bars, 3), Array(8).fill(-25));
    expectNumbers(values('stochrsi', bars, 2), Array(5).fill(50));
  });

  it('MACD includes its fixed nine-bar signal and zero histogram for a linear trend', () => {
    const bars = candles(Array.from({ length: 20 }, (_, i) => i + 10));
    const plots = computeIndicator(instance('macd', 2), bars);
    expectNumbers(
      plots[0].data.map((point) => point.value),
      Array(15).fill(2),
    );
    expect(plots[1].data[0].time).toBe(bars[13].time);
    expectNumbers(
      plots[1].data.map((point) => point.value),
      Array(7).fill(2),
    );
    expectNumbers(
      plots[2].data.map((point) => point.value),
      Array(7).fill(0),
    );
    expectNumbers(values('ppo', bars.slice(0, 6), 2), [200 / 12.5]);
    const longer = candles(Array.from({ length: 40 }, (_, i) => i + 100));
    const standard = computeIndicator(instance('macd'), longer);
    expect(standard[0].data[0]).toEqual({ time: longer[25].time, value: 7 });
    expect(standard[1].data[0]).toEqual({ time: longer[33].time, value: 7 });
  });

  it('CCI, DPO and Awesome Oscillator use the documented trailing windows', () => {
    const bars = candles(Array.from({ length: 20 }, (_, i) => i + 10));
    expectNumbers(values('cci', bars, 3), Array(18).fill(100));
    expectNumbers(values('dpo', bars, 4), Array(17).fill(-1.5));
    expectNumbers(values('awesome', bars, 2), Array(8).fill(5.5));
  });

  it('Ultimate Oscillator and Vortex account for previous close/high/low', () => {
    const bars = candles(Array.from({ length: 15 }, (_, i) => i + 10));
    expectNumbers(values('ultimate', bars, 2), Array(7).fill(50));
    const vortex = computeIndicator(instance('vortex', 2), bars);
    expectNumbers(
      vortex[0].data.map((point) => point.value),
      Array(13).fill(1.5),
    );
    expectNumbers(
      vortex[1].data.map((point) => point.value),
      Array(13).fill(0.5),
    );
  });

  it('TRIX and TSI warm up their cascaded averages before producing values', () => {
    const bars = candles(Array.from({ length: 20 }, (_, i) => i + 10));
    expectNumbers(values('trix', bars.slice(0, 5), 2), [100 / 11.5]);
    expectNumbers(values('tsi', bars, 2), Array(18).fill(100));
  });

  it('Fisher begins with the Ehlers logarithmic transform and prior-value signal', () => {
    const bars = candles([10, 11, 12]);
    const first = 0.5 * Math.log(1.33 / 0.67);
    const state = 0.33 + 0.67 * 0.33;
    const second = 0.5 * Math.log((1 + state) / (1 - state)) + first / 2;
    expectNumbers(values('fisher', bars, 2), [first, second]);
    expectNumbers(values('fisher', bars, 2, 1), [0, first]);
  });

  it('ADX distinguishes trend strength from +DI/−DI and Aroon uses most-recent extremes', () => {
    const bars = candles([10, 11, 12, 13, 14]);
    const adx = computeIndicator(instance('adx', 2), bars);
    expectNumbers(
      adx[0].data.map((point) => point.value),
      [100, 100],
    );
    expectNumbers(
      adx[1].data.map((point) => point.value),
      [50, 50, 50],
    );
    expectNumbers(
      adx[2].data.map((point) => point.value),
      [0, 0, 0],
    );
    const aroon = computeIndicator(
      instance('aroon', 2),
      candles([10, 12, 12, 11]),
    );
    expectNumbers(
      aroon[0].data.map((point) => point.value),
      [100, 50],
    );
    expectNumbers(
      aroon[1].data.map((point) => point.value),
      [0, 100],
    );
  });
});

describe('hand-calculated volume indicators', () => {
  it('VWAP is cumulative within a UTC day and resets on the next day', () => {
    const bars = candles([10, 20, 30], [1, 3, 2]);
    bars[2].time = start + 86400;
    expectNumbers(values('vwap', bars), [10, 17.5, 30]);
    expect(values('vwap', candles([10, 20], [0, 0]))).toEqual([]);
  });

  it('OBV adds direction-signed volume and does not count unchanged closes', () => {
    expectNumbers(
      values('obv', candles([10, 12, 11, 11], [100, 200, 300, 400])),
      [0, 200, -100, -100],
    );
  });

  it('A/D and CMF use the close location inside the high-low range', () => {
    const bars = candles([10, 11, 12], [100, 200, 300]);
    bars[0] = { ...bars[0], high: 10, low: 8 }; // +100 flow
    bars[1] = { ...bars[1], high: 13, low: 11 }; // −200 flow
    expectNumbers(values('ad', bars), [100, -100, -100]);
    expectNumbers(values('cmf', bars, 2), [-1 / 3, -0.4]);
  });

  it('MFI signs typical-price flow while Elder Force smooths price-change × volume', () => {
    const bars = candles([10, 12, 11, 13], [100, 200, 300, 400]);
    expectNumbers(values('mfi', bars, 2), [
      (100 * 2400) / 5700,
      (100 * 5200) / 8500,
    ]);
    expectNumbers(values('force', bars, 2), [50, 550]);
  });
});

describe.each(INDICATORS)(
  '$shortName causality and edge cases',
  (definition) => {
    const selected = instance(definition.id);
    const market = candles(
      Array.from(
        { length: 360 },
        (_, i) => 100 + i * 0.2 + 7 * Math.sin(i / 6) + (i >= 130 ? 30 : 0),
      ),
    );
    market.forEach((bar, index) => {
      bar.time += Math.floor(index / 25) * 86400;
      bar.volume += (index % 7) * 100;
    });

    it('produces finite, chronological plots after warm-up without mutating candles', () => {
      const input = structuredClone(market);
      input.forEach(Object.freeze);
      Object.freeze(input);
      const result = computeIndicator(selected, input);
      expect(result.length).toBeGreaterThan(0);
      expect(new Set(result.map((plot) => plot.key)).size).toBe(result.length);
      const timestamps = new Set(input.map((bar) => bar.time));
      for (const plot of result) {
        expect(plot.data.length).toBeGreaterThan(0);
        for (const [index, point] of plot.data.entries()) {
          expect(Number.isFinite(point.value)).toBe(true);
          expect(timestamps.has(point.time)).toBe(true);
          if (index)
            expect(point.time).toBeGreaterThan(plot.data[index - 1].time);
        }
      }
      expect(input).toEqual(market);
    });

    it('never revises prior values when future candles are appended or changed', () => {
      const complete = computeIndicator(selected, market);
      for (const length of [0, 1, 2, 9, 20, 37, 80, 141, 250]) {
        const prefix = computeIndicator(selected, market.slice(0, length));
        expect(prefix).toEqual(
          complete.map((plot) => ({
            ...plot,
            data: plot.data.filter(
              (point) => length > 0 && point.time <= market[length - 1].time,
            ),
          })),
        );
      }
      const alteredFuture = market.map((bar, i) =>
        i < 100
          ? bar
          : { ...bar, open: 1_000, high: 1_001, low: 999, close: 1_000 },
      );
      const changed = computeIndicator(selected, alteredFuture);
      expect(
        changed.map((plot) =>
          plot.data.filter((point) => point.time < market[100].time),
        ),
      ).toEqual(
        complete.map((plot) =>
          plot.data.filter((point) => point.time < market[100].time),
        ),
      );
    });

    it('handles flat prices, zero volume, empty history, and out-of-range periods', () => {
      const flat = candles(Array(360).fill(100), Array(360).fill(0)).map(
        (bar) => ({ ...bar, high: 100, low: 100 }),
      );
      expect(
        computeIndicator(selected, []).every((plot) => plot.data.length === 0),
      ).toBe(true);
      for (const period of [
        definition.defaultPeriod,
        definition.minPeriod,
        0,
        -4,
        NaN,
        Infinity,
        10_000,
      ]) {
        const plots = computeIndicator({ ...selected, period }, flat);
        for (const plot of plots)
          expect(plot.data.every((point) => Number.isFinite(point.value))).toBe(
            true,
          );
      }
      const normal = computeIndicator(selected, flat);
      if (!['vwap', 'vwma'].includes(definition.id))
        expect(normal.some((plot) => plot.data.length > 0)).toBe(true);
    });
  },
);

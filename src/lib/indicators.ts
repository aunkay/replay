import type { Candle } from './engine';

export type IndicatorId =
  | 'sma'
  | 'ema'
  | 'wma'
  | 'dema'
  | 'tema'
  | 'hma'
  | 'vwma'
  | 'smma'
  | 'zlema'
  | 'kama'
  | 't3'
  | 'alma'
  | 'linreg'
  | 'bbands'
  | 'donchian'
  | 'keltner'
  | 'ichimoku'
  | 'supertrend'
  | 'psar'
  | 'vwap'
  | 'rsi'
  | 'stochastic'
  | 'stochrsi'
  | 'macd'
  | 'ppo'
  | 'roc'
  | 'momentum'
  | 'cci'
  | 'williamsr'
  | 'awesome'
  | 'ultimate'
  | 'trix'
  | 'cmo'
  | 'dpo'
  | 'tsi'
  | 'fisher'
  | 'adx'
  | 'aroon'
  | 'vortex'
  | 'atr'
  | 'natr'
  | 'stddev'
  | 'bbwidth'
  | 'percentb'
  | 'choppiness'
  | 'obv'
  | 'ad'
  | 'cmf'
  | 'mfi'
  | 'force';

export type IndicatorDefinition = {
  id: IndicatorId;
  name: string;
  shortName: string;
  category: 'Trend' | 'Momentum' | 'Volatility' | 'Volume';
  pane: 'overlay' | 'oscillator';
  description: string;
  defaultPeriod: number;
  minPeriod: number;
  maxPeriod: number;
};
export type IndicatorInstance = {
  id: string;
  indicatorId: IndicatorId;
  period: number;
  color: string;
};
export type IndicatorPlot = {
  key: string;
  label: string;
  kind: 'line' | 'histogram';
  color?: string;
  data: { time: number; value: number }[];
};

const definition = (
  id: IndicatorId,
  name: string,
  shortName: string,
  category: IndicatorDefinition['category'],
  pane: IndicatorDefinition['pane'],
  defaultPeriod: number,
  description: string,
): IndicatorDefinition => ({
  id,
  name,
  shortName,
  category,
  pane,
  defaultPeriod,
  description,
  minPeriod: defaultPeriod === 1 ? 1 : 2,
  maxPeriod: defaultPeriod === 1 ? 1 : 500,
});

/** Period is the primary length; secondary parameters and causal variants are explicit. */
export const INDICATORS: IndicatorDefinition[] = [
  definition(
    'sma',
    'Simple Moving Average',
    'SMA',
    'Trend',
    'overlay',
    20,
    'Arithmetic mean of closing prices over the selected period.',
  ),
  definition(
    'ema',
    'Exponential Moving Average',
    'EMA',
    'Trend',
    'overlay',
    20,
    'Close-price EMA with alpha 2/(period + 1), initialized with a full-period SMA.',
  ),
  definition(
    'wma',
    'Weighted Moving Average',
    'WMA',
    'Trend',
    'overlay',
    20,
    'Closing prices weighted from 1 for the oldest bar to period for the newest.',
  ),
  definition(
    'dema',
    'Double Exponential Moving Average',
    'DEMA',
    'Trend',
    'overlay',
    20,
    'Twice the EMA minus the EMA of that EMA; both use the selected period.',
  ),
  definition(
    'tema',
    'Triple Exponential Moving Average',
    'TEMA',
    'Trend',
    'overlay',
    20,
    'Three times the first EMA minus three times the second plus the third EMA.',
  ),
  definition(
    'hma',
    'Hull Moving Average',
    'HMA',
    'Trend',
    'overlay',
    20,
    'WMA of 2 × WMA(period/2) − WMA(period), with floor(sqrt(period)) final smoothing; lengths are floored.',
  ),
  definition(
    'vwma',
    'Volume Weighted Moving Average',
    'VWMA',
    'Trend',
    'overlay',
    20,
    'Rolling sum of close × volume divided by rolling volume. Zero-volume windows are omitted.',
  ),
  definition(
    'smma',
    'Smoothed Moving Average',
    'SMMA',
    'Trend',
    'overlay',
    20,
    'Wilder smoothing of close with alpha 1/period and a full-period SMA seed.',
  ),
  definition(
    'zlema',
    'Zero Lag Exponential Moving Average',
    'ZLEMA',
    'Trend',
    'overlay',
    20,
    'EMA of 2 × close − close[floor((period − 1)/2)]. Full lag and EMA warm-up are required.',
  ),
  definition(
    'kama',
    'Kaufman Adaptive Moving Average',
    'KAMA',
    'Trend',
    'overlay',
    10,
    'Period controls the efficiency-ratio window; fast length 2, slow length 30. Seed is the close preceding the first complete efficiency window.',
  ),
  definition(
    't3',
    'Tillson T3 Moving Average',
    'T3',
    'Trend',
    'overlay',
    5,
    'Six cascaded period EMAs combined with Tillson volume factor 0.7.',
  ),
  definition(
    'alma',
    'Arnaud Legoux Moving Average',
    'ALMA',
    'Trend',
    'overlay',
    9,
    'Gaussian-weighted closing prices with offset 0.85 and sigma 6.',
  ),
  definition(
    'linreg',
    'Linear Regression',
    'Linear regression',
    'Trend',
    'overlay',
    20,
    'Least-squares line fitted to the trailing period, evaluated at the current bar; no forecast or displacement.',
  ),
  definition(
    'bbands',
    'Bollinger Bands',
    'BB',
    'Volatility',
    'overlay',
    20,
    'Period SMA of close with upper/lower bands at 2 population standard deviations.',
  ),
  definition(
    'donchian',
    'Donchian Channels',
    'Donchian',
    'Volatility',
    'overlay',
    20,
    'Highest high, lowest low, and their midpoint over the trailing period including the current candle.',
  ),
  definition(
    'keltner',
    'Keltner Channels',
    'Keltner',
    'Volatility',
    'overlay',
    20,
    'Period EMA of close with upper/lower bands at 2 × Wilder ATR of the same period.',
  ),
  definition(
    'ichimoku',
    'Ichimoku Cloud',
    'Ichimoku',
    'Trend',
    'overlay',
    9,
    'Conversion length p, base 3p−1, span B 6p−2 (9/26/52 by default). Spans are shown at calculation time without displacement; lagging close is omitted to prevent replay lookahead.',
  ),
  definition(
    'supertrend',
    'Supertrend',
    'Supertrend',
    'Trend',
    'overlay',
    10,
    'Trailing high-low midpoint bands at 3 × Wilder ATR(period); initial direction is down until price breaks the upper band.',
  ),
  definition(
    'psar',
    'Parabolic SAR',
    'PSAR',
    'Trend',
    'overlay',
    1,
    'Parabolic stop and reverse with acceleration step 0.02, maximum 0.20, and the prior two bars constraining each stop. No period parameter.',
  ),
  definition(
    'vwap',
    'Volume Weighted Average Price',
    'VWAP',
    'Volume',
    'overlay',
    1,
    'Cumulative typical-price × volume / volume, reset at each UTC calendar day. Zero-volume prefixes are omitted; no period parameter.',
  ),
  definition(
    'rsi',
    'Relative Strength Index',
    'RSI',
    'Momentum',
    'oscillator',
    14,
    'Wilder-smoothed close gains and losses over the period. A completely flat window is neutral at 50.',
  ),
  definition(
    'stochastic',
    'Stochastic Oscillator',
    'Stochastic',
    'Momentum',
    'oscillator',
    14,
    'Raw %K over period high/low, smoothed by SMA(3), with %D = SMA(3) of smoothed %K. A flat range is 50.',
  ),
  definition(
    'stochrsi',
    'Stochastic RSI',
    'Stoch RSI',
    'Momentum',
    'oscillator',
    14,
    'RSI(period), stochastic range over the same period, then 3-bar %K and 3-bar %D smoothing; 0–100 scale.',
  ),
  definition(
    'macd',
    'Moving Average Convergence Divergence',
    'MACD',
    'Momentum',
    'oscillator',
    12,
    'Fast EMA(period), slow EMA(2 × period + 2), 9-bar EMA signal, and MACD minus signal histogram (12/26/9 by default).',
  ),
  definition(
    'ppo',
    'Percentage Price Oscillator',
    'PPO',
    'Momentum',
    'oscillator',
    12,
    '100 × (EMA(period) − EMA(2 × period + 2)) / slow EMA; 9-bar EMA signal and difference histogram (12/26/9 by default).',
  ),
  definition(
    'roc',
    'Rate of Change',
    'ROC',
    'Momentum',
    'oscillator',
    12,
    'Percentage change in closing price compared with period bars ago.',
  ),
  definition(
    'momentum',
    'Momentum',
    'Momentum',
    'Momentum',
    'oscillator',
    10,
    'Current close minus the closing price period bars ago.',
  ),
  definition(
    'cci',
    'Commodity Channel Index',
    'CCI',
    'Momentum',
    'oscillator',
    20,
    'Typical-price deviation from its period SMA, divided by 0.015 × mean absolute deviation. Flat windows return zero.',
  ),
  definition(
    'williamsr',
    'Williams %R',
    'Williams %R',
    'Momentum',
    'oscillator',
    14,
    '−100 × (period highest high − close) / high-low range; a flat range is −50.',
  ),
  definition(
    'awesome',
    'Awesome Oscillator',
    'AO',
    'Momentum',
    'oscillator',
    5,
    'High-low midpoint SMA(period) minus SMA(7 × period − 1), giving the standard 5/34 lengths by default.',
  ),
  definition(
    'ultimate',
    'Ultimate Oscillator',
    'Ultimate',
    'Momentum',
    'oscillator',
    7,
    'Buying pressure / true range over period, 2 × period and 4 × period, weighted 4:2:1. Flat windows use neutral pressure 0.5.',
  ),
  definition(
    'trix',
    'Triple Exponential Average',
    'TRIX',
    'Momentum',
    'oscillator',
    15,
    'One-bar percentage change in a triple period EMA, plus a 9-bar EMA signal.',
  ),
  definition(
    'cmo',
    'Chande Momentum Oscillator',
    'CMO',
    'Momentum',
    'oscillator',
    14,
    '100 × (rolling close gains − losses) / (gains + losses); flat windows return zero.',
  ),
  definition(
    'dpo',
    'Detrended Price Oscillator',
    'DPO',
    'Momentum',
    'oscillator',
    20,
    'Close from floor(period/2)+1 bars ago minus the current period SMA. Plotted at calculation time, without shifting values into the past.',
  ),
  definition(
    'tsi',
    'True Strength Index',
    'TSI',
    'Momentum',
    'oscillator',
    25,
    '100 × double-smoothed close change / double-smoothed absolute change. EMA lengths period and ceil(period/2), plus a 7-bar signal EMA.',
  ),
  definition(
    'fisher',
    'Fisher Transform',
    'Fisher',
    'Momentum',
    'oscillator',
    9,
    'Ehlers transform of period-normalized high-low midpoint, 0.33/0.67 smoothing, clamped to ±0.999; signal is the prior Fisher value.',
  ),
  definition(
    'adx',
    'Average Directional Index',
    'ADX / DI',
    'Trend',
    'oscillator',
    14,
    'Wilder-smoothed directional movement and true range over period; ADX smooths DX over the same period. Also shows +DI and −DI.',
  ),
  definition(
    'aroon',
    'Aroon',
    'Aroon',
    'Trend',
    'oscillator',
    25,
    '100 × (period − bars since extreme) / period over period + 1 bars. Equal extremes favor the most recent bar.',
  ),
  definition(
    'vortex',
    'Vortex Indicator',
    'Vortex',
    'Trend',
    'oscillator',
    14,
    'Rolling |high − previous low| and |low − previous high| divided by rolling true range.',
  ),
  definition(
    'atr',
    'Average True Range',
    'ATR',
    'Volatility',
    'oscillator',
    14,
    'Wilder-smoothed true range with a full-period SMA seed; the first bar uses high minus low.',
  ),
  definition(
    'natr',
    'Normalized Average True Range',
    'NATR',
    'Volatility',
    'oscillator',
    14,
    '100 × Wilder ATR(period) / current closing price.',
  ),
  definition(
    'stddev',
    'Standard Deviation',
    'Std Dev',
    'Volatility',
    'oscillator',
    20,
    'Population standard deviation of closing prices over the trailing period.',
  ),
  definition(
    'bbwidth',
    'Bollinger Band Width',
    'BB Width',
    'Volatility',
    'oscillator',
    20,
    '100 × (upper − lower) / period SMA using Bollinger bands at 2 population standard deviations.',
  ),
  definition(
    'percentb',
    'Bollinger %B',
    'BB %B',
    'Volatility',
    'oscillator',
    20,
    '(Close − lower) / (upper − lower) with period SMA and 2-standard-deviation bands; flat bands return 0.5.',
  ),
  definition(
    'choppiness',
    'Choppiness Index',
    'CHOP',
    'Volatility',
    'oscillator',
    14,
    '100 × log10(sum of period true ranges / period high-low range) / log10(period). A completely flat window returns 100.',
  ),
  definition(
    'obv',
    'On Balance Volume',
    'OBV',
    'Volume',
    'oscillator',
    1,
    'Cumulative signed volume from close-to-close direction, initialized at zero. Equal closes add zero; no period parameter.',
  ),
  definition(
    'ad',
    'Accumulation/Distribution',
    'A/D',
    'Volume',
    'oscillator',
    1,
    'Cumulative volume × (2 × close − high − low) / (high − low). Zero-range bars contribute zero; no period parameter.',
  ),
  definition(
    'cmf',
    'Chaikin Money Flow',
    'CMF',
    'Volume',
    'oscillator',
    20,
    'Rolling accumulation/distribution flow divided by rolling volume. Zero-volume windows return zero.',
  ),
  definition(
    'mfi',
    'Money Flow Index',
    'MFI',
    'Volume',
    'oscillator',
    14,
    'Typical-price × volume separated by typical-price direction over period. Unchanged prices contribute neither flow; no-flow windows return 50.',
  ),
  definition(
    'force',
    'Elder Force Index',
    'Force',
    'Volume',
    'oscillator',
    13,
    'Period EMA of (close − previous close) × current volume.',
  ),
];

type Series = (number | undefined)[];
const exists = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);
const blank = (length: number): Series => Array(length).fill(undefined);
const map = (
  input: Series,
  fn: (value: number, index: number) => number,
): Series =>
  input.map((value, index) => (exists(value) ? fn(value, index) : undefined));
function combine(
  a: Series,
  b: Series,
  fn: (a: number, b: number) => number,
): Series {
  return a.map((value, index) =>
    exists(value) && exists(b[index]) ? fn(value, b[index]!) : undefined,
  );
}
const divide = (a: number, b: number, flat = 0) => (b === 0 ? flat : a / b);
const shift = (input: Series, length: number): Series =>
  input.map((_, i) => (i >= length ? input[i - length] : undefined));

function rolling(
  input: Series,
  period: number,
  fn: (values: number[]) => number,
): Series {
  const out = blank(input.length);
  for (let i = period - 1; i < input.length; i++) {
    const values = input.slice(i - period + 1, i + 1);
    if (values.every(exists)) out[i] = fn(values);
  }
  return out;
}
const sumValues = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0);
function sum(input: Series, period: number): Series {
  let total = 0,
    count = 0;
  return input.map((value, index) => {
    if (exists(value)) {
      total += value;
      count++;
    }
    const expired = input[index - period];
    if (index >= period && exists(expired)) {
      total -= expired;
      count--;
    }
    return index >= period - 1 && count === period ? total : undefined;
  });
}
const sma = (input: Series, period: number) =>
  map(sum(input, period), (value) => value / period);
function smooth(input: Series, period: number, alpha: number): Series {
  let prior: number | undefined;
  let seed = 0,
    count = 0;
  return input.map((value) => {
    if (!exists(value)) {
      prior = undefined;
      seed = 0;
      count = 0;
      return undefined;
    }
    if (prior !== undefined) return (prior = prior + alpha * (value - prior));
    seed += value;
    if (++count < period) return undefined;
    return (prior = seed / period);
  });
}
const ema = (input: Series, period: number) =>
  smooth(input, period, 2 / (period + 1));
const rma = (input: Series, period: number) =>
  smooth(input, period, 1 / period);
const wma = (input: Series, period: number) =>
  rolling(
    input,
    period,
    (values) =>
      values.reduce((total, value, i) => total + value * (i + 1), 0) /
      ((period * (period + 1)) / 2),
  );
const highest = (input: Series, period: number) =>
  rolling(input, period, (values) => Math.max(...values));
const lowest = (input: Series, period: number) =>
  rolling(input, period, (values) => Math.min(...values));
const deviation = (input: Series, period: number) =>
  rolling(input, period, (values) => {
    const mean = sumValues(values) / period;
    return Math.sqrt(
      sumValues(values.map((value) => (value - mean) ** 2)) / period,
    );
  });
const change = (input: Series, period = 1) =>
  combine(input, shift(input, period), (a, b) => a - b);
function trueRange(bars: Candle[]): Series {
  return bars.map((bar, i) =>
    i === 0
      ? bar.high - bar.low
      : Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - bars[i - 1].close),
          Math.abs(bar.low - bars[i - 1].close),
        ),
  );
}
function rsi(close: Series, period: number): Series {
  const delta = change(close);
  const gains = rma(
    map(delta, (value) => Math.max(0, value)),
    period,
  );
  const losses = rma(
    map(delta, (value) => Math.max(0, -value)),
    period,
  );
  return combine(gains, losses, (gain, loss) =>
    gain + loss === 0 ? 50 : (100 * gain) / (gain + loss),
  );
}

/**
 * Calculations consume only the supplied candle prefix. Undefined warm-up
 * values are omitted rather than backfilled or copied from later candles.
 * Sources for formula conventions: https://tulipindicators.org/list,
 * https://www.tradingview.com/support/solutions/43000634738-supertrend/,
 * https://www.tradingview.com/support/solutions/43000502246-detrended-price-oscillator-dpo/.
 * No third-party implementation code is used.
 */
export function computeIndicator(
  instance: IndicatorInstance,
  bars: Candle[],
): IndicatorPlot[] {
  const spec = INDICATORS.find((entry) => entry.id === instance.indicatorId);
  if (!spec) return [];
  const period = Math.max(
    spec.minPeriod,
    Math.min(
      spec.maxPeriod,
      Number.isFinite(instance.period)
        ? Math.floor(instance.period)
        : spec.defaultPeriod,
    ),
  );
  const close: Series = bars.map((bar) => bar.close);
  const high: Series = bars.map((bar) => bar.high);
  const low: Series = bars.map((bar) => bar.low);
  const volume: Series = bars.map((bar) => bar.volume);
  const midpoint: Series = bars.map((bar) => (bar.high + bar.low) / 2);
  const typical: Series = bars.map(
    (bar) => (bar.high + bar.low + bar.close) / 3,
  );
  const line = (
    key: string,
    values: Series,
    label = spec.shortName,
    color = instance.color,
    kind: IndicatorPlot['kind'] = 'line',
  ): IndicatorPlot => ({
    key,
    label,
    kind,
    color,
    data: values.flatMap((value, i) =>
      exists(value) && Number.isFinite(bars[i]?.time)
        ? [{ time: bars[i].time, value }]
        : [],
    ),
  });
  const one = (values: Series, kind: IndicatorPlot['kind'] = 'line') => [
    line('value', values, spec.shortName, instance.color, kind),
  ];
  const pair = (a: Series, b: Series, first: string, second: string) => [
    line('main', a, first),
    line('signal', b, second, '#f4ad5f'),
  ];
  const triple = (middle: Series, upper: Series, lower: Series) => [
    line('middle', middle, `${spec.shortName} middle`),
    line('upper', upper, `${spec.shortName} upper`, '#65b8ed'),
    line('lower', lower, `${spec.shortName} lower`, '#d38ae9'),
  ];
  switch (spec.id) {
    case 'sma':
      return one(sma(close, period));
    case 'ema':
      return one(ema(close, period));
    case 'wma':
      return one(wma(close, period));
    case 'smma':
      return one(rma(close, period));
    case 'dema': {
      const first = ema(close, period);
      return one(combine(first, ema(first, period), (a, b) => 2 * a - b));
    }
    case 'tema': {
      const first = ema(close, period),
        second = ema(first, period);
      return one(
        combine(
          combine(first, second, (a, b) => 3 * (a - b)),
          ema(second, period),
          (a, b) => a + b,
        ),
      );
    }
    case 'hma':
      return one(
        wma(
          combine(
            wma(close, Math.max(1, Math.floor(period / 2))),
            wma(close, period),
            (a, b) => 2 * a - b,
          ),
          Math.max(1, Math.floor(Math.sqrt(period))),
        ),
      );
    case 'vwma':
      return one(
        combine(
          sum(
            combine(close, volume, (a, b) => a * b),
            period,
          ),
          sum(volume, period),
          (a, b) => (b ? a / b : NaN),
        ),
      );
    case 'zlema':
      return one(
        ema(
          combine(
            close,
            shift(close, Math.floor((period - 1) / 2)),
            (a, b) => 2 * a - b,
          ),
          period,
        ),
      );
    case 'kama': {
      const volatility = sum(map(change(close), Math.abs), period);
      const out = blank(bars.length);
      let previous = close[period - 1];
      for (let i = period; i < bars.length; i++) {
        const efficiency = divide(
          Math.abs(close[i]! - close[i - period]!),
          volatility[i]!,
        );
        const alpha = (efficiency * (2 / 3 - 2 / 31) + 2 / 31) ** 2;
        previous = previous! + alpha * (close[i]! - previous!);
        out[i] = previous;
      }
      return one(out);
    }
    case 't3': {
      const e1 = ema(close, period),
        e2 = ema(e1, period),
        e3 = ema(e2, period),
        e4 = ema(e3, period),
        e5 = ema(e4, period),
        e6 = ema(e5, period);
      const factor = 0.7;
      const c1 = -(factor ** 3),
        c2 = 3 * factor ** 2 + 3 * factor ** 3;
      const c3 = -6 * factor ** 2 - 3 * factor - 3 * factor ** 3;
      const c4 = 1 + 3 * factor + 3 * factor ** 2 + factor ** 3;
      return one(
        combine(
          combine(e6, e5, (a, b) => c1 * a + c2 * b),
          combine(e4, e3, (a, b) => c3 * a + c4 * b),
          (a, b) => a + b,
        ),
      );
    }
    case 'alma': {
      const center = 0.85 * (period - 1),
        sigma = period / 6;
      const weights = Array.from({ length: period }, (_, i) =>
        Math.exp(-((i - center) ** 2) / (2 * sigma ** 2)),
      );
      const total = sumValues(weights);
      return one(
        rolling(
          close,
          period,
          (values) =>
            sumValues(values.map((value, i) => value * weights[i])) / total,
        ),
      );
    }
    case 'linreg':
      return one(
        rolling(close, period, (values) => {
          const xMean = (period - 1) / 2,
            yMean = sumValues(values) / period;
          let covariance = 0,
            variance = 0;
          values.forEach((value, i) => {
            covariance += (i - xMean) * (value - yMean);
            variance += (i - xMean) ** 2;
          });
          return yMean + divide(covariance, variance) * xMean;
        }),
      );
    case 'bbands':
    case 'bbwidth':
    case 'percentb': {
      const mean = sma(close, period),
        dev = deviation(close, period);
      const upper = combine(mean, dev, (a, b) => a + 2 * b),
        lower = combine(mean, dev, (a, b) => a - 2 * b);
      if (spec.id === 'bbands') return triple(mean, upper, lower);
      const width = map(dev, (value) => 4 * value);
      if (spec.id === 'bbwidth')
        return one(combine(width, mean, (a, b) => 100 * divide(a, b)));
      return one(
        combine(
          combine(close, lower, (a, b) => a - b),
          width,
          (a, b) => divide(a, b, 0.5),
        ),
      );
    }
    case 'donchian': {
      const upper = highest(high, period),
        lower = lowest(low, period);
      return triple(
        combine(upper, lower, (a, b) => (a + b) / 2),
        upper,
        lower,
      );
    }
    case 'keltner': {
      const mean = ema(close, period),
        atr = rma(trueRange(bars), period);
      return triple(
        mean,
        combine(mean, atr, (a, b) => a + 2 * b),
        combine(mean, atr, (a, b) => a - 2 * b),
      );
    }
    case 'ichimoku': {
      const center = (length: number) =>
        combine(
          highest(high, length),
          lowest(low, length),
          (a, b) => (a + b) / 2,
        );
      const conversion = center(period),
        base = center(3 * period - 1);
      return [
        line('conversion', conversion, 'Conversion'),
        line('base', base, 'Base', '#f4ad5f'),
        line(
          'span-a',
          combine(conversion, base, (a, b) => (a + b) / 2),
          'Span A (current)',
          '#47c5a3',
        ),
        line('span-b', center(6 * period - 2), 'Span B (current)', '#e57e8b'),
      ];
    }
    case 'supertrend': {
      const atr = rma(trueRange(bars), period),
        out = blank(bars.length);
      let upper: number | undefined,
        lower: number | undefined,
        up = false;
      for (let i = 0; i < bars.length; i++) {
        if (!exists(atr[i])) continue;
        const rawUpper = midpoint[i]! + 3 * atr[i]!,
          rawLower = midpoint[i]! - 3 * atr[i]!;
        if (upper === undefined || lower === undefined) {
          upper = rawUpper;
          lower = rawLower;
        } else {
          upper = rawUpper < upper || close[i - 1]! > upper ? rawUpper : upper;
          lower = rawLower > lower || close[i - 1]! < lower ? rawLower : lower;
          up = up ? close[i]! >= lower : close[i]! > upper;
        }
        out[i] = up ? lower : upper;
      }
      return one(out);
    }
    case 'psar': {
      const out = blank(bars.length);
      if (bars.length < 2) return one(out);
      let up = midpoint[1]! >= midpoint[0]!,
        acceleration = 0.02;
      let sar = up ? low[0]! : high[0]!,
        extreme = up ? high[0]! : low[0]!;
      for (let i = 1; i < bars.length; i++) {
        sar += acceleration * (extreme - sar);
        if (up) {
          sar = Math.min(sar, low[i - 1]!, low[Math.max(0, i - 2)]!);
          if (low[i]! < sar) {
            up = false;
            sar = Math.max(extreme, high[i]!);
            extreme = low[i]!;
            acceleration = 0.02;
          } else if (high[i]! > extreme) {
            extreme = high[i]!;
            acceleration = Math.min(0.2, acceleration + 0.02);
          }
        } else {
          sar = Math.max(sar, high[i - 1]!, high[Math.max(0, i - 2)]!);
          if (high[i]! > sar) {
            up = true;
            sar = Math.min(extreme, low[i]!);
            extreme = high[i]!;
            acceleration = 0.02;
          } else if (low[i]! < extreme) {
            extreme = low[i]!;
            acceleration = Math.min(0.2, acceleration + 0.02);
          }
        }
        out[i] = sar;
      }
      return one(out);
    }
    case 'vwap': {
      let day: number | undefined,
        weighted = 0,
        totalVolume = 0;
      return one(
        bars.map((bar, i) => {
          const nextDay = Math.floor(bar.time / 86400);
          if (day !== nextDay) {
            day = nextDay;
            weighted = 0;
            totalVolume = 0;
          }
          weighted += typical[i]! * bar.volume;
          totalVolume += bar.volume;
          return totalVolume > 0 ? weighted / totalVolume : undefined;
        }),
      );
    }
    case 'rsi':
      return one(rsi(close, period));
    case 'stochastic':
    case 'stochrsi': {
      const input = spec.id === 'stochrsi' ? rsi(close, period) : close;
      const top = highest(spec.id === 'stochrsi' ? input : high, period);
      const bottom = lowest(spec.id === 'stochrsi' ? input : low, period);
      const raw = combine(
        combine(input, bottom, (a, b) => a - b),
        combine(top, bottom, (a, b) => a - b),
        (a, b) => 100 * divide(a, b, 0.5),
      );
      const k = sma(raw, 3);
      return pair(k, sma(k, 3), '%K', '%D');
    }
    case 'macd':
    case 'ppo': {
      const fast = ema(close, period),
        slow = ema(close, 2 * period + 2);
      const main = combine(fast, slow, (a, b) =>
        spec.id === 'macd' ? a - b : 100 * divide(a - b, b),
      );
      const signal = ema(main, 9);
      return [
        ...pair(main, signal, spec.shortName, 'Signal'),
        line(
          'histogram',
          combine(main, signal, (a, b) => a - b),
          'Histogram',
          '#47c5a3',
          'histogram',
        ),
      ];
    }
    case 'roc':
      return one(
        combine(close, shift(close, period), (a, b) => 100 * divide(a - b, b)),
      );
    case 'momentum':
      return one(change(close, period));
    case 'cci':
      return one(
        rolling(typical, period, (values) => {
          const average = sumValues(values) / period;
          const deviation =
            sumValues(values.map((value) => Math.abs(value - average))) /
            period;
          return divide(values.at(-1)! - average, 0.015 * deviation);
        }),
      );
    case 'williamsr': {
      const top = highest(high, period),
        bottom = lowest(low, period);
      return one(
        combine(
          combine(top, close, (a, b) => a - b),
          combine(top, bottom, (a, b) => a - b),
          (a, b) => -100 * divide(a, b, 0.5),
        ),
      );
    }
    case 'awesome':
      return one(
        combine(
          sma(midpoint, period),
          sma(midpoint, 7 * period - 1),
          (a, b) => a - b,
        ),
        'histogram',
      );
    case 'ultimate': {
      const pressure = bars.map((bar, i) =>
        i ? bar.close - Math.min(bar.low, bars[i - 1].close) : undefined,
      );
      const range = trueRange(bars);
      if (range.length) range[0] = undefined;
      const ratio = (length: number) =>
        combine(sum(pressure, length), sum(range, length), (a, b) =>
          divide(a, b, 0.5),
        );
      return one(
        combine(
          combine(ratio(period), ratio(2 * period), (a, b) => 4 * a + 2 * b),
          ratio(4 * period),
          (a, b) => (100 * (a + b)) / 7,
        ),
      );
    }
    case 'trix': {
      const third = ema(ema(ema(close, period), period), period);
      const main = combine(
        third,
        shift(third, 1),
        (a, b) => 100 * divide(a - b, b),
      );
      return pair(main, ema(main, 9), 'TRIX', 'Signal');
    }
    case 'cmo': {
      const delta = change(close),
        gains = sum(
          map(delta, (value) => Math.max(0, value)),
          period,
        ),
        losses = sum(
          map(delta, (value) => Math.max(0, -value)),
          period,
        );
      return one(combine(gains, losses, (a, b) => 100 * divide(a - b, a + b)));
    }
    case 'dpo':
      return one(
        combine(
          shift(close, Math.floor(period / 2) + 1),
          sma(close, period),
          (a, b) => a - b,
        ),
      );
    case 'tsi': {
      const delta = change(close),
        short = Math.ceil(period / 2);
      const numerator = ema(ema(delta, period), short),
        denominator = ema(ema(map(delta, Math.abs), period), short);
      const main = combine(
        numerator,
        denominator,
        (a, b) => 100 * divide(a, b),
      );
      return pair(main, ema(main, 7), 'TSI', 'Signal');
    }
    case 'fisher': {
      const top = highest(midpoint, period),
        bottom = lowest(midpoint, period),
        out = blank(bars.length),
        signal = blank(bars.length);
      let previous = 0,
        transformed = 0;
      for (let i = period - 1; i < bars.length; i++) {
        const position = divide(
          midpoint[i]! - bottom[i]!,
          top[i]! - bottom[i]!,
          0.5,
        );
        previous = Math.max(
          -0.999,
          Math.min(0.999, 0.66 * (position - 0.5) + 0.67 * previous),
        );
        signal[i] = transformed;
        transformed =
          0.5 * Math.log((1 + previous) / (1 - previous)) + 0.5 * transformed;
        out[i] = transformed;
      }
      return pair(out, signal, 'Fisher', 'Signal');
    }
    case 'adx': {
      const positive = blank(bars.length),
        negative = blank(bars.length),
        ranges = trueRange(bars);
      if (ranges.length) ranges[0] = undefined;
      for (let i = 1; i < bars.length; i++) {
        const up = high[i]! - high[i - 1]!,
          down = low[i - 1]! - low[i]!;
        positive[i] = up > down && up > 0 ? up : 0;
        negative[i] = down > up && down > 0 ? down : 0;
      }
      const atr = rma(ranges, period);
      const plus = combine(
        rma(positive, period),
        atr,
        (a, b) => 100 * divide(a, b),
      );
      const minus = combine(
        rma(negative, period),
        atr,
        (a, b) => 100 * divide(a, b),
      );
      const dx = combine(
        plus,
        minus,
        (a, b) => 100 * divide(Math.abs(a - b), a + b),
      );
      return [
        line('adx', rma(dx, period), 'ADX'),
        line('plus-di', plus, '+DI', '#47c5a3'),
        line('minus-di', minus, '−DI', '#e57e8b'),
      ];
    }
    case 'aroon': {
      const extremeAge = (values: number[], upper: boolean) => {
        let chosen = 0;
        for (let i = 1; i < values.length; i++)
          if (upper ? values[i] >= values[chosen] : values[i] <= values[chosen])
            chosen = i;
        return (100 * chosen) / period;
      };
      return pair(
        rolling(high, period + 1, (values) => extremeAge(values, true)),
        rolling(low, period + 1, (values) => extremeAge(values, false)),
        'Aroon up',
        'Aroon down',
      );
    }
    case 'vortex': {
      const ranges = trueRange(bars);
      if (ranges.length) ranges[0] = undefined;
      const denominator = sum(ranges, period);
      const plus = sum(
        combine(high, shift(low, 1), (a, b) => Math.abs(a - b)),
        period,
      );
      const minus = sum(
        combine(low, shift(high, 1), (a, b) => Math.abs(a - b)),
        period,
      );
      return pair(
        combine(plus, denominator, (a, b) => divide(a, b)),
        combine(minus, denominator, (a, b) => divide(a, b)),
        'VI+',
        'VI−',
      );
    }
    case 'atr':
      return one(rma(trueRange(bars), period));
    case 'natr':
      return one(
        combine(
          rma(trueRange(bars), period),
          close,
          (a, b) => 100 * divide(a, b),
        ),
      );
    case 'stddev':
      return one(deviation(close, period));
    case 'choppiness':
      return one(
        combine(
          sum(trueRange(bars), period),
          combine(highest(high, period), lowest(low, period), (a, b) => a - b),
          (a, b) =>
            b === 0 ? 100 : (100 * Math.log10(a / b)) / Math.log10(period),
        ),
      );
    case 'obv': {
      let total = 0;
      return one(
        bars.map((bar, i) => {
          if (i) total += Math.sign(bar.close - bars[i - 1].close) * bar.volume;
          return total;
        }),
      );
    }
    case 'ad':
    case 'cmf': {
      const flow = bars.map(
        (bar) =>
          divide(2 * bar.close - bar.high - bar.low, bar.high - bar.low) *
          bar.volume,
      );
      if (spec.id === 'cmf')
        return one(
          combine(sum(flow, period), sum(volume, period), (a, b) =>
            divide(a, b),
          ),
        );
      let total = 0;
      return one(flow.map((value) => (total += value)));
    }
    case 'mfi': {
      const positive = blank(bars.length),
        negative = blank(bars.length);
      for (let i = 1; i < bars.length; i++) {
        const flow = typical[i]! * volume[i]!;
        positive[i] = typical[i]! > typical[i - 1]! ? flow : 0;
        negative[i] = typical[i]! < typical[i - 1]! ? flow : 0;
      }
      return one(
        combine(sum(positive, period), sum(negative, period), (a, b) =>
          a + b === 0 ? 50 : (100 * a) / (a + b),
        ),
      );
    }
    case 'force':
      return one(
        ema(
          combine(change(close), volume, (a, b) => a * b),
          period,
        ),
      );
  }
}

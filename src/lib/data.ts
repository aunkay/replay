import type { Candle } from './engine';

export interface MarketData {
  ticker: string;
  name: string;
  currency: string | null;
  exchange: string | null;
  exchangeTimezone?: string;
  interval: string;
  source: 'yfinance' | 'demo' | 'csv';
  adjusted: boolean;
  bars: Candle[];
  fetchedAt: string;
  range: { start: string; end: string };
  warnings: string[];
  request?: { start?: string; end?: string; period?: string };
}

export const INTERVALS = [
  ['1m', '1 minute'],
  ['2m', '2 minutes'],
  ['5m', '5 minutes'],
  ['15m', '15 minutes'],
  ['30m', '30 minutes'],
  ['60m', '1 hour'],
  ['90m', '90 minutes'],
  ['1d', '1 day'],
  ['5d', '5 days'],
  ['1wk', '1 week'],
  ['1mo', '1 month'],
  ['3mo', '3 months'],
] as const;

export function defaultPeriod(interval: string) {
  if (interval === '1m') return '5d';
  if (['2m', '5m', '15m', '30m', '90m'].includes(interval)) return '1mo';
  if (['60m', '1h'].includes(interval)) return '3mo';
  return '1y';
}

export function createDemo(): MarketData {
  let seed = 819;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bars: Candle[] = [];
  let close = 174.6;
  const date = new Date('2024-01-02T00:00:00Z');
  while (bars.length < 420) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      const i = bars.length;
      const open = close * (1 + (random() - 0.5) * 0.008);
      const drift = Math.sin(i / 19) * 0.004 + 0.0008;
      close = open * (1 + drift + (random() - 0.49) * 0.027);
      const high = Math.max(open, close) * (1 + random() * 0.009);
      const low = Math.min(open, close) * (1 - random() * 0.009);
      bars.push({
        time: date.getTime() / 1000,
        open,
        high,
        low,
        close,
        volume: Math.round(24000000 + random() * 65000000),
      });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    currency: 'USD',
    exchange: 'DEMO',
    interval: '1d',
    source: 'demo',
    adjusted: false,
    bars,
    fetchedAt: new Date().toISOString(),
    range: { start: '2024-01-02', end: date.toISOString().slice(0, 10) },
    warnings: [
      'Synthetic sample prices for exploring replay. Load Yahoo Finance data to backtest real market history.',
    ],
  };
}

export async function fetchMarketData(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<MarketData> {
  const response = await fetch(
    `/api/market-data?${new URLSearchParams(params)}`,
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000),
    },
  );
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      'The data server is unavailable. Start the Python backend and try again.',
    );
  }
  if (!response.ok)
    throw new Error(
      typeof payload?.detail === 'string'
        ? payload.detail
        : 'Unable to load this market. Check your ticker and date range.',
    );
  if (!Array.isArray(payload?.bars) || payload.bars.length < 2)
    throw new Error(
      'This range has fewer than two candles. Choose a longer range.',
    );
  if (!isValidMarketData(payload))
    throw new Error(
      'The data server returned invalid market data. Your current session has been kept; please try another range.',
    );
  return {
    ...(payload as MarketData),
    request:
      params.start && params.end
        ? { start: params.start, end: params.end }
        : { period: params.period },
  };
}

export function isValidMarketData(value: unknown): value is MarketData {
  if (!value || typeof value !== 'object') return false;
  const data = value as MarketData;
  if (
    typeof data.ticker !== 'string' ||
    !data.ticker ||
    typeof data.name !== 'string' ||
    (data.currency !== null &&
      (typeof data.currency !== 'string' ||
        !/^[A-Za-z]{3}$/.test(data.currency))) ||
    (data.exchange !== null && typeof data.exchange !== 'string') ||
    ![...INTERVALS.map(([interval]) => interval), '1h'].includes(
      data.interval,
    ) ||
    !['yfinance', 'demo', 'csv'].includes(data.source) ||
    typeof data.adjusted !== 'boolean' ||
    typeof data.fetchedAt !== 'string' ||
    typeof data.range?.start !== 'string' ||
    typeof data.range?.end !== 'string' ||
    ![data.fetchedAt, data.range.start, data.range.end].every((date) =>
      Number.isFinite(Date.parse(date)),
    ) ||
    !Array.isArray(data.warnings) ||
    !data.warnings.every((warning) => typeof warning === 'string') ||
    !Array.isArray(data.bars) ||
    data.bars.length < 2
  )
    return false;
  return data.bars.every(
    (bar, index) =>
      bar &&
      [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(
        Number.isFinite,
      ) &&
      Number.isInteger(bar.time) &&
      bar.time >= -2208988800 &&
      bar.time <= 7258118400 &&
      bar.open > 0 &&
      bar.close > 0 &&
      bar.low > 0 &&
      bar.high >= Math.max(bar.open, bar.close) &&
      bar.low <= Math.min(bar.open, bar.close) &&
      bar.volume >= 0 &&
      (index === 0 || bar.time > data.bars[index - 1].time),
  );
}

export function formatDate(time: number, includeTime = false) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
    ...(includeTime
      ? ({ hour: '2-digit', minute: '2-digit', hour12: false } as const)
      : {}),
  }).format(new Date(time * 1000));
}

export function exportCsv(
  rows: (string | number | undefined)[][],
  filename: string,
) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value ?? '');
          if (/^[=+@]/.test(text)) text = `'${text}`;
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(','),
    )
    .join('\r\n');
  // The iOS wrapper presents a native file share sheet. Keep this synchronous:
  // a normal browser still receives its existing download from the same click.
  const bridge = (
    window as Window & {
      webkit?: {
        messageHandlers?: {
          replayExport?: {
            postMessage: (payload: {
              filename: string;
              mimeType: string;
              content: string;
            }) => void;
          };
        };
      };
    }
  ).webkit?.messageHandlers?.replayExport;
  if (typeof bridge?.postMessage === 'function') {
    try {
      bridge.postMessage({
        filename,
        mimeType: 'text/csv;charset=utf-8;',
        content: csv,
      });
      return;
    } catch {
      // A wrapper may remove its handler during navigation; use the web path.
    }
  }
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

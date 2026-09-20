import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMarketData, isValidMarketData, type MarketData } from './data';
import {
  benchmarkRequest,
  computeComparison,
  marketComparisonKey,
} from './comparison';

const STORAGE_KEY = 'replay-benchmark:v1';
type Preferences = {
  ticker: string | null;
  color: string;
  cache: { baseKey: string; market: MarketData } | null;
};
const defaults: Preferences = {
  ticker: null,
  color: '#f0b86e',
  cache: null,
};

function restore(storageKey: string, color: string): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!value || typeof value !== 'object') return { ...defaults, color };
    const ticker =
      typeof value.ticker === 'string' &&
      /^[A-Z0-9.^=/_-]{1,30}$/.test(value.ticker)
        ? value.ticker
        : null;
    return {
      ticker,
      color:
        typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color)
          ? value.color
          : color,
      cache:
        ticker &&
        typeof value.cache?.baseKey === 'string' &&
        isValidMarketData(value.cache?.market) &&
        value.cache.market.source === 'yfinance' &&
        value.cache.market.ticker === ticker
          ? value.cache
          : null,
    };
  } catch {
    return { ...defaults, color };
  }
}

export function useComparison(base: MarketData, slot = 0) {
  const storageKey = slot === 0 ? STORAGE_KEY : `${STORAGE_KEY}:${slot + 1}`;
  const [preferences, setPreferences] = useState<Preferences>(() =>
    restore(storageKey, ['#f0b86e', '#6db5f8', '#ed819f', '#6fd8d3'][slot]),
  );
  const [status, setStatus] = useState({ loading: false, error: '' });
  const [saved, setSaved] = useState(true);
  const key = marketComparisonKey(base);
  const keyRef = useRef(key);
  keyRef.current = key;
  const requestRef = useRef<{ id: number; controller: AbortController | null }>(
    {
      id: 0,
      controller: null,
    },
  );
  const cancel = useCallback(() => {
    requestRef.current.id += 1;
    requestRef.current.controller?.abort();
    requestRef.current.controller = null;
  }, []);

  const load = useCallback(
    async (symbol: string) => {
      cancel();
      const ticker = symbol.trim().toUpperCase();
      if (!/^[A-Z0-9.^=/_-]{1,30}$/.test(ticker)) {
        setStatus({
          loading: false,
          error: 'Enter a valid Yahoo Finance ticker.',
        });
        return false;
      }
      if (ticker === base.ticker.toUpperCase()) {
        setStatus({
          loading: false,
          error: 'Choose a benchmark different from the base ticker.',
        });
        return false;
      }
      const controller = new AbortController();
      requestRef.current.controller = controller;
      const id = requestRef.current.id;
      setStatus({ loading: true, error: '' });
      try {
        const market = await fetchMarketData(
          benchmarkRequest(base, ticker),
          controller.signal,
        );
        if (id !== requestRef.current.id || keyRef.current !== key)
          return false;
        if (
          market.ticker !== ticker ||
          market.interval !== base.interval ||
          market.source !== 'yfinance'
        ) {
          throw new Error(
            'The benchmark response does not match the requested ticker and interval. Please retry.',
          );
        }
        if (!computeComparison(base.bars, market.bars).anchor) {
          throw new Error(
            'No matching candle timestamps in this history. Choose a benchmark with overlapping trading hours or a longer interval.',
          );
        }
        setPreferences((previous) => ({
          ...previous,
          ticker,
          cache: { baseKey: key, market },
        }));
        setStatus({ loading: false, error: '' });
        return true;
      } catch (error) {
        if (id !== requestRef.current.id || keyRef.current !== key)
          return false;
        setStatus({
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to load benchmark data. Please retry.',
        });
        return false;
      }
    },
    [base, key, cancel],
  );

  useEffect(() => {
    // Reuse a validated snapshot only for this exact base dataset. A market or
    // interval change cancels older requests and refreshes the selected symbol.
    setStatus({ loading: false, error: '' });
    if (
      preferences.ticker &&
      (preferences.cache?.baseKey !== key ||
        preferences.cache.market.interval !== base.interval)
    ) {
      void load(preferences.ticker);
    }
    return cancel;
  }, [key, load, cancel, preferences.ticker, preferences.cache, base.interval]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [preferences, storageKey]);

  return {
    ...preferences,
    ...status,
    saved,
    data:
      preferences.cache?.baseKey === key &&
      preferences.cache.market.interval === base.interval
        ? preferences.cache.market
        : null,
    load,
    clearError: () => setStatus((previous) => ({ ...previous, error: '' })),
    setColor: (color: string) =>
      setPreferences((previous) => ({ ...previous, color })),
    remove: () => {
      cancel();
      setPreferences((previous) => ({
        ...previous,
        ticker: null,
        cache: null,
      }));
      setStatus({ loading: false, error: '' });
    },
  };
}

/** Four independent request/cache slots plus the traded base = five tickers. */
export function useComparisons(base: MarketData) {
  const first = useComparison(base, 0);
  const second = useComparison(base, 1);
  const third = useComparison(base, 2);
  const fourth = useComparison(base, 3);
  return [first, second, third, fourth];
}

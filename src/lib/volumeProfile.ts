import type { Candle } from './engine';
export type ProfileSettings = {
  mode: 'off' | 'visible' | 'recent' | 'session' | 'sessions';
  rows: number;
  lookback: number;
  sessions: number;
  valueArea: number;
  style: 'total' | 'split' | 'delta';
  side: 'left' | 'right';
  width: number;
  opacity: number;
  levels: boolean;
  shade: boolean;
  inspect: boolean;
  filter: 'all' | 'regular' | 'premarket' | 'afterhours';
  startHour: number;
};
export const profileDefaults: ProfileSettings = {
  mode: 'off',
  rows: 32,
  lookback: 100,
  sessions: 4,
  valueArea: 70,
  style: 'split',
  side: 'right',
  width: 25,
  opacity: 65,
  levels: true,
  shade: true,
  inspect: false,
  filter: 'all',
  startHour: 0,
};
export type ProfileBin = {
  low: number;
  high: number;
  up: number;
  down: number;
  total: number;
};
export function calculateProfile(bars: Candle[], rows = 32, valueArea = 70) {
  const valid = bars.filter(
    (b) =>
      Number.isFinite(b.low) &&
      Number.isFinite(b.high) &&
      b.high >= b.low &&
      Number.isFinite(b.volume) &&
      b.volume > 0,
  );
  if (!valid.length) return null;
  let low = Infinity,
    high = -Infinity;
  for (const b of valid) {
    low = Math.min(low, b.low);
    high = Math.max(high, b.high);
  }
  if (high === low) {
    const pad = Math.max(Math.abs(low) * 0.0001, 0.000001);
    low -= pad;
    high += pad;
  }
  const count = Math.max(8, Math.min(100, Math.round(rows))),
    step = (high - low) / count;
  const bins: ProfileBin[] = Array.from({ length: count }, (_, i) => ({
    low: low + i * step,
    high: low + (i + 1) * step,
    up: 0,
    down: 0,
    total: 0,
  }));
  for (const b of valid) {
    const start = Math.max(
      0,
      Math.min(count - 1, Math.floor((b.low - low) / step)),
    );
    const end = Math.max(
      0,
      Math.min(count - 1, Math.floor((b.high - low) / step)),
    );
    for (let i = start; i <= end; i++) {
      const volume =
        b.high === b.low
          ? b.volume
          : (b.volume *
              Math.max(
                0,
                Math.min(b.high, bins[i].high) - Math.max(b.low, bins[i].low),
              )) /
            (b.high - b.low);
      bins[i][b.close >= b.open ? 'up' : 'down'] += volume;
      bins[i].total += volume;
    }
  }
  const total = bins.reduce((sum, b) => sum + b.total, 0);
  const poc = bins.reduce(
    (best, b, i) => (b.total > bins[best].total ? i : best),
    0,
  );
  let from = poc,
    to = poc,
    covered = bins[poc].total;
  const target = (total * Math.max(1, Math.min(100, valueArea))) / 100;
  while (covered < target && (from > 0 || to < count - 1)) {
    if (
      from > 0 &&
      (to === count - 1 || bins[from - 1].total >= bins[to + 1].total)
    )
      covered += bins[--from].total;
    else covered += bins[++to].total;
  }
  return {
    bins,
    total,
    poc,
    from,
    to,
    pocPrice: (bins[poc].low + bins[poc].high) / 2,
    val: bins[from].low,
    vah: bins[to].high,
    max: bins[poc].total,
  };
}
export function groupProfiles(
  bars: Candle[],
  settings: ProfileSettings,
  timezone: string,
  interval: string,
  visible: { from: number; to: number } | null,
) {
  const intraday = /m$|h$/.test(interval) && !['1mo', '3mo'].includes(interval);
  let filtered = bars.filter(
    (b) =>
      b.complete !== false &&
      (settings.filter === 'all' || b.session === settings.filter),
  );
  if (settings.mode === 'off') return [];
  if (settings.mode === 'visible')
    filtered = visible
      ? filtered.filter((b) => b.time >= visible.from && b.time <= visible.to)
      : [];
  if (settings.mode === 'recent') filtered = filtered.slice(-settings.lookback);
  if (settings.mode === 'visible' || settings.mode === 'recent')
    return filtered.length
      ? [
          {
            label:
              settings.mode === 'visible'
                ? 'Visible range'
                : `Last ${settings.lookback} candles`,
            bars: filtered,
          },
        ]
      : [];
  if (!intraday) return [];
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
  }
  const groups = new Map<string, Candle[]>();
  for (const b of filtered) {
    const parts = Object.fromEntries(
      format
        .formatToParts(new Date(b.time * 1000))
        .map((p) => [p.type, p.value]),
    );
    const date = new Date(
      Date.UTC(
        +parts.year,
        +parts.month - 1,
        +parts.day - (+parts.hour < settings.startHour ? 1 : 0),
      ),
    );
    const key = date.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }
  return [...groups]
    .slice(-(settings.mode === 'session' ? 1 : settings.sessions))
    .map(([label, bars]) => ({ label, bars }));
}
export function restoreProfile(key: string): ProfileSettings {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (!v) return { ...profileDefaults };
    const next = { ...profileDefaults };
    for (const k of [
      'rows',
      'lookback',
      'sessions',
      'valueArea',
      'width',
      'opacity',
      'startHour',
    ] as const) {
      const bounds = {
        rows: [8, 100],
        lookback: [10, 2000],
        sessions: [1, 8],
        valueArea: [1, 100],
        width: [10, 50],
        opacity: [10, 100],
        startHour: [0, 23],
      }[k];
      if (Number.isInteger(v[k]) && v[k] >= bounds[0] && v[k] <= bounds[1])
        next[k] = v[k];
    }
    for (const k of ['levels', 'shade', 'inspect'] as const)
      if (typeof v[k] === 'boolean') next[k] = v[k];
    if (['off', 'visible', 'recent', 'session', 'sessions'].includes(v.mode))
      next.mode = v.mode;
    if (['total', 'split', 'delta'].includes(v.style)) next.style = v.style;
    if (['left', 'right'].includes(v.side)) next.side = v.side;
    if (['all', 'regular', 'premarket', 'afterhours'].includes(v.filter))
      next.filter = v.filter;
    return next;
  } catch {
    return { ...profileDefaults };
  }
}

import { useEffect, useMemo, useState } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '../lib/engine';
import {
  calculateProfile,
  groupProfiles,
  profileDefaults,
  restoreProfile,
  type ProfileSettings,
} from '../lib/volumeProfile';
import './VolumeProfile.css';
export default function VolumeProfile({
  chart,
  series,
  bars,
  timezone,
  interval,
  storageKey,
  blind,
}: {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'>;
  bars: Candle[];
  timezone: string;
  interval: string;
  storageKey: string;
  blind: boolean;
}) {
  const [settings, setSettings] = useState(() => restoreProfile(storageKey));
  const [saved, setSaved] = useState(true);
  const [info, setInfo] = useState('');
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [geometry, setGeometry] = useState({
    width: 0,
    height: 0,
    left: 0,
    profiles: [] as {
      x: number;
      end: number;
      ys: number[];
      levels: number[];
    }[],
  });
  const update = <K extends keyof ProfileSettings>(
    key: K,
    value: ProfileSettings[K],
  ) => setSettings((s) => ({ ...s, [key]: value }));
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [settings, storageKey]);
  useEffect(() => {
    const reload = () => setSettings(restoreProfile(storageKey));
    window.addEventListener('replay:preferences-restored', reload);
    return () =>
      window.removeEventListener('replay:preferences-restored', reload);
  }, [storageKey]);
  useEffect(() => {
    setInfo('');
  }, [bars, settings]);
  useEffect(() => {
    const refresh = () => {
      const r = chart.timeScale().getVisibleRange();
      setRange(r ? { from: Number(r.from), to: Number(r.to) } : null);
    };
    refresh();
    chart.timeScale().subscribeVisibleTimeRangeChange(refresh);
    return () => chart.timeScale().unsubscribeVisibleTimeRangeChange(refresh);
  }, [chart, bars]);
  const profiles = useMemo(
    () =>
      groupProfiles(bars, settings, timezone, interval, range)
        .map((g) => ({
          ...g,
          profile: calculateProfile(g.bars, settings.rows, settings.valueArea),
        }))
        .filter((g) => g.profile !== null),
    [bars, settings, timezone, interval, range],
  );
  useEffect(() => {
    if (settings.mode === 'off') return;
    let frame = 0,
      previous = '';
    const refresh = () => {
      const size = chart.paneSize(0);
      const value = {
        ...size,
        left: chart.priceScale('left').width(),
        profiles: profiles.map((g) => ({
          x: Number(
            chart
              .timeScale()
              .timeToCoordinate(g.bars[0].time as UTCTimestamp) ?? 0,
          ),
          end: Number(
            chart
              .timeScale()
              .timeToCoordinate(g.bars.at(-1)!.time as UTCTimestamp) ??
              size.width,
          ),
          ys: [
            g.profile!.bins[0].low,
            ...g.profile!.bins.map((b) => b.high),
          ].map((p) => Number(series.priceToCoordinate(p))),
          levels: [g.profile!.pocPrice, g.profile!.val, g.profile!.vah].map(
            (p) => Number(series.priceToCoordinate(p)),
          ),
        })),
      };
      const signature = JSON.stringify(value);
      if (signature !== previous) {
        previous = signature;
        setGeometry(value);
      }
      frame = requestAnimationFrame(refresh);
    };
    frame = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(frame);
  }, [chart, series, profiles, settings.mode]);
  const intraday = /m$|h$/.test(interval) && !['1mo', '3mo'].includes(interval);
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { maximumFractionDigits: 6 });
  return (
    <>
      <details className="volume-profile-menu">
        <summary>Volume profile{settings.mode !== 'off' ? ' •' : ''}</summary>
        <div
          className="volume-profile-controls"
          role="group"
          aria-label="Volume profile settings"
        >
          <p>
            Estimated volume at each price. Uses revealed, completed candles
            only; finer intervals give more detail.
          </p>
          <label>
            Profile range
            <select
              aria-label="Profile range"
              value={settings.mode}
              onChange={(e) =>
                update('mode', e.target.value as ProfileSettings['mode'])
              }
            >
              <option value="off">Off</option>
              <option value="visible">Visible range</option>
              <option value="recent">Recent candles</option>
              <option value="session">Latest session</option>
              <option value="sessions">Session profiles</option>
            </select>
          </label>
          {(settings.mode === 'session' || settings.mode === 'sessions') && (
            <>
              <p>
                Sessions use {timezone || 'UTC'} dates with the start hour
                below. Only loaded history is included; the first and latest
                sessions may be partial.
              </p>
              <label>
                Session start hour
                <input
                  aria-label="Session start hour"
                  type="number"
                  min="0"
                  max="23"
                  value={settings.startHour}
                  onChange={(e) => {
                    const v = +e.target.value;
                    if (Number.isInteger(v) && v >= 0 && v <= 23)
                      update('startHour', v);
                  }}
                />
              </label>
              {!intraday && (
                <p role="status">
                  Choose an intraday interval for session profiles.
                </p>
              )}
            </>
          )}
          {settings.mode === 'recent' && (
            <label>
              Lookback candles
              <input
                aria-label="Lookback candles"
                type="number"
                min="10"
                max="2000"
                value={settings.lookback}
                onChange={(e) => {
                  const v = +e.target.value;
                  if (Number.isInteger(v) && v >= 10 && v <= 2000)
                    update('lookback', v);
                }}
              />
            </label>
          )}
          {settings.mode === 'sessions' && (
            <label>
              Session count
              <select
                aria-label="Session count"
                value={settings.sessions}
                onChange={(e) => update('sessions', +e.target.value)}
              >
                {[1, 2, 3, 4, 6, 8].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Session hours
            <select
              aria-label="Session hours"
              value={settings.filter}
              onChange={(e) =>
                update('filter', e.target.value as ProfileSettings['filter'])
              }
            >
              <option value="all">All loaded hours</option>
              <option value="regular">Regular only</option>
              <option value="premarket">Pre-market only</option>
              <option value="afterhours">After-hours only</option>
            </select>
          </label>
          <label>
            Visualization
            <select
              aria-label="Profile visualization"
              value={settings.style}
              onChange={(e) =>
                update('style', e.target.value as ProfileSettings['style'])
              }
            >
              <option value="split">Up / down volume</option>
              <option value="total">Total volume</option>
              <option value="delta">Candle-direction delta</option>
            </select>
          </label>
          <label>
            Position
            <select
              aria-label="Profile position"
              value={settings.side}
              onChange={(e) =>
                update('side', e.target.value as ProfileSettings['side'])
              }
            >
              <option value="right">Right</option>
              <option value="left">Left</option>
            </select>
          </label>
          {(
            [
              ['rows', 'Price rows', 8, 100],
              ['width', 'Profile width', 10, 50],
              ['opacity', 'Profile opacity', 10, 100],
              ['valueArea', 'Value area percent', 1, 100],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key}>
              {label}: {settings[key]}
              <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                value={settings[key]}
                onChange={(e) => update(key, +e.target.value)}
              />
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={settings.levels}
              onChange={(e) => update('levels', e.target.checked)}
            />
            Show POC / VAH / VAL
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.shade}
              onChange={(e) => update('shade', e.target.checked)}
            />
            Highlight value area
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.inspect}
              onChange={(e) => update('inspect', e.target.checked)}
            />
            Inspect profile bars (hover or tap)
          </label>
          <p>
            POC = highest-volume row. VAH / VAL bound the selected value area.
            Volume is distributed across each candle’s high–low range. Up/down
            and delta use candle direction, not bid/ask trades.
          </p>
          <button
            type="button"
            onClick={() => setSettings({ ...profileDefaults })}
          >
            Reset volume profile
          </button>
          {!saved && (
            <p role="status">
              Profile settings could not be saved in this browser.
            </p>
          )}
        </div>
      </details>
      {settings.mode !== 'off' && (
        <>
          <svg
            className="volume-profile-layer"
            aria-label="Volume by price profiles"
            width={geometry.width}
            height={geometry.height}
            style={{ left: geometry.left }}
            data-profile-count={profiles.length}
            data-profile-volume={profiles.reduce(
              (s, g) => s + g.profile!.total,
              0,
            )}
          >
            {profiles.map((g, index) => {
              const geo = geometry.profiles[index],
                p = g.profile!;
              if (!geo || geo.ys.length !== p.bins.length + 1) return null;
              const session = settings.mode === 'sessions';
              const left = session
                  ? Math.max(
                      0,
                      geo.x - chart.timeScale().options().barSpacing / 2,
                    )
                  : 0,
                right = session
                  ? Math.min(
                      geometry.width,
                      geo.end + chart.timeScale().options().barSpacing / 2,
                    )
                  : geometry.width;
              if (right <= left) return null;
              const width = Math.max(
                  1,
                  ((right - left) * settings.width) / 100,
                ),
                edge = settings.side === 'right' ? right : left;
              const x = (w: number) =>
                settings.side === 'right' ? edge - w : edge;
              const label = blind ? `Profile ${index + 1}` : g.label;
              return (
                <g key={g.label} data-profile-label={label}>
                  {session && (
                    <text
                      x={left + 4}
                      y={Math.max(
                        15,
                        Math.min(geometry.height - 15, geo.ys.at(-1)! - 16),
                      )}
                      fill="#c9d3e6"
                    >
                      {label}
                    </text>
                  )}
                  {p.bins.map((bin, i) => {
                    const w =
                      (width *
                        (settings.style === 'delta'
                          ? Math.abs(bin.up - bin.down)
                          : bin.total)) /
                      p.max;
                    const y = Math.min(geo.ys[i], geo.ys[i + 1]),
                      h = Math.max(
                        0.5,
                        Math.abs(geo.ys[i + 1] - geo.ys[i]) - 0.5,
                      );
                    const detail = `${label} · ${fmt(bin.low)}–${fmt(bin.high)} · Volume ${fmt(bin.total)} · Up ${fmt(bin.up)} · Down ${fmt(bin.down)} · Direction delta ${fmt(bin.up - bin.down)}`;
                    return (
                      <g
                        key={i}
                        opacity={
                          (settings.opacity / 100) *
                          (settings.shade && (i < p.from || i > p.to) ? 0.4 : 1)
                        }
                      >
                        <rect
                          x={x(w)}
                          y={y}
                          width={w}
                          height={h}
                          fill={
                            settings.style === 'total'
                              ? '#8b9bff'
                              : settings.style === 'delta' && bin.down > bin.up
                                ? '#ef718a'
                                : '#35c9a0'
                          }
                        />
                        {settings.style === 'split' && (
                          <rect
                            x={x(w) + (w * bin.up) / bin.total || 0}
                            y={y}
                            width={bin.total ? (w * bin.down) / bin.total : 0}
                            height={h}
                            fill="#ef718a"
                          />
                        )}
                        {settings.inspect && (
                          <rect
                            className="profile-hit"
                            x={x(width)}
                            y={y}
                            width={width}
                            height={Math.max(h, 2)}
                            fill="transparent"
                            tabIndex={0}
                            role="button"
                            aria-label={detail}
                            onFocus={() => setInfo(detail)}
                            onPointerEnter={() => setInfo(detail)}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setInfo(detail);
                            }}
                          />
                        )}
                      </g>
                    );
                  })}
                  {settings.levels &&
                    geo.levels.map((y, i) => (
                      <g key={i}>
                        <line
                          x1={left}
                          x2={right}
                          y1={y}
                          y2={y}
                          stroke={i === 0 ? '#ffd166' : '#b1a4ff'}
                          strokeWidth={i === 0 ? 1.5 : 1}
                          strokeDasharray={i === 0 ? '' : '4 4'}
                        />
                        <text
                          x={settings.side === 'right' ? right - 4 : left + 4}
                          y={y - 3}
                          textAnchor={
                            settings.side === 'right' ? 'end' : 'start'
                          }
                          fill={i === 0 ? '#ffd166' : '#c9beff'}
                        >
                          {['POC', 'VAL', 'VAH'][i]}{' '}
                          {fmt([p.pocPrice, p.val, p.vah][i])}
                        </text>
                      </g>
                    ))}
                </g>
              );
            })}
          </svg>
          {!profiles.length && (
            <div className="profile-notice" role="status">
              {!intraday && ['session', 'sessions'].includes(settings.mode)
                ? 'Session profiles need intraday candles.'
                : 'No completed candles with volume match this range and session filter.'}
            </div>
          )}
          {settings.inspect && info && (
            <div className="profile-inspector" role="status">
              {info}
              <button
                aria-label="Close profile inspection"
                onClick={() => setInfo('')}
              >
                ×
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

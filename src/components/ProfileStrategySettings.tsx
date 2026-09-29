import type { ProfileReclaimSettings } from '../lib/profileStrategy';
export default function ProfileStrategySettings({
  value,
  onChange,
}: {
  value: ProfileReclaimSettings;
  onChange: (value: ProfileReclaimSettings) => void;
}) {
  return (
    <div aria-label="Volume profile strategy rules">
      <h4>Wait for the sweep to fail</h4>
      <ol>
        <li>
          Freeze POC, VAL and VAH from the previous completed session. Skip the
          first loaded session and sessions with too few bars.
        </li>
        <li>
          Long: price sweeps below VAL, then closes back inside value. Short:
          mirror the rules above VAH.
        </li>
        <li>
          A later candle must retest the value edge, close inside value again,
          and close in the trade direction beyond the reclaim close. Cancel if
          price closes outside again or confirmation expires.
        </li>
        <li>
          Enter at the next open only inside the edge entry zone and with
          sufficient reward to POC. Never chase an opening gap.
        </li>
      </ol>
      <p>
        SL: sweep/retest extreme plus an ATR buffer. PT: POC, opposite edge, or
        50% at each. Maximum one confirmed setup per side per session. Exit at
        the next session open or the holding limit. This detects a failed
        excursion, not manipulation intent.
      </p>
      <div className="hub-fields">
        <label>
          Trading direction
          <select
            aria-label="Profile trading direction"
            value={value.direction}
            onChange={(e) =>
              onChange({
                ...value,
                direction: e.target
                  .value as ProfileReclaimSettings['direction'],
              })
            }
          >
            <option value="both">Long and short</option>
            <option value="long">Long only</option>
            <option value="short">Short only</option>
          </select>
        </label>
        <label>
          Profit-taking plan
          <select
            aria-label="Profile profit-taking plan"
            value={value.target}
            onChange={(e) =>
              onChange({
                ...value,
                target: e.target.value as ProfileReclaimSettings['target'],
              })
            }
          >
            <option value="scale">50% POC / 50% opposite edge</option>
            <option value="poc">All at POC</option>
            <option value="opposite">All at opposite edge</option>
          </select>
        </label>
        <label>
          Session timezone
          <input
            aria-label="Profile session timezone"
            value={value.timezone}
            onChange={(e) => onChange({ ...value, timezone: e.target.value })}
          />
        </label>
      </div>
      <details>
        <summary>Profile, confirmation and risk parameters</summary>
        <div className="hub-fields">
          {(
            [
              ['startHour', 'Session start hour', 0, 23, 1],
              ['rows', 'Profile price rows', 8, 100, 1],
              ['valueArea', 'Value area (%)', 1, 100, 1],
              ['minSessionBars', 'Minimum prior-session candles', 2, 500, 1],
              ['atrPeriod', 'ATR period', 2, 200, 1],
              ['sweepAtr', 'Minimum sweep (ATR)', 0, 5, 0.05],
              ['stopAtr', 'SL buffer (ATR)', 0.01, 5, 0.05],
              ['retestAtr', 'Retest tolerance (ATR)', 0, 5, 0.05],
              [
                'zoneFraction',
                'Entry zone fraction of value width',
                0.01,
                0.5,
                0.05,
              ],
              ['confirmationBars', 'Confirmation expiry (candles)', 2, 30, 1],
              ['minRR', 'Minimum reward/risk to POC', 0.1, 10, 0.1],
              ['maxHold', 'Maximum holding candles', 1, 1000, 1],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <label key={key}>
              {label}
              <input
                aria-label={label}
                type="number"
                min={min}
                max={max}
                step={step}
                value={value[key]}
                onChange={(e) =>
                  onChange({ ...value, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
      </details>
      <p>
        Use intraday candles (5m is the research baseline). Session timezone
        must match your market; input data determines which trading hours are
        included. Profiles estimate volume from OHLCV, not actual order flow.
        The chart’s developing profile may differ from this strategy’s frozen
        previous-session levels.
      </p>
    </div>
  );
}

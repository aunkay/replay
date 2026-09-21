import type { Strategy } from '../lib/strategy';
export default function StrategyProtection({
  strategy,
  onChange,
}: {
  strategy: Strategy;
  onChange: (s: Strategy) => void;
}) {
  const dynamic = strategy.dynamicProtection ?? {},
    trailing = dynamic.trailing;
  return (
    <details className="hub-disclosure">
      <summary>6. Trailing stops & staged exits</summary>
      <p>
        These rules apply to each entry, using the same execution engine as
        manual replay. ATR trailing uses 14 observed true ranges; an initial
        stop protects the warm-up period.
      </p>
      <label>
        Strategy trailing stop
        <select
          aria-label="Strategy trailing stop"
          value={trailing?.mode ?? ''}
          onChange={(e) =>
            onChange({
              ...strategy,
              dynamicProtection: {
                ...dynamic,
                trailing: e.target.value
                  ? {
                      mode: e.target.value as 'price' | 'percent' | 'atr',
                      distance: trailing?.distance ?? 2,
                    }
                  : undefined,
              },
            })
          }
        >
          <option value="">Off</option>
          <option value="price">Price distance</option>
          <option value="percent">Percentage distance</option>
          <option value="atr">ATR multiple</option>
        </select>
      </label>
      {trailing && (
        <label>
          Strategy trailing distance
          <input
            type="number"
            min="0"
            step="any"
            value={trailing.distance}
            onChange={(e) =>
              onChange({
                ...strategy,
                dynamicProtection: {
                  ...dynamic,
                  trailing: { ...trailing, distance: Number(e.target.value) },
                },
              })
            }
          />
        </label>
      )}
      <label>
        Strategy break-even activation %
        <input
          type="number"
          min="0"
          step="any"
          value={dynamic.breakEvenPct ?? ''}
          onChange={(e) =>
            onChange({
              ...strategy,
              dynamicProtection: {
                ...dynamic,
                breakEvenPct: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              },
            })
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={Boolean(strategy.profitTargets?.length)}
          onChange={(e) =>
            onChange({
              ...strategy,
              profitTargets: e.target.checked
                ? [
                    { gainPct: 1, percent: 30 },
                    { gainPct: 2, percent: 30 },
                    { gainPct: 3, percent: 40 },
                  ]
                : undefined,
            })
          }
        />
        Use staged strategy targets
      </label>
      {strategy.profitTargets?.map((t, i) => (
        <div key={i}>
          <label>
            Target {i + 1} gain %
            <input
              type="number"
              min="0"
              max="99"
              step="any"
              value={t.gainPct}
              onChange={(e) =>
                onChange({
                  ...strategy,
                  profitTargets: strategy.profitTargets!.map((v, j) =>
                    i === j ? { ...v, gainPct: Number(e.target.value) } : v,
                  ),
                })
              }
            />
          </label>
          <label>
            Target {i + 1} allocation %
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={t.percent}
              onChange={(e) =>
                onChange({
                  ...strategy,
                  profitTargets: strategy.profitTargets!.map((v, j) =>
                    i === j ? { ...v, percent: Number(e.target.value) } : v,
                  ),
                })
              }
            />
          </label>
        </div>
      ))}
      <p>
        Staged targets replace the single take-profit percentage. Break-even
        moves to entry before costs. Partial fills remain subject to the
        configured volume limit.
      </p>
    </details>
  );
}

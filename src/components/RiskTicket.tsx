import { useEffect, useState } from 'react';
import { sizeByRisk } from '../lib/risk';
import type {
  EngineConfig,
  Side,
  ProfitTarget,
  DynamicProtection,
} from '../lib/engine';
export type ProtectionDraft = {
  stopLoss?: number;
  takeProfit?: number;
  takeProfits?: ProfitTarget[];
  dynamicProtection?: DynamicProtection;
  plannedRisk?: number;
  sizingError?: string;
};
export default function RiskTicket({
  entry,
  side,
  equity,
  buyingPower,
  config,
  quantity,
  ticker,
  onQuantity,
  onChange,
}: {
  entry: number;
  side: Side;
  equity: number;
  buyingPower: number;
  config: EngineConfig;
  quantity: number;
  ticker: string;
  onQuantity: (v: string) => void;
  onChange: (v: ProtectionDraft) => void;
}) {
  const [sizing, setSizing] = useState('manual'),
    [risk, setRisk] = useState('1'),
    [stop, setStop] = useState(''),
    [target, setTarget] = useState(''),
    [unit, setUnit] = useState('price'),
    [step, setStep] = useState(
      ticker.includes('-') || ticker.includes('=') ? '0.000001' : '1',
    );
  const [trailingMode, setTrailingMode] = useState('off');
  const [trailingDistance, setTrailingDistance] = useState('2');
  const [breakEven, setBreakEven] = useState('');
  const [multipleTargets, setMultipleTargets] = useState(false);
  const [targetRows, setTargetRows] = useState([
    { price: '', percent: '30' },
    { price: '', percent: '30' },
    { price: '', percent: '40' },
  ]);
  const targetKey = JSON.stringify(targetRows);
  const sign = side === 'buy' ? 1 : -1;
  const stopLoss = stop
    ? unit === 'price'
      ? Number(stop)
      : entry * (1 - (sign * Number(stop)) / 100)
    : undefined;
  const takeProfit = target
    ? unit === 'price'
      ? Number(target)
      : unit === 'r' && stopLoss
        ? entry + sign * Math.abs(entry - stopLoss) * Number(target)
        : entry * (1 + (sign * Number(target)) / 100)
    : undefined;
  let error = '',
    suggestion: ReturnType<typeof sizeByRisk> | undefined;
  if (sizing !== 'manual')
    try {
      suggestion = sizeByRisk({
        entry,
        stop: stopLoss ?? NaN,
        side,
        budget:
          sizing === 'percent' ? (equity * Number(risk)) / 100 : Number(risk),
        buyingPower,
        step: Number(step),
        config,
      });
    } catch (e) {
      error = (e as Error).message;
    }
  const calculated = suggestion?.quantity;
  useEffect(() => {
    if (calculated !== undefined) onQuantity(String(calculated));
  }, [calculated, onQuantity]);
  useEffect(() => {
    onChange({
      dynamicProtection:
        trailingMode !== 'off' || breakEven
          ? {
              trailing:
                trailingMode !== 'off'
                  ? {
                      mode: trailingMode as 'price' | 'percent' | 'atr',
                      distance: Number(trailingDistance),
                    }
                  : undefined,
              breakEvenPct: breakEven ? Number(breakEven) : undefined,
            }
          : undefined,
      stopLoss,
      takeProfit: multipleTargets ? undefined : takeProfit,
      takeProfits: multipleTargets
        ? targetRows
            .filter((t) => t.price !== '')
            .map((t) => ({
              price: Number(t.price),
              percent: Number(t.percent),
            }))
        : undefined,
      sizingError: error || undefined,
      plannedRisk:
        suggestion?.risk ??
        (stopLoss ? Math.abs(entry - stopLoss) * quantity : undefined),
    });
  }, [
    trailingMode,
    trailingDistance,
    breakEven,
    multipleTargets,
    targetKey,
    stopLoss,
    takeProfit,
    suggestion?.risk,
    entry,
    quantity,
    onChange,
    error,
  ]);
  return (
    <details className="risk-ticket">
      <summary>Protection & risk sizing</summary>
      <label>
        Quantity mode
        <select value={sizing} onChange={(e) => setSizing(e.target.value)}>
          <option value="manual">Manual quantity</option>
          <option value="percent">Risk % of equity</option>
          <option value="cash">Cash risk</option>
        </select>
      </label>
      <label>
        Exit units
        <select value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="price">Absolute price</option>
          <option value="percent">Percentage distance</option>
          <option value="r">Stop % / target R</option>
        </select>
      </label>
      <label>
        Stop-loss
        <input
          aria-label="Stop-loss"
          inputMode="decimal"
          type="number"
          min="0"
          step="any"
          value={stop}
          onChange={(e) => setStop(e.target.value)}
        />
      </label>
      {!multipleTargets && (
        <label>
          Take-profit
          <input
            aria-label="Take-profit"
            inputMode="decimal"
            type="number"
            min="0"
            step="any"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
      )}
      <label>
        <input
          type="checkbox"
          checked={multipleTargets}
          onChange={(e) => setMultipleTargets(e.target.checked)}
        />
        Multiple take-profit levels
      </label>
      {multipleTargets && (
        <fieldset>
          <legend>Scale out at up to three prices</legend>
          <p>
            Enter absolute prices and percentages of the initial position.
            Allocations may total up to 100%. The stop protects the remainder.
          </p>
          {targetRows.map((row, i) => (
            <div key={i}>
              <label>
                TP{i + 1} price
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={row.price}
                  onChange={(e) =>
                    setTargetRows((rows) =>
                      rows.map((r, j) =>
                        j === i ? { ...r, price: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              <label>
                TP{i + 1} allocation %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={row.percent}
                  onChange={(e) =>
                    setTargetRows((rows) =>
                      rows.map((r, j) =>
                        j === i ? { ...r, percent: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
        </fieldset>
      )}
      <label>
        Trailing stop
        <select
          aria-label="Trailing stop"
          value={trailingMode}
          onChange={(e) => setTrailingMode(e.target.value)}
        >
          <option value="off">Off</option>
          <option value="price">Price distance</option>
          <option value="percent">Percentage distance</option>
          <option value="atr">ATR (14) multiple</option>
        </select>
      </label>
      {trailingMode !== 'off' && (
        <label>
          Trailing distance
          <input
            type="number"
            min="0"
            step="any"
            value={trailingDistance}
            onChange={(e) => setTrailingDistance(e.target.value)}
          />
        </label>
      )}
      <label>
        Break-even activation %
        <input
          type="number"
          min="0"
          step="any"
          value={breakEven}
          placeholder="Off"
          onChange={(e) => setBreakEven(e.target.value)}
        />
      </label>
      {(trailingMode !== 'off' || breakEven) && (
        <p>
          Stops tighten after each completed candle and apply from the next
          candle. Break-even means entry price before costs. ATR uses 14 true
          ranges and waits for 15 observed candles; set an initial stop for
          warm-up protection.
        </p>
      )}
      {sizing !== 'manual' && (
        <>
          <label>
            Risk {sizing === 'percent' ? '%' : 'amount'}
            <input
              type="number"
              step="any"
              min="0"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
            />
          </label>
          <label>
            Quantity step
            <input
              type="number"
              step="any"
              min="0.000001"
              value={step}
              onChange={(e) => setStep(e.target.value)}
            />
          </label>
        </>
      )}
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p>
          Estimated risk:{' '}
          {(
            suggestion?.risk ??
            (stopLoss ? Math.abs(entry - stopLoss) * quantity : 0)
          ).toFixed(2)}{' '}
          {stopLoss && takeProfit
            ? ` · R:R ${(Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss)).toFixed(2)}`
            : ''}
          {suggestion?.capped ? ' · Limited by buying power' : ''}
        </p>
      )}
      <small>
        Includes estimated costs for risk sizing. Gaps can exceed planned loss.
      </small>
    </details>
  );
}

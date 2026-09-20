import { useEffect, useState } from 'react';
import { sizeByRisk } from '../lib/risk';
import type { EngineConfig, Side } from '../lib/engine';
export type ProtectionDraft = {
  stopLoss?: number;
  takeProfit?: number;
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
      stopLoss,
      takeProfit,
      sizingError: error || undefined,
      plannedRisk:
        suggestion?.risk ??
        (stopLoss ? Math.abs(entry - stopLoss) * quantity : undefined),
    });
  }, [
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

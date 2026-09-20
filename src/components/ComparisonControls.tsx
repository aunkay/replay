import { LoaderCircle, Pencil, X } from 'lucide-react';
import { formatDate, type MarketData } from '../lib/data';
import type { ComparisonResult } from '../lib/comparison';
import type { useComparison } from '../lib/useComparison';

export default function ComparisonControls({
  base,
  comparison,
  result,
  currentTime,
  onEdit,
  showError,
}: {
  base: MarketData;
  comparison: ReturnType<typeof useComparison>;
  result: ComparisonResult;
  currentTime: number;
  onEdit: () => void;
  showError: boolean;
}) {
  if (!comparison.ticker) return null;
  const percent = (value: number) =>
    `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const { anchor, latest } = result;
  const intraday = !['1d', '5d', '1wk', '1mo', '3mo'].includes(base.interval);
  return (
    <div
      className="benchmark-comparison"
      role="group"
      aria-label="Benchmark comparison"
      data-comparison-symbol={comparison.ticker}
    >
      <div className="benchmark-topline">
        <div className="benchmark-symbol">
          <input
            type="color"
            aria-label="Benchmark color"
            title="Benchmark line color"
            value={comparison.color}
            onChange={(event) => comparison.setColor(event.target.value)}
          />
          <strong style={{ color: comparison.color }}>
            {comparison.ticker}
          </strong>
          <span>{base.interval} · Yahoo Finance</span>
          {comparison.loading && (
            <LoaderCircle
              size={13}
              className="spin"
              aria-label="Loading benchmark"
            />
          )}
        </div>
        <div className="benchmark-settings">
          <button
            type="button"
            className="icon-button"
            aria-label="Edit comparison"
            title="Edit comparison"
            onClick={onEdit}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Remove comparison"
            title="Remove comparison"
            onClick={comparison.remove}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {anchor && latest ? (
        <>
          <div className="benchmark-performance">
            <span>
              {base.ticker}{' '}
              <b
                data-testid="base-comparison-return"
                data-value={latest.baseReturn}
                className={latest.baseReturn >= 0 ? 'positive' : 'negative'}
              >
                {percent(latest.baseReturn)}
              </b>
            </span>
            <span>
              {comparison.ticker}{' '}
              <b
                data-testid="benchmark-comparison-return"
                data-value={latest.benchmarkReturn}
                className={
                  latest.benchmarkReturn >= 0 ? 'positive' : 'negative'
                }
              >
                {percent(latest.benchmarkReturn)}
              </b>
            </span>
            <span
              className="benchmark-anchor"
              data-testid="comparison-anchor"
              data-time={anchor.time}
            >
              Baseline {formatDate(anchor.time, intraday)} UTC
            </span>
          </div>
          <p className="benchmark-explanation">
            Shares the chart display settings. Returns as of{' '}
            {formatDate(latest.time, intraday)} UTC.
            {latest.time < currentTime &&
              ' No matching benchmark candle at the replay cursor.'}
          </p>
        </>
      ) : (
        <p className="benchmark-explanation" role="status">
          {comparison.loading
            ? 'Loading the same interval and history as your base ticker…'
            : comparison.data
              ? 'Waiting for the first shared candle in replay. Display settings still apply to the base ticker.'
              : 'Benchmark unavailable for this dataset. Edit the comparison to retry.'}
        </p>
      )}
      {base.source === 'demo' && (
        <p className="benchmark-explanation">
          Base: synthetic sample · Benchmark: historical prices
        </p>
      )}
      {base.currency !== comparison.data?.currency && comparison.data && (
        <p className="benchmark-explanation">
          Returns use each ticker’s quote currency; no currency conversion.
        </p>
      )}
      {showError && comparison.error && (
        <p className="benchmark-error" role="alert">
          {comparison.error}
        </p>
      )}
      {!comparison.saved && (
        <p className="benchmark-error" role="status">
          The comparison cannot be saved in this browser.
        </p>
      )}
    </div>
  );
}

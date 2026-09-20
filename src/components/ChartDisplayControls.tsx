import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  NORMALIZATION_OPTIONS,
  normalizationLabel,
  normalizationValue,
  type computeNormalizedView,
  type NormalizationMode,
} from '../lib/chartNormalization';
import { formatDate, type MarketData } from '../lib/data';
import type { ComparisonScale } from '../lib/comparison';
import type { useChartDisplay } from '../lib/useChartDisplay';

export default function ChartDisplayControls({
  settings,
  view,
  market,
  currentPrice,
}: {
  settings: ReturnType<typeof useChartDisplay>;
  view: ReturnType<typeof computeNormalizedView>;
  market: MarketData;
  currentPrice: number;
}) {
  const [windowInput, setWindowInput] = useState(String(settings.window));
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => setWindowInput(String(settings.window)), [settings.window]);
  const statistical = ['zscore', 'minmax'].includes(settings.normalization);
  const lockedScale = statistical || settings.normalization === 'logReturn';
  const option = NORMALIZATION_OPTIONS.find(
    (item) => item.value === settings.normalization,
  )!;
  const intraday = !['1d', '5d', '1wk', '1mo', '3mo'].includes(market.interval);
  const validWindow =
    Number.isInteger(Number(windowInput)) &&
    Number(windowInput) >= 2 &&
    Number(windowInput) <= 500;
  const value = normalizationValue(currentPrice, view.display);
  const priceDigits =
    Math.abs(currentPrice) < 0.0001
      ? 8
      : Math.abs(currentPrice) < 0.01
        ? 6
        : Math.abs(currentPrice) < 10
          ? 4
          : 2;
  const label =
    view.display.normalization === 'price'
      ? currentPrice.toLocaleString('en-US', {
          minimumFractionDigits: priceDigits,
          maximumFractionDigits: priceDigits,
        })
      : normalizationLabel(currentPrice, view.display);
  const rawPriceLabel = currentPrice.toLocaleString('en-US', {
    minimumFractionDigits: priceDigits,
    maximumFractionDigits: priceDigits,
  });
  return (
    <div className="chart-display" role="group" aria-label="Chart display">
      <div className="chart-display-topline">
        <div className="benchmark-settings chart-display-controls">
          <label>
            Normalization
            <select
              aria-label="Normalization"
              value={settings.normalization}
              onChange={(event) =>
                settings.setNormalization(
                  event.target.value as NormalizationMode,
                )
              }
            >
              {NORMALIZATION_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Price scale
            <select
              aria-label="Price scale"
              value={view.display.scale}
              disabled={lockedScale}
              title={
                statistical
                  ? 'Statistical normalization uses linear spacing.'
                  : settings.normalization === 'logReturn'
                    ? 'Log returns use logarithmic price spacing.'
                    : 'Spacing of prices on the chart'
              }
              onChange={(event) =>
                settings.setScale(event.target.value as ComparisonScale)
              }
            >
              <option value="linear">Linear</option>
              <option value="log">Logarithmic</option>
            </select>
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label="Reset chart display"
            title="Reset to price / linear"
            onClick={settings.reset}
          >
            <RotateCcw size={13} />
          </button>
        </div>
        <span className="chart-display-value">
          {market.ticker}{' '}
          {view.display.normalization !== 'price' && (
            <span
              className="chart-base-quote"
              aria-label={`${market.ticker} price`}
            >
              <b data-testid="chart-base-price" data-value={currentPrice}>
                {rawPriceLabel}
              </b>
              <span>{market.currency || 'Quote units'}</span>
              <span aria-hidden="true">·</span>
            </span>
          )}
          <b
            data-testid="chart-normalized-value"
            data-value={Number.isFinite(value) ? value : undefined}
          >
            {label}
          </b>
          {view.display.normalization === 'zscore' && <span>σ</span>}
          {view.display.normalization === 'ratio' && <span>×</span>}
        </span>
      </div>
      {statistical && (
        <form
          className="normalization-window"
          onSubmit={(event) => {
            event.preventDefault();
            if (validWindow) settings.setWindow(Number(windowInput));
          }}
        >
          <label htmlFor="normalization-window">Normalization window</label>
          <input
            id="normalization-window"
            type="number"
            inputMode="numeric"
            required
            min={2}
            max={500}
            step={1}
            value={windowInput}
            onChange={(event) => setWindowInput(event.target.value)}
          />
          <span>candles</span>
          <button
            type="submit"
            disabled={!validWindow || Number(windowInput) === settings.window}
          >
            Apply window
          </button>
          <span>
            {view.sampleCount} revealed{' '}
            {view.comparison?.anchor ? 'shared ' : ''}closes used
          </span>
        </form>
      )}
      <button
        type="button"
        className="mobile-chart-help"
        aria-label="About chart normalization"
        aria-expanded={helpOpen}
        aria-controls="chart-normalization-description"
        onClick={() => setHelpOpen((value) => !value)}
      >
        {helpOpen ? 'Hide view details' : 'About this view'}
      </button>
      <p
        id="chart-normalization-description"
        className={`chart-display-description ${helpOpen ? 'is-open' : ''}`}
      >
        {option.description}{' '}
        {view.comparison &&
          view.display.normalization !== 'price' &&
          `The chart axis shows ${market.ticker} price alongside normalized values. `}
        {statistical
          ? 'Recalculates from the latest revealed window; earlier plotted values rescale as replay advances. Linear spacing.'
          : settings.normalization === 'logReturn'
            ? 'Uses logarithmic price spacing.'
            : ''}
        {!statistical &&
          settings.normalization !== 'price' &&
          view.display.anchorTime !== null &&
          ` Baseline ${formatDate(view.display.anchorTime, intraday)} UTC${view.comparison?.anchor ? ' · first shared candle' : ' · first loaded candle'}.`}
      </p>
      {view.notice && (
        <p className="chart-display-notice" role="status">
          {view.notice}
        </p>
      )}
      {!settings.saved && (
        <p className="chart-display-notice" role="status">
          Chart display settings cannot be saved in this browser.
        </p>
      )}
    </div>
  );
}

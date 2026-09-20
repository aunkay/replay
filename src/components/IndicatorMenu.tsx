import { useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { createWorkspaceId } from '../lib/workspaceId';
import {
  INDICATORS,
  type IndicatorDefinition,
  type IndicatorInstance,
} from '../lib/indicators';

const COLORS = [
  '#b29aff',
  '#35cda0',
  '#f5b768',
  '#6db5f8',
  '#ed819f',
  '#c4dc7a',
  '#6fd8d3',
];

function ActiveIndicator({
  instance,
  definition,
  index,
  onChange,
  onRemove,
}: {
  instance: IndicatorInstance;
  definition: IndicatorDefinition;
  index: number;
  onChange: (instance: IndicatorInstance) => void;
  onRemove: () => void;
}) {
  const [period, setPeriod] = useState(String(instance.period));
  return (
    <form
      className="active-indicator"
      aria-label={`Active indicator ${index + 1}`}
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ ...instance, period: Number(period) });
      }}
    >
      <div className="active-indicator-heading">
        <strong>{definition.shortName}</strong>
        <span>
          {definition.pane === 'overlay' ? 'Price chart' : 'Separate pane'}
        </span>
        <button
          type="button"
          aria-label={`Remove ${definition.name}`}
          onClick={onRemove}
        >
          <X size={13} />
        </button>
      </div>
      <div className="active-indicator-settings">
        <label>
          Period
          <input
            aria-label={`Period for ${definition.name}`}
            type="number"
            inputMode="numeric"
            min={definition.minPeriod}
            max={definition.maxPeriod}
            step="1"
            required
            disabled={definition.minPeriod === definition.maxPeriod}
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </label>
        <label>
          Color
          <input
            aria-label={`Color for ${definition.name}`}
            type="color"
            value={instance.color}
            onChange={(event) =>
              onChange({ ...instance, color: event.target.value })
            }
          />
        </label>
        <button
          type="submit"
          className="apply-indicator"
          title="Apply indicator settings"
        >
          <Check size={13} />
          Apply
        </button>
      </div>
    </form>
  );
}

export default function IndicatorMenu({
  indicators,
  onChange,
}: {
  indicators: IndicatorInstance[];
  onChange: (next: IndicatorInstance[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const results = INDICATORS.filter(
    (definition) =>
      (category === 'All' || definition.category === category) &&
      `${definition.name} ${definition.id} ${definition.shortName}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );
  function add(definition: IndicatorDefinition) {
    onChange([
      ...indicators,
      {
        id: createWorkspaceId(),
        indicatorId: definition.id,
        period: definition.defaultPeriod,
        color: COLORS[indicators.length % COLORS.length],
      },
    ]);
  }
  return (
    <>
      <h2 id="dialog-title">Indicators</h2>
      <p className="modal-description">
        50 technical studies. Add multiple instances, choose periods and colors,
        and combine price overlays with separate indicator panes.
      </p>
      <div className="indicator-manager">
        <div className="indicator-library">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="Search indicators"
              placeholder="Search RSI, moving average, MACD…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="indicator-categories">
            {['All', 'Trend', 'Momentum', 'Volatility', 'Volume'].map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={category === value}
                  className={category === value ? 'selected' : ''}
                  onClick={() => setCategory(value)}
                >
                  {value}
                </button>
              ),
            )}
          </div>
          <div className="indicator-result-count" role="status">
            {results.length} indicators
          </div>
          <div className="indicator-catalog">
            {results.map((definition) => (
              <button
                type="button"
                key={definition.id}
                className="indicator-catalog-item"
                aria-label={`Add ${definition.name}`}
                onClick={() => add(definition)}
                title={definition.description}
              >
                <span>
                  <strong>{definition.name}</strong>
                  <small>
                    {definition.shortName} ·{' '}
                    {definition.pane === 'overlay' ? 'Overlay' : 'Oscillator'} ·{' '}
                    {definition.description}
                  </small>
                </span>
                <Plus size={16} />
              </button>
            ))}
            {results.length === 0 && (
              <p className="indicator-no-results">
                No matching indicators. Try another name.
              </p>
            )}
          </div>
        </div>
        <div className="indicator-active-list">
          <div className="active-list-title">
            <strong>
              On your chart <span>{indicators.length}</span>
            </strong>
            {indicators.length > 0 && (
              <button onClick={() => onChange([])}>Remove all</button>
            )}
          </div>
          {indicators.length === 0 ? (
            <p className="indicator-no-results">
              Add a study from the library to get started.
            </p>
          ) : (
            indicators.map((instance, index) => {
              const definition = INDICATORS.find(
                (definition) => definition.id === instance.indicatorId,
              )!;
              return (
                <ActiveIndicator
                  key={instance.id}
                  index={index}
                  instance={instance}
                  definition={definition}
                  onChange={(next) =>
                    onChange(
                      indicators.map((item) =>
                        item.id === next.id ? next : item,
                      ),
                    )
                  }
                  onRemove={() =>
                    onChange(
                      indicators.filter((item) => item.id !== instance.id),
                    )
                  }
                />
              );
            })
          )}
          <p className="indicator-warmup-note">
            Studies need enough revealed candles to warm up. Calculations never
            use future bars. Hover a study in the library for its calculation
            settings.
          </p>
        </div>
      </div>
    </>
  );
}

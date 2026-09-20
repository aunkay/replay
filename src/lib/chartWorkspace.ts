import { useCallback, useEffect, useMemo, useState } from 'react';
import { INDICATORS, type IndicatorInstance } from './indicators';
import { isValidDrawing, type Drawing } from './drawings';

const KEY = 'replay-chart-workspace:v1';
const EMPTY: Drawing[] = [];
type Preferences = {
  indicators: IndicatorInstance[];
  drawings: Record<string, Drawing[]>;
};

function restore(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    const definitions = new Map(INDICATORS.map((item) => [item.id, item]));
    if (
      !value ||
      !Array.isArray(value.indicators) ||
      !value.drawings ||
      typeof value.drawings !== 'object'
    )
      throw new Error();
    const ids = new Set<string>();
    const indicators = value.indicators.filter((item: IndicatorInstance) => {
      const definition = definitions.get(item?.indicatorId);
      if (
        !definition ||
        typeof item.id !== 'string' ||
        ids.has(item.id) ||
        !Number.isInteger(item.period) ||
        item.period < definition.minPeriod ||
        item.period > definition.maxPeriod ||
        !/^#[0-9a-f]{6}$/i.test(item.color)
      )
        return false;
      ids.add(item.id);
      return true;
    });
    const drawings: Record<string, Drawing[]> = {};
    for (const [key, items] of Object.entries(value.drawings)) {
      if (Array.isArray(items)) drawings[key] = items.filter(isValidDrawing);
    }
    return { indicators, drawings };
  } catch {
    return { indicators: [], drawings: {} };
  }
}

export function useChartWorkspace(marketKey: string) {
  const [preferences, setPreferences] = useState<Preferences>(restore);
  const [history, setHistory] = useState<{
    key: string;
    past: Drawing[][];
    future: Drawing[][];
  }>({ key: marketKey, past: [], future: [] });
  const [saved, setSaved] = useState(true);
  useEffect(()=>{const reload=()=>setPreferences(restore());window.addEventListener('replay:preferences-restored',reload);return ()=>window.removeEventListener('replay:preferences-restored',reload);},[]);
  const drawings = preferences.drawings[marketKey] || EMPTY;
  const currentHistory =
    history.key === marketKey
      ? history
      : { key: marketKey, past: [], future: [] };
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(preferences));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [preferences]);
  const setIndicators = useCallback(
    (indicators: IndicatorInstance[]) =>
      setPreferences((previous) => ({ ...previous, indicators })),
    [],
  );
  const writeDrawings = useCallback(
    (next: Drawing[]) =>
      setPreferences((previous) => ({
        ...previous,
        drawings: { ...previous.drawings, [marketKey]: next },
      })),
    [marketKey],
  );
  const changeDrawings = useCallback(
    (next: Drawing[]) => {
      if (JSON.stringify(drawings) === JSON.stringify(next)) return;
      setHistory((previous) => ({
        key: marketKey,
        past: [
          ...(previous.key === marketKey ? previous.past : []),
          drawings,
        ].slice(-50),
        future: [],
      }));
      writeDrawings(next);
    },
    [drawings, marketKey, writeDrawings],
  );
  const undo = () => {
    const previous = currentHistory.past.at(-1);
    if (!previous) return;
    setHistory({
      key: marketKey,
      past: currentHistory.past.slice(0, -1),
      future: [...currentHistory.future, drawings],
    });
    writeDrawings(previous);
  };
  const redo = () => {
    const next = currentHistory.future.at(-1);
    if (!next) return;
    setHistory({
      key: marketKey,
      past: [...currentHistory.past, drawings],
      future: currentHistory.future.slice(0, -1),
    });
    writeDrawings(next);
  };
  const oscillatorCount = useMemo(
    () =>
      preferences.indicators.filter(
        (instance) =>
          INDICATORS.find((def) => def.id === instance.indicatorId)?.pane ===
          'oscillator',
      ).length,
    [preferences.indicators],
  );
  return {
    indicators: preferences.indicators,
    setIndicators,
    drawings,
    changeDrawings,
    undo,
    redo,
    canUndo: currentHistory.past.length > 0,
    canRedo: currentHistory.future.length > 0,
    oscillatorCount,
    saved,
  };
}

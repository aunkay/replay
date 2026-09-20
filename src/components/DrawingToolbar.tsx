import {
  ArrowUpRight,
  ArrowUpDown,
  Circle,
  Columns2,
  GitCommitHorizontal,
  MoveUpRight,
  MousePointer2,
  PencilRuler,
  RectangleHorizontal,
  Redo2,
  RemoveFormatting,
  ScanLine,
  Slash,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { DRAWING_TOOLS, type DrawingTool } from '../lib/drawings';

const ICONS = {
  cursor: MousePointer2,
  trendline: Slash,
  ray: MoveUpRight,
  extended: ArrowUpDown,
  horizontal: GitCommitHorizontal,
  vertical: Columns2,
  rectangle: RectangleHorizontal,
  ellipse: Circle,
  channel: ScanLine,
  fib: RemoveFormatting,
  arrow: ArrowUpRight,
  text: Type,
  measure: PencilRuler,
};

export default function DrawingToolbar({
  tool,
  onTool,
  color,
  onColor,
  hasSelection,
  hasDrawings,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDelete,
  onClear,
}: {
  tool: DrawingTool;
  onTool: (tool: DrawingTool) => void;
  color: string;
  onColor: (color: string) => void;
  hasSelection: boolean;
  hasDrawings: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div
        className="drawing-toolbar"
        role="toolbar"
        aria-label="Drawing tools"
      >
        <div className="drawing-tool-list">
          {DRAWING_TOOLS.map((item) => {
            const Icon = ICONS[item.id];
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                title={item.label}
                aria-pressed={tool === item.id}
                className={`icon-button ${tool === item.id ? 'active' : ''}`}
                onClick={() => onTool(item.id)}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>
        <div className="drawing-actions">
          <input
            aria-label="Drawing color"
            title="Drawing color"
            type="color"
            value={color}
            onChange={(event) => onColor(event.target.value)}
          />
          <button
            className="icon-button"
            aria-label="Undo drawing"
            title="Undo drawing"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Redo drawing"
            title="Redo drawing"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Delete selected drawing"
            title="Delete selected drawing"
            disabled={!hasSelection}
            onClick={onDelete}
          >
            <Trash2 size={15} />
          </button>
          <button
            className="clear-drawings"
            disabled={!hasDrawings}
            onClick={onClear}
          >
            Clear drawings
          </button>
        </div>
      </div>
      <p className="chart-touch-hint">
        Drag sideways to pan, pinch to zoom, hold to inspect. Tap a drawing to
        select; drag its anchors to edit.
      </p>
    </>
  );
}

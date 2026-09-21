import { useState } from 'react';
import type { StoredSession } from '../lib/session';
import type { AlertCommand } from '../lib/alerts';
import type { Rule } from '../lib/strategy';
import { RuleEditor } from './StrategyBuilder';
import { STRATEGY_TEMPLATES } from '../lib/strategyTemplates';
import { createWorkspaceId } from '../lib/workspaceId';
export default function Alerts({
  session,
  onCommand,
}: {
  session: StoredSession;
  onCommand: (command: AlertCommand) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [pause, setPause] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [rule, setRule] = useState<Rule>({
    join: 'and',
    conditions: [
      {
        left: { kind: 'price', field: 'close' },
        op: 'crossUp',
        right: {
          kind: 'constant',
          value: session.market.bars[session.cursor].close,
        },
      },
    ],
  });
  async function act(command: AlertCommand) {
    setBusy(true);
    setError('');
    try {
      await onCommand(command);
      if (command.action === 'save') setName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="alerts-panel market-alerts-panel"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        Alerts ({session.alerts?.filter((a) => a.enabled).length ?? 0})
      </summary>
      <section aria-label="Market alerts">
        <h3>Price, indicator & strategy alerts</h3>
        <p>
          Alerts use completed, revealed candles for this ticker. Each fires
          once; rearm it to watch again. Choose price or any indicator on either
          side, or load a strategy entry rule.
        </p>
        <label>
          Alert template
          <select
            aria-label="Alert template"
            defaultValue=""
            onChange={(e) => {
              const t = STRATEGY_TEMPLATES.find((t) => t.id === e.target.value);
              if (t) {
                setRule(structuredClone(t.strategy.longEntry));
                setName(t.name + ' long entry');
              }
            }}
          >
            <option value="">Custom rule</option>
            {STRATEGY_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Alert name
          <input
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <RuleEditor name="Alert conditions" value={rule} onChange={setRule} />
        <label>
          <input
            type="checkbox"
            checked={pause}
            onChange={(e) => setPause(e.target.checked)}
          />
          Pause replay when triggered
        </label>
        <button
          className="button"
          disabled={busy || !name.trim()}
          onClick={() =>
            void act({
              type: 'alert',
              action: 'save',
              id: createWorkspaceId(),
              name,
              rule,
              pause,
            })
          }
        >
          Create alert
        </button>
        {error && <p role="alert">{error}</p>}
        <h4>Watching</h4>
        {session.alerts?.map((a) => (
          <article key={a.id} aria-label={`Alert ${a.name}`}>
            <strong>{a.name}</strong> · {a.enabled ? 'Armed' : 'Triggered'} ·{' '}
            {a.pause ? 'Pauses replay' : 'Notification only'}
            <div>
              <button
                className="button"
                disabled={busy || a.enabled}
                onClick={() =>
                  void act({ type: 'alert', action: 'rearm', id: a.id })
                }
              >
                Rearm alert
              </button>
              <button
                className="button ghost"
                disabled={busy}
                onClick={() =>
                  void act({ type: 'alert', action: 'delete', id: a.id })
                }
              >
                Delete alert
              </button>
            </div>
          </article>
        ))}
        <h4>Alert history</h4>
        <p>Last 200 events are saved with the session.</p>
        <ol>
          {[...(session.alertEvents ?? [])].reverse().map((e) => (
            <li key={e.id}>
              {e.name} ·{' '}
              {new Date(e.time * 1000)
                .toISOString()
                .slice(0, 19)
                .replace('T', ' ')}{' '}
              UTC · {e.price.toFixed(2)}
            </li>
          ))}
        </ol>
      </section>
    </details>
  );
}

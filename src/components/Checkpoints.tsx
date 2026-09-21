import { useState } from 'react';
import type { StoredSession } from '../lib/session';
import type { CheckpointCommand } from '../lib/checkpoints';
import { createWorkspaceId } from '../lib/workspaceId';
export default function Checkpoints({
  session,
  onCommand,
  server,
}: {
  session: StoredSession;
  onCommand: (command: CheckpointCommand) => Promise<void>;
  server: boolean;
}) {
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function act(command: CheckpointCommand) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await onCommand(command);
      setMessage(
        command.action === 'restore'
          ? 'Checkpoint restored. You can retry from the saved account state.'
          : command.action === 'save'
            ? 'Checkpoint saved.'
            : 'Checkpoint deleted.',
      );
      if (command.action === 'save') setName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Replay checkpoints" className="hub-save-card">
      <h3>Bookmarks & checkpoints</h3>
      <p>
        Bookmark a moment together with its cash, positions and orders. Restore
        it to retry the same trade.{' '}
        {server
          ? 'Restoring creates a separate saved session, preserving the original attempt and journal.'
          : 'Checkpoints stay in this browser; save the session below to keep them on the server.'}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act({
            type: 'checkpoint',
            action: 'save',
            id: createWorkspaceId(),
            name,
          });
        }}
      >
        <label>
          Checkpoint name
          <input
            value={name}
            maxLength={100}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="button" disabled={busy || !name.trim()}>
          Save checkpoint
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!session.checkpoints?.length && (
        <p>No checkpoints yet. Save one before entering a trade.</p>
      )}
      {session.checkpoints?.map((c) => (
        <article key={c.id} aria-label={`Checkpoint ${c.name}`}>
          <strong>{c.name}</strong>
          <p>
            {session.market.ticker} ·{' '}
            {new Date(session.market.bars[c.cursor].time * 1000)
              .toISOString()
              .replace('T', ' ')
              .slice(0, 19)}{' '}
            UTC · Candle {c.cursor + 1}
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void act({ type: 'checkpoint', action: 'restore', id: c.id })
            }
          >
            Restore checkpoint
          </button>{' '}
          <button
            className="button ghost"
            disabled={busy}
            onClick={() =>
              void act({ type: 'checkpoint', action: 'delete', id: c.id })
            }
          >
            Delete checkpoint
          </button>
        </article>
      ))}
    </section>
  );
}

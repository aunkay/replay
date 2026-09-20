import { useEffect, useState } from 'react';
import {
  Archive,
  Download,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react';
import { api, type useServerSession } from '../lib/server';
import type { StoredSession } from '../lib/session';

type Entry = { id: string; name: string; updated: number; archived: boolean };
export default function SessionLibrary({
  session,
  library,
  onClose,
}: {
  session: StoredSession;
  library: ReturnType<typeof useServerSession>;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState(`${session.market.ticker} practice`);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = async () => setEntries(await api<Entry[]>('/sessions'));
  useEffect(() => {
    void load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await load();
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function update(id: string, patch: object) {
    const current = await api(`/sessions/${id}`);
    const result = await api(
      `/sessions/${id}`,
      { revision: current.revision, client: library.client, ...patch },
      'PUT',
    );
    if (library.record?.id === id) library.accept(result);
  }
  const shown = entries.filter(
    (e) =>
      e.archived === archived &&
      e.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="session-library" aria-label="Session library">
      <div className="hub-section-heading">
        <div>
          <h3>Session library</h3>
          <p>Save your progress here, then pick up on any device.</p>
        </div>
        <span className="hub-badge">
          {library.record ? 'Server workspace' : 'Browser workspace'}
        </span>
      </div>
      <form
        className="hub-save-card"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(
            () => library.save(name.trim()),
            'Session saved. Your progress will now save automatically.',
          );
        }}
      >
        <div>
          <h4>
            {library.record ? 'Save a separate copy' : 'Keep this replay'}
          </h4>
          <p>
            {library.record
              ? `“${library.record.name}” saves automatically. Create a new session to keep a separate version.`
              : `${session.market.ticker} · ${session.market.interval} · Orders, chart settings and replay progress included.`}
          </p>
        </div>
        <div className="hub-save-controls">
          <label>
            Session name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="hub-primary" disabled={busy || !name.trim()}>
            <Plus size={16} aria-hidden="true" />
            Save as new session
          </button>
        </div>
      </form>
      {error && (
        <div className="hub-feedback" role="alert">
          {error}
          <button onClick={() => void perform(load, 'Library refreshed.')}>
            Retry
          </button>
        </div>
      )}
      {message && (
        <p className="hub-feedback success" role="status">
          {message}
        </p>
      )}
      <div className="hub-library-toolbar">
        <label className="hub-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search sessions</span>
          <input
            placeholder="Find a saved session…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="hub-segment" aria-label="Library filter">
          <button aria-pressed={!archived} onClick={() => setArchived(false)}>
            Active
          </button>
          <button aria-pressed={archived} onClick={() => setArchived(true)}>
            Archived
          </button>
        </div>
      </div>
      <div aria-busy={loading || busy} className="hub-session-list">
        {loading ? (
          <p role="status">Loading your sessions…</p>
        ) : !shown.length ? (
          <div className="hub-empty">
            <FolderOpen size={28} aria-hidden="true" />
            <h4>
              {search
                ? 'No matching sessions'
                : archived
                  ? 'No archived sessions'
                  : 'Your next session starts here'}
            </h4>
            <p>
              {search
                ? 'Try another name or switch the library filter.'
                : archived
                  ? 'Archive sessions you want to keep out of your active list.'
                  : 'Give this replay a name above and save your progress.'}
            </p>
          </div>
        ) : (
          shown.map((entry) => (
            <article
              className="hub-session-card"
              key={entry.id}
              aria-label={`Session ${entry.name}`}
            >
              <div className="hub-session-row">
                <div className="hub-session-info">
                  <h4>{entry.name}</h4>
                  <small>
                    Updated {new Date(entry.updated * 1000).toLocaleString()}
                  </small>
                  {library.record?.id === entry.id && (
                    <span className="hub-badge">Current session</span>
                  )}
                </div>
                <div className="hub-session-actions">
                  <button
                    className="hub-primary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await library.open(entry.id);
                        onClose();
                      }, '')
                    }
                  >
                    Resume
                  </button>
                  <details className="hub-more">
                    <summary aria-label={`More actions for ${entry.name}`}>
                      <MoreHorizontal size={20} aria-hidden="true" />
                      <span className="sr-only">More actions</span>
                    </summary>
                    <div>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing(entry.id);
                          setRename(entry.name);
                          setDeleting(null);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            const source = await api(`/sessions/${entry.id}`);
                            await api('/sessions', {
                              name: `${source.name} (copy)`,
                              payload: source.payload,
                            });
                          }, 'Copy added to your library.')
                        }
                      >
                        Duplicate
                      </button>
                      <a href={`/api/sessions/${entry.id}/export`}>
                        <Download size={15} aria-hidden="true" />
                        Export ZIP
                      </a>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform(
                            () =>
                              update(entry.id, { archived: !entry.archived }),
                            entry.archived
                              ? 'Session restored to Active.'
                              : 'Session moved to Archived.',
                          )
                        }
                      >
                        <Archive size={15} aria-hidden="true" />
                        {entry.archived ? 'Unarchive' : 'Archive'}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await library.open(entry.id, true);
                            onClose();
                          }, '')
                        }
                      >
                        Take control from another device
                      </button>
                      <button
                        className="hub-danger"
                        onClick={() => {
                          setDeleting(entry.id);
                          setEditing(null);
                        }}
                      >
                        Delete session
                      </button>
                    </div>
                  </details>
                </div>
              </div>
              {editing === entry.id && (
                <form
                  className="hub-inline-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(async () => {
                      await update(entry.id, { name: rename.trim() });
                      setEditing(null);
                    }, 'Session renamed.');
                  }}
                >
                  <label>
                    New session name
                    <input
                      autoFocus
                      required
                      maxLength={120}
                      value={rename}
                      onChange={(e) => setRename(e.target.value)}
                    />
                  </label>
                  <div className="hub-actions">
                    <button
                      className="hub-primary"
                      disabled={busy || !rename.trim()}
                    >
                      Save name
                    </button>
                    <button type="button" onClick={() => setEditing(null)}>
                      Cancel rename
                    </button>
                  </div>
                </form>
              )}
              {deleting === entry.id && (
                <div
                  className="hub-confirm"
                  role="group"
                  aria-label="Confirm session deletion"
                >
                  <p>
                    Delete “{entry.name}” and its journal images? This cannot be
                    undone.
                  </p>
                  <div className="hub-actions">
                    <button
                      className="hub-danger"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api(
                            `/sessions/${entry.id}`,
                            undefined,
                            'DELETE',
                          );
                          if (library.record?.id === entry.id) library.detach();
                          setDeleting(null);
                        }, 'Session deleted.')
                      }
                    >
                      Delete permanently
                    </button>
                    <button onClick={() => setDeleting(null)}>
                      Keep session
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))
        )}
      </div>
      <details className="hub-disclosure">
        <summary>Import & browser storage</summary>
        <p>
          Bring a session ZIP from another server, or copy this browser's local
          workspace into your library.
        </p>
        <div className="hub-actions">
          <label className="hub-file">
            Import archive
            <input
              type="file"
              accept=".zip"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void perform(async () => {
                    const response = await fetch('/api/sessions-import', {
                      method: 'POST',
                      body: file,
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.detail);
                  }, 'Archive imported into your library.');
                e.target.value = '';
              }}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void perform(
                () =>
                  library.save(
                    'Imported browser workspace',
                    session,
                    JSON.stringify({
                      market: session.market,
                      cursor: session.cursor,
                      account: session.account,
                    }),
                  ),
                'Browser workspace added to your library.',
              )
            }
          >
            Import existing browser workspace
          </button>
          <button
            disabled={busy}
            onClick={() => {
              library.detach();
              onClose();
            }}
          >
            Use browser workspace
          </button>
        </div>
      </details>
    </section>
  );
}

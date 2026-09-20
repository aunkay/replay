import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoredSession } from './session';
import { createWorkspaceId } from './workspaceId';
export async function api<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail ?? 'Server request failed');
  return data;
}
export type ServerRecord = {
  id: string;
  name: string;
  revision: number;
  archived: boolean;
  payload: { session: StoredSession; preferences?: Record<string, string> };
  controller?: string;
};
export function preferences() {
  const result: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (
      key.startsWith('replay-') &&
      key !== 'replay-market-lab:v1' &&
      !key.startsWith('replay-server')
    )
      result[key] = localStorage.getItem(key)!;
  }
  return result;
}
export function useServerSession(
  session: StoredSession,
  restore: (s: StoredSession) => void,
) {
  const [record, setRecord] = useState<ServerRecord | null>(null),
    [status, setStatus] = useState('Browser workspace'),
    [error, setError] = useState('');
  const [client] = useState(() => {
    const old = sessionStorage.getItem('replay-controller');
    if (old) return old;
    const id = createWorkspaceId();
    sessionStorage.setItem('replay-controller', id);
    return id;
  });
  const ref = useRef(record),
    sessionRef = useRef(session),
    saved = useRef(''),
    savedPreferences = useRef(''),
    busy = useRef(false);
  ref.current = record;
  sessionRef.current = session;
  const accept = useCallback(
    (r: ServerRecord) => {
      saved.current = JSON.stringify(r.payload.session);
      savedPreferences.current = JSON.stringify(r.payload.preferences ?? {});
      ref.current = r;
      localStorage.setItem('replay-server-session', r.id);
      setRecord(r);
      restore(r.payload.session);
      setStatus('Saved on server');
      setError('');
    },
    [restore],
  );
  async function save(
    name: string,
    snapshot = sessionRef.current,
    fingerprint?: string,
  ) {
    const r = await api<ServerRecord>('/sessions', {
      name,
      payload: { session: snapshot, preferences: preferences() },
      fingerprint,
    });
    const owned = await api<ServerRecord>(`/sessions/${r.id}/control`, {
      client,
    });
    accept(owned);
    return owned;
  }
  async function open(id: string, takeover = false) {
    let r = await api<ServerRecord>(`/sessions/${id}`);
    try {
      r = await api<ServerRecord>(`/sessions/${id}/control`, {
        client,
        takeover,
      });
    } catch (error) {
      if (takeover) throw error;
    }
    accept(r);
    if (r.controller !== client)
      setStatus('Viewing · another device controls trading');
    if (r.payload.preferences)
      for (const [key, value] of Object.entries(r.payload.preferences))
        localStorage.setItem(key, value);
    window.dispatchEvent(new Event('replay:preferences-restored'));
    return r;
  }
  useEffect(() => {
    const id = localStorage.getItem('replay-server-session');
    if (id) void open(id).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!record || record.controller !== client) return;
    const heartbeat = window.setInterval(() => {
      api<ServerRecord>(`/sessions/${record.id}/control`, { client }).catch(
        (e) => {
          setError(e.message);
          setStatus('Control lost');
        },
      );
    }, 15000);
    return () => clearInterval(heartbeat);
  }, [record?.id, record?.controller, client]);
  const [preferencesVersion, setPreferencesVersion] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (
        ref.current?.controller === client &&
        !busy.current &&
        JSON.stringify(preferences()) !== savedPreferences.current
      )
        setPreferencesVersion((v) => v + 1);
    }, 1500);
    return () => clearInterval(timer);
  }, [client]);
  useEffect(() => {
    if (
      !record ||
      record.controller !== client ||
      (saved.current === JSON.stringify(session) &&
        savedPreferences.current === JSON.stringify(preferences())) ||
      busy.current
    )
      return;
    const timeout = window.setTimeout(async () => {
      if (busy.current || !ref.current) return;
      busy.current = true;
      setStatus('Saving…');
      try {
        const r = await api<ServerRecord>(
          `/sessions/${ref.current.id}`,
          {
            revision: ref.current.revision,
            client,
            payload: {
              ...ref.current.payload,
              session: sessionRef.current,
              preferences: preferences(),
            },
          },
          'PUT',
        );
        saved.current = JSON.stringify(r.payload.session);
        savedPreferences.current = JSON.stringify(r.payload.preferences ?? {});
        ref.current = r;
        setRecord(r);
        setStatus('Saved on server');
      } catch (e) {
        setError((e as Error).message);
        setStatus('Not saved');
      } finally {
        busy.current = false;
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [session, record, client, preferencesVersion]);
  useEffect(() => {
    if (!record) return;
    const events = new EventSource(`/api/sessions/${record.id}/events`);
    events.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as ServerRecord;
        if (!busy.current && incoming.revision > (ref.current?.revision ?? 0))
          accept(incoming);
      } catch {
        setError('Invalid session update');
      }
    };
    return () => events.close();
  }, [record?.id, accept]);
  async function command(command: unknown) {
    if (!ref.current) return false;
    if (ref.current.controller !== client)
      throw new Error('Take control before trading in this session.');
    if (busy.current)
      throw new Error('Wait for the current save or command to finish.');
    if (error)
      throw new Error('Reconnect or reload the session before trading.');
    busy.current = true;
    try {
      const r = await api<ServerRecord>(
        `/sessions/${ref.current.id}/commands`,
        {
          revision: ref.current.revision,
          client,
          key: createWorkspaceId(),
          command,
        },
      );
      accept(r);
      return true;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      busy.current = false;
    }
  }
  return {
    record,
    status,
    error,
    client,
    save,
    open,
    command,
    accept,
    detach: () => {
      localStorage.removeItem('replay-server-session');
      ref.current = null;
      setRecord(null);
      setError('');
      setStatus('Browser workspace');
    },
  };
}

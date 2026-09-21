import { useEffect, useRef, useState } from 'react';
import { api } from './server';
import type { StoredSession } from './session';
import { createWorkspaceId } from './workspaceId';
export function useLive(
  session: StoredSession,
  restore: (s: StoredSession) => void,
  client: string,
  streams: { ticker: string; interval: string }[],
  savedId?: string,
) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    replay = useRef<StoredSession | null>(null),
    restoring = useRef(restore);
  restoring.current = restore;
  const preserveConnectedStreams = useRef(false);
  const pendingBackground = useRef<boolean | null>(null);
  const id = state?.id;
  const streamSignature = JSON.stringify(streams);
  useEffect(() => {
    if (preserveConnectedStreams.current) {
      preserveConnectedStreams.current = false;
      return;
    }
    if (id)
      api(`/live/${id}/streams`, { client, streams }, 'PUT').catch((e) =>
        setError(e.message),
      );
  }, [id, client, streamSignature]);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const stream = new EventSource(`/api/live/${id}/events`);
    stream.onmessage = (event) => {
      if (cancelled) return;
      try {
        const next = JSON.parse(event.data);
        setState(
          pendingBackground.current === null
            ? next
            : { ...next, background: pendingBackground.current },
        );
        if (next.session) restoring.current(next.session);
        if (next.active) setError('');
        else
          setError(
            next.error ??
              'Live paused after the last client disconnected. Acknowledge the monitoring gap before resuming.',
          );
      } catch {
        setError('Invalid live update received');
      }
    };
    stream.onerror = () => {
      if (!cancelled)
        setError(
          'Live connection interrupted; reconnecting. Orders stay on the server.',
        );
    };
    const heartbeat = () => {
      if (document.hidden) return;
      api(`/live/${id}/heartbeat`, { client }).catch((e) => {
        if (!cancelled) setError(e.message);
      });
    };
    const timer = setInterval(heartbeat, 15000);
    void heartbeat();
    return () => {
      cancelled = true;
      stream.close();
      clearInterval(timer);
    };
  }, [id, client]);
  async function toggle() {
    setBusy(true);
    try {
      if (id) {
        await api(`/live/${id}`, undefined, 'DELETE');
        setState(null);
        if (replay.current) restore(replay.current);
        replay.current = null;
      } else {
        replay.current = session;
        setState(
          await api('/live', {
            client,
            config: session.account.config,
            streams,
            resumeSession: session.mode === 'live' ? session : undefined,
            resumeId: session.mode === 'live' ? savedId : undefined,
          }),
        );
      }
      setError('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function connect(monitorId: string) {
    setBusy(true);
    try {
      const next = await api(`/live/${monitorId}/connect`, { client });
      replay.current = session;
      preserveConnectedStreams.current = true;
      if (next.session) restore(next.session);
      setState(next);
      setError('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function background(enabled: boolean) {
    const previous = state?.background;
    pendingBackground.current = enabled;
    setState((old: any) => ({ ...old, background: enabled }));
    setBusy(true);
    try {
      setState(await api(`/live/${id}/background`, { client, enabled }, 'PUT'));
      setError('');
    } catch (e) {
      setState((old: any) => ({ ...old, background: previous }));
      setError((e as Error).message);
    } finally {
      pendingBackground.current = null;
      setBusy(false);
    }
  }
  async function command(command: unknown) {
    if (!id) return false;
    await api(`/live/${id}/orders`, {
      client,
      key: createWorkspaceId(),
      command,
    });
    return true;
  }
  async function resume() {
    if (id) {
      const next = await api(`/live/${id}/resume`, { client });
      setState(next);
      setError('');
    }
  }
  const refresh = () =>
    api(`/live/${id}/refresh`, { client })
      .then(setState)
      .catch((e) => setError(e.message));
  const cancelQueued = (key: string) =>
    api(`/live/${id}/orders/${key}`, { client }, 'DELETE')
      .then(setState)
      .catch((e) => setError(e.message));
  return {
    state,
    error,
    busy,
    active: !!id,
    toggle,
    connect,
    background,
    command,
    resume,
    refresh,
    cancelQueued,
  };
}

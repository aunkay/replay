import { isValidSession, type StoredSession } from './session';
export type CheckpointCommand = {
  type: 'checkpoint';
  action: 'save' | 'delete' | 'restore';
  id: string;
  name?: string;
};
export function applyCheckpoint(
  session: StoredSession,
  command: CheckpointCommand,
): StoredSession {
  if (session.mode === 'live' || session.blind)
    throw new Error('Checkpoints are available in regular replay only.');
  if (
    typeof command.id !== 'string' ||
    !command.id.trim() ||
    command.id.length > 100
  )
    throw new Error('Invalid checkpoint identifier.');
  const checkpoints = session.checkpoints ?? [];
  if (command.action === 'save') {
    const name = command.name?.trim();
    if (!name || name.length > 100)
      throw new Error('Enter a checkpoint name of up to 100 characters.');
    if (checkpoints.length >= 20)
      throw new Error(
        'This session already has 20 checkpoints. Delete one before saving another.',
      );
    if (checkpoints.some((c) => c.id === command.id))
      throw new Error('Checkpoint already exists.');
    return {
      ...session,
      checkpoints: [
        ...checkpoints,
        {
          id: command.id,
          name,
          cursor: session.cursor,
          startCursor: session.startCursor,
          account: structuredClone(session.account),
          portfolio: structuredClone(session.portfolio),
          finerMarket: structuredClone(session.finerMarket),
          alerts: structuredClone(session.alerts),
          alertEvents: structuredClone(session.alertEvents),
        },
      ],
    };
  }
  const checkpoint = checkpoints.find((c) => c.id === command.id);
  if (!checkpoint) throw new Error('Checkpoint not found.');
  if (command.action === 'delete')
    return {
      ...session,
      checkpoints: checkpoints.filter((c) => c.id !== command.id),
    };
  if (command.action !== 'restore')
    throw new Error('Unknown checkpoint action.');
  const restored = {
    ...session,
    cursor: checkpoint.cursor,
    startCursor: checkpoint.startCursor,
    account: structuredClone(checkpoint.account),
    portfolio: structuredClone(checkpoint.portfolio),
    finerMarket: structuredClone(checkpoint.finerMarket),
    alerts: structuredClone(checkpoint.alerts),
    alertEvents: structuredClone(checkpoint.alertEvents),
  };
  if (!isValidSession(restored))
    throw new Error('This checkpoint does not match the session dataset.');
  return restored;
}

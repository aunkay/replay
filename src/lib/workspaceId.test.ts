import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspaceId } from './workspaceId';

afterEach(() => vi.unstubAllGlobals());

it('uses the native UUID generator when available', () => {
  const randomUUID = vi.fn(() => 'native-uuid');
  vi.stubGlobal('crypto', { randomUUID });
  expect(createWorkspaceId()).toBe('native-uuid');
  expect(randomUUID).toHaveBeenCalledOnce();
});

it('creates distinct version 4 UUIDs when randomUUID is unavailable on HTTP', () => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(
    globalThis.crypto,
  );
  vi.stubGlobal('crypto', { getRandomValues });
  const ids = Array.from({ length: 1000 }, createWorkspaceId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
});

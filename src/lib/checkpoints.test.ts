import { expect, it } from 'vitest';
import { applyCheckpoint } from './checkpoints';
import { createDemo } from './data';
import { createAccount, advanceBar, submitOrder } from './engine';
import { isValidSession, type StoredSession } from './session';
function initial(): StoredSession {
  const market = createDemo();
  return {
    market,
    cursor: 20,
    startCursor: 20,
    account: advanceBar(
      createAccount({
        initialCapital: 10000,
        commissionBps: 0,
        slippageBps: 0,
      }),
      market.bars[20],
    ),
  };
}
it('restores a deep account snapshot and retains checkpoints for retries', () => {
  const s = initial(),
    saved = applyCheckpoint(s, {
      type: 'checkpoint',
      action: 'save',
      id: 'one',
      name: 'Entry',
    });
  const changed = {
    ...saved,
    account: submitOrder(
      saved.account,
      { side: 'buy', type: 'market', quantity: 1 },
      s.market.bars[20],
    ),
  };
  const restored = applyCheckpoint(changed, {
    type: 'checkpoint',
    action: 'restore',
    id: 'one',
  });
  expect(restored.account).toEqual(s.account);
  expect(restored.account).not.toBe(saved.checkpoints![0].account);
  expect(isValidSession(restored)).toBe(true);
  expect(
    applyCheckpoint(restored, {
      type: 'checkpoint',
      action: 'delete',
      id: 'one',
    }).checkpoints,
  ).toEqual([]);
});
it('rejects corrupt imported checkpoints and disallows Live or blind rewinds', () => {
  const s = initial();
  expect(() =>
    applyCheckpoint(
      { ...s, mode: 'live' },
      { type: 'checkpoint', action: 'save', id: 'a', name: 'a' },
    ),
  ).toThrow(/regular replay/);
  const saved = applyCheckpoint(s, {
    type: 'checkpoint',
    action: 'save',
    id: 'a',
    name: 'a',
  });
  saved.checkpoints![0].account.cash += 100;
  expect(isValidSession(saved)).toBe(false);
  expect(() =>
    applyCheckpoint(saved, { type: 'checkpoint', action: 'restore', id: 'a' }),
  ).toThrow(/dataset/);
});

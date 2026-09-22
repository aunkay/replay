import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './helpers/workspace';

// Both browser projects share one server-wide connection. Serialize only this
// destructive settings journey; unrelated chart tests can remain parallel.
const lock = join(tmpdir(), `replay-telegram-settings-${process.ppid}`);
let ownsLock = false;
test.beforeAll(async () => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'Requires the offline Telegram fixture server.',
  );
  const deadline = Date.now() + 25_000;
  while (!ownsLock) {
    try {
      await mkdir(lock);
      ownsLock = true;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
        Date.now() > deadline
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
});
test.afterAll(async () => {
  if (ownsLock) await rm(lock, { recursive: true, force: true });
});

test('Telegram setup discovers a chat, saves without resetting account, tests and disconnects', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: isMobile ? 'Mobile account settings' : 'Account settings',
      exact: true,
    })
    .click();
  await page.locator('.telegram-settings summary').click();
  await page
    .getByLabel('Bot token', { exact: true })
    .fill('123456:e2e_fake_token');
  await page.getByRole('button', { name: 'Find Telegram chats' }).click();
  await page.getByLabel('Recent Telegram chats').selectOption('123456');
  await page
    .getByLabel('Enable Telegram notifications', { exact: true })
    .check();
  await page.getByLabel('Also send replay alerts').check();
  await page.getByRole('button', { name: 'Save Telegram connection' }).click();
  await expect(page.locator('.telegram-settings')).toContainText(
    'Telegram connection saved.',
  );
  await expect(page.getByLabel('Bot token', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'e2e_fake_token',
  );
  await page.getByRole('button', { name: 'Send test message' }).click();
  await expect(page.locator('.telegram-settings')).toContainText(
    'Test message sent.',
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator('.market-alerts-panel summary').click();
  const alerts = page.getByRole('region', { name: 'Market alerts' });
  await alerts
    .getByLabel('Alert name', { exact: true })
    .fill('Telegram delivery check');
  await alerts
    .getByLabel('Condition operator', { exact: true })
    .selectOption('gt');
  await alerts.getByLabel('Constant', { exact: true }).fill('0');
  await alerts.getByRole('button', { name: 'Create alert' }).click();
  const queued = page.waitForResponse((r) =>
    r.url().includes('/telegram/replay-events'),
  );
  await page
    .getByRole('button', {
      name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
      exact: true,
    })
    .click();
  expect((await queued).ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/notifications/telegram')).json())
          .delivery?.status,
    )
    .toBe('sent');
  await page.reload();
  await page
    .getByRole('button', {
      name: isMobile ? 'Mobile account settings' : 'Account settings',
      exact: true,
    })
    .click();
  await page.locator('.telegram-settings summary').click();
  await expect(
    page.getByLabel('Telegram chat ID', { exact: true }),
  ).toHaveValue('123456');
  await expect(
    page.getByLabel('Enable Telegram notifications', { exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Disconnect Telegram' }).click();
  await expect(page.locator('.telegram-settings')).toContainText(
    'Telegram disconnected.',
  );
  await expect(
    page.getByRole('button', { name: 'Send test message' }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

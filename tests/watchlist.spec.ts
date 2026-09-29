import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './helpers/workspace';
const lock = join(tmpdir(), `replay-watchlist-${process.ppid}`);
let owns = false;
test.beforeAll(async () => {
  test.setTimeout(90000);
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'Requires isolated offline provider fixtures.',
  );
  const deadline = Date.now() + 70000;
  while (!owns) {
    try {
      await mkdir(lock);
      owns = true;
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code !== 'EEXIST' ||
        Date.now() > deadline
      )
        throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});
test.afterAll(async () => {
  if (owns) await rm(lock, { recursive: true, force: true });
});
test.afterEach(async ({ request }) => {
  await request.put('/api/watchlist', {
    data: { tickers: [], interval: 60, enabled: true },
  });
});

test('watchlist persists ten tickers, shows signed quotes, scrolls accessibly and can pause polling', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  const banner = page.getByRole('region', { name: 'Market watchlist' });
  await banner.locator('summary').click();
  await expect(
    banner.getByRole('button', { name: 'Save watchlist', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Ticker symbols', { exact: true }).fill('aapl, msft');
  await banner
    .getByRole('button', { name: 'Add tickers', exact: true })
    .click();
  await banner
    .getByRole('button', { name: 'Save watchlist', exact: true })
    .click();
  const primary = banner.locator('.watchlist-group[role=list]');
  await expect(primary.locator('[data-ticker=AAPL]')).toContainText('+', {
    timeout: 20000,
  });
  await expect(primary.locator('[data-ticker=MSFT]')).toContainText(
    '(-2.00%)',
    { timeout: 20000 },
  );
  await expect(primary.locator('[data-ticker=AAPL]')).toHaveClass(/positive/);
  await expect(primary.locator('[data-ticker=MSFT]')).toHaveClass(/negative/);
  await banner.locator('summary').click();
  await page
    .getByLabel('Ticker symbols', { exact: true })
    .fill('SPY QQQ NVDA TSLA AMD META AMZN GOOG');
  await banner
    .getByRole('button', { name: 'Add tickers', exact: true })
    .click();
  await page.getByLabel('Ticker symbols', { exact: true }).fill('IBM');
  await banner
    .getByRole('button', { name: 'Add tickers', exact: true })
    .click();
  await expect(banner.getByRole('alert')).toContainText('up to 10');
  await page.getByLabel('Ticker symbols', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Move MSFT up', exact: true }).click();
  await page.getByLabel('Watchlist polling interval').selectOption('30');
  await banner
    .getByRole('button', { name: 'Save watchlist', exact: true })
    .click();
  await expect(primary.getByRole('listitem')).toHaveCount(10);
  await expect(primary.getByRole('listitem').first()).toContainText('MSFT');
  await expect(banner.locator('.watchlist-track')).toHaveClass(/is-scrolling/);
  await page.getByRole('button', { name: 'Stop watchlist animation' }).click();
  await expect(banner.locator('.watchlist-track')).not.toHaveClass(
    /is-scrolling/,
  );
  await page.reload();
  await expect(primary.getByRole('listitem')).toHaveCount(10);
  await expect(
    page.getByRole('button', { name: 'Start watchlist animation' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start watchlist animation' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(banner.locator('.watchlist-track')).toHaveCSS(
    'animation-name',
    'none',
  );
  await banner.locator('summary').click();
  await expect(page.getByLabel('Watchlist polling interval')).toHaveValue('30');
  await page.getByLabel('Enable quote polling').uncheck();
  await page
    .getByRole('button', { name: 'Remove GOOG from watchlist', exact: true })
    .click();
  await banner
    .getByRole('button', { name: 'Save watchlist', exact: true })
    .click();
  await expect(primary.getByRole('listitem')).toHaveCount(9);
  const state = await (await page.request.get('/api/watchlist')).json();
  expect(state.enabled).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('watchlist-banner.png'),
  });
});

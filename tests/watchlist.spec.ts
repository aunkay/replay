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

test('ticker loops without a seam jump and quote refreshes preserve its scroll position', async ({
  page,
}) => {
  const tickers = [
    'MSFT',
    'ASTS',
    'RKLB',
    'SPY',
    'IWM',
    'GLD',
    'IBIT',
    'SPCX',
    'LUNR',
    'BB',
  ];
  let price = 123.45;
  await page.route('**/api/watchlist/heartbeat', (route) =>
    route.fulfill({
      json: {
        tickers,
        interval: 60,
        enabled: true,
        monitoring: true,
        provider: { retryAt: null },
        quotes: tickers.map((ticker) => ({
          ticker,
          price,
          changePct: 1.23,
          currency: 'USD',
          stale: false,
        })),
      },
    }),
  );
  await page.goto('/');
  const track = page.locator('.watchlist-track');
  await expect(track).toHaveClass(/is-scrolling/);
  await page.getByRole('button', { name: 'Stop watchlist animation' }).click();
  await page.getByRole('button', { name: 'Start watchlist animation' }).click();
  await page.mouse.move(0, 500);
  await expect(track).toHaveCSS('animation-play-state', 'running');
  const started = await track.evaluate((e) =>
    Number(e.getAnimations()[0].currentTime),
  );
  await expect
    .poll(() => track.evaluate((e) => Number(e.getAnimations()[0].currentTime)))
    .toBeGreaterThan(started + 50);
  const seam = await track.evaluate((e) => {
    const animation = e.getAnimations()[0];
    animation.pause();
    const duration = Number(animation.effect!.getTiming().duration);
    animation.currentTime = duration - 0.5;
    const before =
      e.children[1].firstElementChild!.getBoundingClientRect().left;
    animation.currentTime = duration + 0.5;
    const after = e.children[0].firstElementChild!.getBoundingClientRect().left;
    animation.currentTime = duration * 0.7;
    const offset = new DOMMatrix(getComputedStyle(e).transform).m41;
    return { before, after, offset, duration };
  });
  // Crossing the seam advances by just 1 ms of normal motion (35 px/sec).
  expect(Math.abs(seam.after - seam.before + 0.035)).toBeLessThan(0.12);
  price = 12345678.9;
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await expect(track.locator('[role=list] [data-ticker=MSFT]')).toContainText(
    '12,345,678.90',
  );
  await expect
    .poll(() =>
      track.evaluate((e) =>
        Number(e.getAnimations()[0].effect!.getTiming().duration),
      ),
    )
    .toBeGreaterThan(seam.duration);
  const updated = await track.evaluate(
    (e) => new DOMMatrix(getComputedStyle(e).transform).m41,
  );
  expect(Math.abs(updated - seam.offset)).toBeLessThan(0.2);
  const widths = await track
    .locator('.watchlist-group')
    .evaluateAll((groups) =>
      groups.map((g) => g.getBoundingClientRect().width),
    );
  expect(Math.abs(widths[0] - widths[1])).toBeLessThan(0.02);
});

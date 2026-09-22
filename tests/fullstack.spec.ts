import {
  test,
  expect,
  openData,
  savedSession,
  buy,
  dollars,
} from './helpers/workspace';

// No page.route here: these journeys cross Vite's proxy and the real FastAPI
// application. The dedicated API process replaces only yfinance's upstream I/O.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
});

test('full stack: market data loads through the API and trades reconcile to the provider candles', async ({
  page,
}) => {
  await openData(page);
  const responseEvent = page.waitForResponse('**/api/market-data?**');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  const response = await responseEvent;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload).toMatchObject({
    ticker: 'AAPL',
    source: 'yfinance',
    interval: '1d',
    adjusted: true,
    currency: 'USD',
  });
  // Background Live journeys can append provider candles to the shared feed.
  // Assert accounting against this response rather than assuming its old length.
  expect(payload.bars.length).toBeGreaterThanOrEqual(60);
  const cursor = Math.min(90, Math.floor(payload.bars.length * 0.3));
  const entryClose = 100 + cursor * 2 + 1;
  const exitClose = entryClose + 2;
  expect(payload.bars[cursor].close).toBe(entryClose);
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  await expect(page.locator('.instrument-price')).toContainText(
    dollars(entryClose),
  );
  await buy(page);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await expect(page.locator('.instrument-price')).toContainText(
    dollars(exitClose),
  );
  await page
    .getByRole('button', { name: 'Close position', exact: true })
    .click();
  const entry = entryClose * 1.0001;
  const exit = exitClose * 0.9999;
  const pnl = 10 * (exit - entry) - 10 * (entry + exit) * 0.0001;
  await expect(
    page
      .locator('.metric')
      .filter({ hasText: 'Account equity' })
      .locator('strong'),
  ).toHaveText(dollars(100_000 + pnl));
  await expect(
    page
      .locator('.metric')
      .filter({ hasText: 'Realized P&L' })
      .locator('strong'),
  ).toHaveText(`+${dollars(pnl)}`);
  await page.reload();
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  expect((await savedSession(page)).account.realizedPnl).toBeCloseTo(pnl, 8);
});

test('full stack: intraday ticker selection reaches the API and returns the selected interval', async ({
  page,
}) => {
  await openData(page);
  await page.getByLabel('Ticker symbol', { exact: true }).fill('MSFT');
  await page.getByLabel('Candle interval', { exact: true }).selectOption('15m');
  const responseEvent = page.waitForResponse('**/api/market-data?**');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  const response = await responseEvent;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.ticker).toBe('MSFT');
  expect(payload.interval).toBe('15m');
  expect(payload.bars[1].time - payload.bars[0].time).toBe(900);
  await expect(
    page.getByRole('heading', { name: /Microsoft Corporation/ }),
  ).toBeVisible();
  await expect(page.locator('.instrument-price')).toContainText('$337.00');
});

test('full stack: custom date range includes its start and excludes its end', async ({
  page,
}) => {
  await openData(page);
  await page
    .getByLabel('History range', { exact: true })
    .selectOption('custom');
  await page.getByLabel('Start date', { exact: true }).fill('2025-01-13');
  await page
    .getByLabel('End date (exclusive)', { exact: true })
    .fill('2025-01-20');
  const responseEvent = page.waitForResponse('**/api/market-data?**');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  const response = await responseEvent;
  expect(response.status()).toBe(200);
  const { bars } = await response.json();
  expect(bars).toHaveLength(5);
  expect(bars[0].time).toBe(Date.parse('2025-01-13T00:00:00Z') / 1000);
  expect(bars.at(-1).time).toBe(Date.parse('2025-01-17T00:00:00Z') / 1000);
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  await expect(page.locator('.replay-progress')).toContainText('2 / 5 bars');
});

test('full stack: API range validation preserves the account and allows correction', async ({
  page,
}) => {
  await buy(page);
  const before = await savedSession(page);
  await openData(page);
  await page.getByLabel('Candle interval', { exact: true }).selectOption('1m');
  await page.getByLabel('History range', { exact: true }).selectOption('1y');
  const responseEvent = page.waitForResponse('**/api/market-data?**');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  expect((await responseEvent).status()).toBe(400);
  await expect(page.getByRole('alert')).toContainText('7-day window');
  expect(await savedSession(page)).toEqual(before);
  await page.getByLabel('History range', { exact: true }).selectOption('5d');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  expect((await savedSession(page)).market.interval).toBe('1m');
});

for (const [ticker, status, message] of [
  ['BADTICKER', 404, 'no candles'],
  ['RATELIMIT', 429, 'rate-limiting'],
] as const) {
  test(`full stack: provider ${status} is actionable and does not replace the session`, async ({
    page,
  }) => {
    await buy(page);
    const before = await savedSession(page);
    await openData(page);
    await page.getByLabel('Ticker symbol', { exact: true }).fill(ticker);
    const responseEvent = page.waitForResponse('**/api/market-data?**');
    await page
      .getByRole('button', { name: 'Load & start replay', exact: true })
      .click();
    const response = await responseEvent;
    expect(response.status()).toBe(status);
    if (status === 429)
      expect(Number(response.headers()['retry-after'])).toBeGreaterThanOrEqual(
        30,
      );
    await expect(page.getByRole('alert')).toContainText(message);
    expect(await savedSession(page)).toEqual(before);
    if (status === 429) await page.request.post('/api/test/reset-provider');
    await page.getByLabel('Ticker symbol', { exact: true }).fill('AAPL');
    await page
      .getByRole('button', { name: 'Load & start replay', exact: true })
      .click();
    await expect(
      page.getByText('YAHOO FINANCE', { exact: true }),
    ).toBeVisible();
  });
}

import {
  test,
  expect,
  savedSession,
  openData,
  yahooFixture,
} from './helpers/workspace';
test('higher-timeframe alert waits for completion and strategy worker accepts mixed rules', async ({
  page,
  isMobile,
}) => {
  const market = yahooFixture();
  market.interval = '1m';
  market.bars = market.bars.map((_b, i) => ({
    time: Date.parse('2025-01-06T00:00:00Z') / 1000 + i * 60,
    endTime: Date.parse('2025-01-06T00:00:00Z') / 1000 + (i + 1) * 60,
    open: 100,
    high: i >= 19 ? 111 : 101,
    low: 99,
    close: i >= 19 ? 110 : 100,
    volume: 1000,
  }));
  await page.route('**/api/market-data?**', (r) => r.fulfill({ json: market }));
  await page.goto('/');
  await openData(page);
  await page.getByLabel('Ticker symbol', { exact: true }).fill('MSFT');
  await page
    .getByRole('combobox', { name: 'Candle interval' })
    .selectOption('1m');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect.poll(async () => (await savedSession(page)).cursor).toBe(18);
  await page.locator('.market-alerts-panel summary').click();
  const alerts = page.getByRole('region', { name: 'Market alerts' });
  await alerts
    .getByLabel('Alert name', { exact: true })
    .fill('Five minute breakout');
  await alerts.getByLabel('Rule timeframe', { exact: true }).selectOption('5m');
  await alerts.getByLabel('Constant', { exact: true }).fill('105');
  await alerts.getByRole('button', { name: 'Create alert' }).click();
  await expect(
    alerts.getByRole('article', { name: 'Alert Five minute breakout' }),
  ).toContainText('Armed');
  await page
    .getByRole('button', {
      name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
      exact: true,
    })
    .click();
  await expect(
    alerts.getByRole('article', { name: 'Alert Five minute breakout' }),
  ).toContainText('Triggered');
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  await page.getByText('2. Entry & exit rules', { exact: true }).click();
  await page
    .getByLabel('Rule timeframe', { exact: true })
    .first()
    .selectOption('5m');
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Backtest results', exact: true }),
  ).toBeVisible({ timeout: 15000 });
});

import {
  test,
  expect,
  savedSession,
  openData,
  yahooFixture,
} from './helpers/workspace';
for (const server of [false, true])
  test(`price alert pauses replay and persists history ${server ? 'on server' : 'locally'}`, async ({
    page,
    isMobile,
  }) => {
    const fixture = yahooFixture();
    fixture.bars = fixture.bars.map((b, i) => ({
      ...b,
      open: i <= 18 ? 100 : 110,
      high: i <= 18 ? 101 : 111,
      low: i <= 18 ? 99 : 109,
      close: i <= 18 ? 100 : 110,
    }));
    await page.route('**/api/market-data?**', (r) =>
      r.fulfill({ json: fixture }),
    );
    await page.goto('/');
    await openData(page);
    await page.getByLabel('Ticker symbol', { exact: true }).fill('MSFT');
    await page
      .getByRole('combobox', { name: 'Candle interval' })
      .selectOption('15m');
    await page
      .getByRole('button', { name: 'Load & start replay', exact: true })
      .click();
    await expect
      .poll(async () => (await savedSession(page))?.market.ticker)
      .toBe('MSFT');
    if (server) {
      await page
        .getByRole('button', { name: 'Practice & research', exact: true })
        .click();
      await page
        .getByLabel('Session name', { exact: true })
        .fill(`Alert ${Date.now()}`);
      await page.getByRole('button', { name: 'Save as new session' }).click();
      await expect(page.locator('.server-save-status')).toContainText(
        'Saved on server',
      );
      await page
        .getByRole('button', { name: 'Close practice workspace' })
        .click();
    }
    await page.locator('.alerts-panel summary').click();
    const alerts = page.getByRole('region', { name: 'Market alerts' });
    await alerts.getByLabel('Alert name', { exact: true }).fill('Breakout 105');
    await alerts.getByLabel('Constant', { exact: true }).fill('105');
    await alerts.getByRole('button', { name: 'Create alert' }).click();
    await expect(
      alerts.getByRole('article', { name: 'Alert Breakout 105' }),
    ).toContainText('Armed');
    await page
      .getByRole('button', {
        name: isMobile ? 'Play from mobile toolbar' : 'Play replay',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('button', {
        name: isMobile ? 'Play from mobile toolbar' : 'Play replay',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      alerts.getByRole('article', { name: 'Alert Breakout 105' }),
    ).toContainText('Triggered');
    expect((await savedSession(page)).cursor).toBe(19);
    await expect(alerts.getByRole('listitem')).toContainText('Breakout 105');
    await page.reload();
    await page.locator('.alerts-panel summary').click();
    await expect(alerts.getByRole('listitem')).toContainText('Breakout 105');
    await alerts.getByRole('button', { name: 'Rearm alert' }).click();
    await expect(
      alerts.getByRole('article', { name: 'Alert Breakout 105' }),
    ).toContainText('Armed');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
test('indicator alerts and strategy templates can be configured', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await page.locator('.alerts-panel summary').click();
  const alerts = page.getByRole('region', { name: 'Market alerts' });
  await alerts.getByLabel('Alert name', { exact: true }).fill('SMA positive');
  await alerts
    .getByLabel('Operand type', { exact: true })
    .first()
    .selectOption('indicator');
  await alerts.getByLabel('Rule period', { exact: true }).fill('2');
  await alerts
    .getByLabel('Condition operator', { exact: true })
    .selectOption('gt');
  await alerts.getByLabel('Constant', { exact: true }).fill('0');
  await alerts.getByLabel('Pause replay when triggered').uncheck();
  await alerts.getByRole('button', { name: 'Create alert' }).click();
  await page
    .getByRole('button', {
      name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
      exact: true,
    })
    .click();
  await expect(
    alerts.getByRole('article', { name: 'Alert SMA positive' }),
  ).toContainText('Triggered');
  await alerts
    .getByLabel('Alert template', { exact: true })
    .selectOption({ index: 1 });
  await alerts.getByRole('button', { name: 'Create alert' }).click();
  await expect(alerts.getByRole('article')).toHaveCount(2);
});

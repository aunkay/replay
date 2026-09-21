import { test, expect, savedSession } from './helpers/workspace';
test('finer dataset resolves a target before the parent candle stop and survives reload', async ({
  page,
  request,
  isMobile,
}) => {
  const start = Date.parse('2020-01-01T00:00:00Z') / 1000;
  const name = `Fine ${Date.now()} ${isMobile}`;
  const header = 'time,open,high,low,close,volume\n';
  const baseCsv =
    header +
    Array.from(
      { length: 10 },
      (_, i) =>
        `${start + i * 300},100,${i === 4 ? 110 : 101},${i === 4 ? 90 : 99},100,50`,
    ).join('\n');
  const fineCsv =
    header +
    [
      [100, 106, 99, 105],
      [105, 110, 104, 108],
      [108, 109, 100, 101],
      [101, 102, 90, 95],
      [95, 101, 94, 100],
    ]
      .map((b, i) => `${start + 1200 + i * 60},${b.join(',')},10`)
      .join('\n');
  const base = await (
    await request.post('/api/datasets/import', {
      data: {
        name: name + ' base',
        ticker: 'PATH',
        interval: '5m',
        csv: baseCsv,
      },
    })
  ).json();
  const fine = await (
    await request.post('/api/datasets/import', {
      data: { name, ticker: 'PATH', interval: '1m', csv: fineCsv },
    })
  ).json();
  await page.goto('/');
  await page.getByText('Data library & CSV import', { exact: true }).click();
  await page
    .getByRole('article', { name: `Dataset ${name} base` })
    .getByRole('button', { name: 'Load dataset', exact: true })
    .click();
  await expect
    .poll(async () => (await savedSession(page)).market.ticker)
    .toBe('PATH');
  await page.getByText('Finer-candle execution', { exact: true }).click();
  await page
    .getByLabel('Execution dataset', { exact: true })
    .selectOption(fine.id);
  await page
    .getByRole('button', { name: 'Use execution dataset', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Finer execution settings' }),
  ).toContainText('Enabled: 1m');
  if (isMobile)
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .click();
  await page.getByText('Protection & risk sizing', { exact: true }).click();
  await page.getByLabel('Stop-loss', { exact: true }).fill('95');
  await page.getByLabel('Take-profit', { exact: true }).fill('107');
  await page.getByRole('button', { name: /^Buy PATH/ }).click();
  await page
    .getByRole('button', {
      name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (await savedSession(page)).account.orders.find(
          (o) => o.role === 'takeProfit',
        )?.status,
    )
    .toBe('filled');
  await page.reload();
  expect((await savedSession(page)).account.executionCoverage?.fine).toBe(1);
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  await expect(page.getByText(/Finer execution: 1m/)).toBeVisible();
  await page
    .getByText('6. Trailing stops & staged exits', { exact: true })
    .click();
  await page
    .getByLabel('Strategy trailing stop', { exact: true })
    .selectOption('percent');
  await page.getByLabel('Use staged strategy targets').check();
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Backtest results', exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await request.delete(`/api/datasets/${base.id}`);
  await request.delete(`/api/datasets/${fine.id}`);
});

import { test, expect, openData, yahooFixture } from './helpers/workspace';
import { calculateProfile } from '../src/lib/volumeProfile';

test('volume-profile strategy exposes causal SL/PT rules, research and runs in the worker', async ({
  page,
}) => {
  const fixture = yahooFixture();
  fixture.interval = '5m';
  fixture.exchangeTimezone = 'UTC';
  const reference = Array.from({ length: 20 }, (_, i) => ({
    time: 1704272400 + i * 300,
    open: 100,
    close: 100,
    low: i < 18 ? 90 : 100,
    high: i < 18 ? 110 : 101,
    volume: i < 18 ? 100 : 1000,
  }));
  const p = calculateProfile(reference, 20, 70)!,
    edge = p.val,
    day = 1704358800;
  fixture.bars = [
    ...reference.map((b) => ({ ...b, time: b.time - 86400 })),
    ...reference,
    {
      time: day,
      open: edge + 0.2,
      high: edge + 0.4,
      low: edge - 0.4,
      close: edge + 0.1,
      volume: 100,
    },
    {
      time: day + 300,
      open: edge + 0.1,
      high: edge + 0.5,
      low: edge - 0.1,
      close: edge + 0.3,
      volume: 100,
    },
    {
      time: day + 600,
      open: edge + 0.3,
      high: p.pocPrice + 0.2,
      low: edge + 0.2,
      close: p.pocPrice,
      volume: 100,
    },
    {
      time: day + 900,
      open: p.pocPrice,
      high: p.vah + 0.2,
      low: p.pocPrice - 0.1,
      close: p.vah,
      volume: 100,
    },
  ];
  await page.route('**/api/market-data?**', (r) =>
    r.fulfill({ json: fixture }),
  );
  await page.goto('/');
  await openData(page);
  await page.getByLabel('Ticker symbol', { exact: true }).fill('MSFT');
  await page
    .getByRole('combobox', { name: 'Candle interval' })
    .selectOption('5m');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  await page
    .getByLabel('Find a strategy', { exact: true })
    .fill('volume profile');
  await page
    .getByRole('button', {
      name: 'Volume profile sweep & reclaim',
      exact: true,
    })
    .click();
  await page.getByText('2. Entry & exit rules', { exact: true }).click();
  await expect(page.getByLabel('Volume profile strategy rules')).toContainText(
    'A later candle',
  );
  await page.getByLabel('Profile session timezone').fill('UTC');
  await page
    .getByText('Profile, confirmation and risk parameters', { exact: true })
    .click();
  for (const [label, value] of [
    ['Profile price rows', '20'],
    ['ATR period', '2'],
    ['Minimum sweep (ATR)', '0'],
    ['SL buffer (ATR)', '0.05'],
    ['Minimum reward/risk to POC', '0.1'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('Profile profit-taking plan').selectOption('scale');
  await page
    .getByText('Volume profile research · experimental results', {
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('region', { name: 'Volume profile research results' }),
  ).toContainText('-266.94');
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Backtest results', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.locator('.strategy-builder p').filter({ hasText: 'Net P&L' }),
  ).toContainText('Trades 1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Save strategy', exact: true })
    .click();
  await expect(
    page.getByText(
      'Strategy saved. You can load it from the starting-point menu.',
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

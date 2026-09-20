import type { Locator } from '@playwright/test';
import { expect, savedSession, test } from './helpers/workspace';

test('comparison retains the base quote alongside normalized chart labels through replay and reload', async ({
  page,
  isMobile,
}) => {
  const press = (locator: Locator) =>
    isMobile ? locator.tap() : locator.click();
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  const initial = await savedSession(page);
  await page.route('**/api/market-data?**', (route) =>
    route.fulfill({
      json: {
        ...initial.market,
        ticker: 'SPY',
        name: 'Benchmark',
        source: 'yfinance',
        adjusted: true,
        bars: initial.market.bars.map((bar) => ({
          ...bar,
          open: bar.open * 2,
          high: bar.high * 2,
          low: bar.low * 2,
          close: bar.close * 2,
        })),
      },
    }),
  );
  await press(page.getByRole('button', { name: 'Compare', exact: true }));
  await press(
    page.getByRole('button', { name: 'Add comparison', exact: true }),
  );
  const chart = page.locator('.market-chart');
  await expect(chart).toHaveAttribute('data-comparison-ticker', 'SPY');
  const raw = initial.market.bars[initial.cursor].close;
  const quote = raw.toFixed(2);
  const percent = (raw / initial.market.bars[0].close - 1) * 100;
  const returnLabel = `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
  await expect(chart).toHaveAttribute(
    'data-chart-base-label',
    `${quote} · ${returnLabel}`,
  );
  await expect(chart).toHaveAttribute(
    'data-comparison-last-label',
    returnLabel,
  );
  await expect(page.getByTestId('chart-base-price')).toHaveAttribute(
    'data-value',
    String(raw),
  );
  await expect(page.getByLabel('AAPL price', { exact: true })).toContainText(
    'USD',
  );

  for (const mode of [
    'percent',
    'indexed',
    'ratio',
    'logReturn',
    'zscore',
    'minmax',
  ]) {
    await page
      .getByRole('combobox', { name: 'Normalization', exact: true })
      .selectOption(mode);
    const normalized = await page
      .getByTestId('chart-normalized-value')
      .innerText();
    await expect(chart).toHaveAttribute(
      'data-chart-base-label',
      `${quote} · ${normalized}`,
    );
    await expect(page.getByTestId('chart-base-price')).toHaveText(quote);
  }
  await page
    .getByRole('combobox', { name: 'Normalization', exact: true })
    .selectOption('percent');
  await page
    .getByRole('combobox', { name: 'Price scale', exact: true })
    .selectOption('log');
  await press(
    page.getByRole('button', { name: 'Switch to line chart', exact: true }),
  );
  await expect(chart).toHaveAttribute(
    'data-chart-base-label',
    `${quote} · ${returnLabel}`,
  );
  await press(page.getByRole('button', { name: 'Next candle', exact: true }));
  const nextPrice = initial.market.bars[initial.cursor + 1].close;
  await expect(page.getByTestId('chart-base-price')).toHaveAttribute(
    'data-value',
    String(nextPrice),
  );
  await expect(chart).toHaveAttribute(
    'data-chart-base-label',
    new RegExp(`^${nextPrice.toFixed(2).replace('.', '\\.')} · `),
  );
  await page.reload();
  await expect(page.getByTestId('chart-base-price')).toHaveText(
    nextPrice.toFixed(2),
  );
  await expect(chart).toHaveAttribute('data-comparison-ticker', 'SPY');
  await expect(chart).toHaveAttribute('data-chart-scale', 'log');
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await press(
    page.getByRole('button', { name: 'Remove comparison', exact: true }),
  );
  await expect(chart).not.toHaveAttribute('data-comparison-ticker', 'SPY');
  await expect(page.getByTestId('chart-base-price')).toHaveText(
    nextPrice.toFixed(2),
  );
  await expect(chart).toHaveAttribute(
    'data-chart-base-label',
    await page.getByTestId('chart-normalized-value').innerText(),
  );
  expect((await savedSession(page)).account.orders).toEqual(
    initial.account.orders,
  );
});

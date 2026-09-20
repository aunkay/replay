import type { Locator, Page } from '@playwright/test';
import type { MarketData } from '../src/lib/data';
import { expect, savedSession, test, yahooFixture } from './helpers/workspace';

const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'TLT'];
const rates: Record<string, number> = {
  SPY: 0.001,
  QQQ: 0.002,
  DIA: -0.0005,
  IWM: 0.00025,
  VTI: 0.0015,
};
const row = (page: Page, ticker: string) =>
  page.locator(`[data-comparison-symbol="${ticker}"]`);
const chart = (page: Page) => page.locator('.market-chart');
const readings = async (
  page: Page,
): Promise<
  {
    ticker: string;
    lastLabel: string;
    lastTime: number;
    points: number;
    normalization: string;
  }[]
> =>
  JSON.parse(
    (await chart(page).getAttribute('data-comparison-series')) || '[]',
  );
function fixture(base: MarketData, ticker: string): MarketData {
  return {
    ...base,
    ticker,
    name: `${ticker} benchmark`,
    source: 'yfinance',
    adjusted: true,
    bars: base.bars.map((bar, index) => {
      const close = 200 * (1 + (rates[ticker] ?? 0.001) * index);
      return { ...bar, open: close, high: close + 1, low: close - 1, close };
    }),
  };
}
async function add(
  page: Page,
  ticker: string,
  press: (locator: Locator) => Promise<void>,
) {
  await press(page.getByRole('button', { name: 'Compare', exact: true }));
  await page
    .getByRole('textbox', { name: 'Benchmark ticker', exact: true })
    .fill(ticker);
  await press(
    page.getByRole('button', { name: 'Add comparison', exact: true }),
  );
  await expect(row(page, ticker)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('six tickers share every normalization, preserve base price, and persist independent edits', async ({
  page,
  isMobile,
}) => {
  const press = (locator: Locator) =>
    isMobile ? locator.tap() : locator.click();
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  const initial = await savedSession(page);
  const requested: string[] = [];
  await page.route('**/api/market-data?**', (route) => {
    const query = new URL(route.request().url()).searchParams;
    const ticker = query.get('ticker')!;
    expect(query.get('interval')).toBe(initial.market.interval);
    requested.push(ticker);
    return route.fulfill({ json: fixture(initial.market, ticker) });
  });
  for (const ticker of symbols) await add(page, ticker, press);
  await expect(chart(page)).toHaveAttribute('data-comparison-count', '5');
  await expect(
    page.getByRole('button', { name: 'Compare', exact: true }),
  ).toBeDisabled();
  expect(requested).toEqual(symbols);
  const colors = await page
    .getByLabel('Benchmark color', { exact: true })
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).value),
    );
  expect(new Set(colors).size).toBe(5);
  const basePrice = initial.market.bars[initial.cursor].close;
  for (const mode of [
    'percent',
    'indexed',
    'ratio',
    'logReturn',
    'zscore',
    'minmax',
    'price',
  ]) {
    await page
      .getByRole('combobox', { name: 'Normalization', exact: true })
      .selectOption(mode);
    await expect
      .poll(async () =>
        (await readings(page)).every((item) => item.normalization === mode),
      )
      .toBe(true);
    const actual = await readings(page);
    expect(actual.map((item) => item.ticker)).toEqual(symbols);
    for (const item of actual) {
      const prices = fixture(initial.market, item.ticker)
        .bars.slice(0, initial.cursor + 1)
        .map((bar) => bar.close);
      const last = prices.at(-1)!;
      const ratio = last / prices[0];
      const sample = prices.slice(-50);
      const mean =
        sample.reduce((sum, value) => sum + value, 0) / sample.length;
      const deviation = Math.sqrt(
        sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          sample.length,
      );
      const expected =
        mode === 'price'
          ? initial.market.bars[0].close * ratio
          : mode === 'percent'
            ? (ratio - 1) * 100
            : mode === 'indexed'
              ? ratio * 100
              : mode === 'ratio'
                ? ratio
                : mode === 'logReturn'
                  ? Math.log(ratio) * 100
                  : mode === 'zscore'
                    ? (last - mean) / deviation
                    : ((last - Math.min(...sample)) /
                        (Math.max(...sample) - Math.min(...sample))) *
                      100;
      expect(Number(item.lastLabel.replace(/[,%+]/g, ''))).toBeCloseTo(
        expected,
        mode === 'ratio' ? 3 : 1,
      );
      expect(item.lastTime).toBe(initial.market.bars[initial.cursor].time);
      expect(item.points).toBe(initial.cursor + 1);
    }
    if (mode !== 'price')
      await expect(page.getByTestId('chart-base-price')).toHaveAttribute(
        'data-value',
        String(basePrice),
      );
  }
  await page
    .getByRole('combobox', { name: 'Normalization', exact: true })
    .selectOption('percent');
  await page
    .getByRole('combobox', { name: 'Price scale', exact: true })
    .selectOption('log');
  await row(page, 'QQQ')
    .getByLabel('Benchmark color', { exact: true })
    .fill('#ff3344');
  await press(page.getByRole('button', { name: 'Next candle', exact: true }));
  await expect
    .poll(async () =>
      (await readings(page)).every(
        (item) =>
          item.lastTime === initial.market.bars[initial.cursor + 1].time,
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-comparison-count', '5');
  await expect(chart(page)).toHaveAttribute('data-chart-scale', 'log');
  await expect(
    row(page, 'QQQ').getByLabel('Benchmark color', { exact: true }),
  ).toHaveValue('#ff3344');
  expect(requested).toEqual(symbols);
  await press(
    row(page, 'DIA').getByRole('button', {
      name: 'Remove comparison',
      exact: true,
    }),
  );
  await expect(chart(page)).toHaveAttribute('data-comparison-count', '4');
  await expect(
    page.getByRole('button', { name: 'Compare', exact: true }),
  ).toBeEnabled();
  await press(page.getByRole('button', { name: 'Compare', exact: true }));
  await page
    .getByRole('textbox', { name: 'Benchmark ticker', exact: true })
    .fill('qqq');
  await press(
    page.getByRole('button', { name: 'Add comparison', exact: true }),
  );
  await expect(page.getByRole('alert')).toContainText('already on the chart');
  expect(requested).toEqual(symbols);
  await page
    .getByRole('textbox', { name: 'Benchmark ticker', exact: true })
    .fill('VTI');
  await press(
    page.getByRole('button', { name: 'Add comparison', exact: true }),
  );
  await expect(chart(page)).toHaveAttribute('data-comparison-count', '5');
  await expect(row(page, 'VTI')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect((await savedSession(page)).account.orders).toEqual(
    initial.account.orders,
  );
});

test('an unsuccessful comparison edit preserves the other tickers and an interval change reloads each one', async ({
  page,
  isMobile,
}) => {
  const press = (locator: Locator) =>
    isMobile ? locator.tap() : locator.click();
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  const initial = await savedSession(page);
  const intraday = {
    ...yahooFixture(),
    ticker: 'AAPL',
    name: 'Apple intraday',
  };
  const requests: string[] = [];
  await page.route('**/api/market-data?**', (route) => {
    const query = new URL(route.request().url()).searchParams;
    const ticker = query.get('ticker')!;
    requests.push(`${ticker}:${query.get('interval')}`);
    if (ticker === 'FAIL')
      return route.fulfill({
        status: 404,
        json: { detail: 'Ticker unavailable' },
      });
    if (ticker === 'AAPL') return route.fulfill({ json: intraday });
    return route.fulfill({
      json: fixture(
        query.get('interval') === '15m' ? intraday : initial.market,
        ticker,
      ),
    });
  });
  await add(page, 'SPY', press);
  await add(page, 'QQQ', press);
  const before = await readings(page);
  await press(
    row(page, 'QQQ').getByRole('button', {
      name: 'Edit comparison',
      exact: true,
    }),
  );
  await page
    .getByRole('textbox', { name: 'Benchmark ticker', exact: true })
    .fill('FAIL');
  await press(
    page.getByRole('button', { name: 'Update comparison', exact: true }),
  );
  await expect(page.getByRole('alert')).toContainText('Ticker unavailable');
  expect(await readings(page)).toEqual(before);
  await page
    .getByRole('textbox', { name: 'Benchmark ticker', exact: true })
    .fill('DIA');
  await press(
    page.getByRole('button', { name: 'Update comparison', exact: true }),
  );
  await expect(row(page, 'DIA')).toBeVisible();
  await expect(row(page, 'QQQ')).toHaveCount(0);
  await press(
    page.getByRole('button', { name: 'Load market data', exact: true }).last(),
  );
  await page
    .getByRole('combobox', { name: 'Candle interval', exact: true })
    .selectOption('15m');
  await press(
    page.getByRole('button', { name: 'Load & start replay', exact: true }),
  );
  await expect(chart(page)).toHaveAttribute('data-comparison-count', '2');
  await expect
    .poll(() => requests.includes('SPY:15m') && requests.includes('DIA:15m'))
    .toBe(true);
  await expect
    .poll(async () =>
      (await readings(page)).every(
        (item) => item.lastTime === intraday.bars[18].time,
      ),
    )
    .toBe(true);
  await press(
    row(page, 'SPY').getByRole('button', {
      name: 'Remove comparison',
      exact: true,
    }),
  );
  await expect(chart(page)).toHaveAttribute('data-comparison-count', '1');
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-comparison-count', '1');
  await expect(row(page, 'DIA')).toBeVisible();
  await expect(row(page, 'SPY')).toHaveCount(0);
});

test('concurrent comparison requests reject pending duplicates and do not close another ticker dialog', async ({
  page,
  isMobile,
}) => {
  const press = (locator: Locator) =>
    isMobile ? locator.tap() : locator.click();
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  const initial = await savedSession(page);
  let releaseSPY!: () => void;
  let releaseQQQ!: () => void;
  const spy = new Promise<void>((resolve) => {
    releaseSPY = resolve;
  });
  const qqq = new Promise<void>((resolve) => {
    releaseQQQ = resolve;
  });
  const requested: string[] = [];
  await page.route('**/api/market-data?**', async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get('ticker')!;
    requested.push(ticker);
    await (ticker === 'SPY' ? spy : qqq);
    await route.fulfill({ json: fixture(initial.market, ticker) });
  });
  try {
    await press(page.getByRole('button', { name: 'Compare', exact: true }));
    await press(
      page.getByRole('button', { name: 'Add comparison', exact: true }),
    );
    await expect.poll(() => requested).toEqual(['SPY']);
    await press(
      page.getByRole('button', { name: 'Close dialog', exact: true }),
    );
    await press(page.getByRole('button', { name: 'Compare', exact: true }));
    await page
      .getByRole('textbox', { name: 'Benchmark ticker', exact: true })
      .fill('SPY');
    await press(
      page.getByRole('button', { name: 'Add comparison', exact: true }),
    );
    await expect(page.getByRole('alert')).toContainText('already on the chart');
    expect(requested).toEqual(['SPY']);
    await page
      .getByRole('textbox', { name: 'Benchmark ticker', exact: true })
      .fill('QQQ');
    await press(
      page.getByRole('button', { name: 'Add comparison', exact: true }),
    );
    await expect.poll(() => requested).toEqual(['SPY', 'QQQ']);
    releaseSPY();
    await expect(chart(page)).toHaveAttribute('data-comparison-count', '1');
    await expect(
      page.getByRole('dialog', { name: 'Compare symbol', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Benchmark ticker', exact: true }),
    ).toHaveValue('QQQ');
    releaseQQQ();
    await expect(chart(page)).toHaveAttribute('data-comparison-count', '2');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await savedSession(page)).account.orders).toEqual(
      initial.account.orders,
    );
  } finally {
    releaseSPY();
    releaseQQQ();
  }
});

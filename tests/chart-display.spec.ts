import type { Page } from '@playwright/test';
import type { MarketData } from '../src/lib/data';
import {
  expect,
  openData,
  savedSession,
  test,
  yahooFixture,
} from './helpers/workspace';

const chart = (page: Page) =>
  page.getByRole('group', { name: 'Chart workspace', exact: true });
const display = (page: Page) =>
  page.getByRole('group', { name: 'Chart display', exact: true });
const normalization = (page: Page) =>
  page.getByRole('combobox', { name: 'Normalization', exact: true });
const scale = (page: Page) =>
  page.getByRole('combobox', { name: 'Price scale', exact: true });

async function loadBase(page: Page, fixture = yahooFixture()) {
  await page.route('**/api/market-data?**', (route) =>
    new URL(route.request().url()).searchParams.get('ticker') === fixture.ticker
      ? route.fulfill({ json: fixture })
      : route.fallback(),
  );
  await openData(page);
  await page
    .getByRole('textbox', { name: 'Ticker symbol', exact: true })
    .fill(fixture.ticker);
  await page
    .getByRole('combobox', { name: 'Candle interval', exact: true })
    .selectOption(fixture.interval);
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: /Microsoft Corporation/ }),
  ).toBeVisible();
}

async function mockBenchmark(page: Page) {
  const base = yahooFixture();
  const benchmark: MarketData = {
    ...base,
    ticker: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    bars: base.bars.map((bar, index) => ({
      ...bar,
      open: 299.5 + index,
      high: 301 + index,
      low: 299 + index,
      close: 300 + index,
    })),
  };
  await page.route('**/api/market-data?**', (route) =>
    new URL(route.request().url()).searchParams.get('ticker') === 'SPY'
      ? route.fulfill({ json: benchmark })
      : route.fallback(),
  );
}

async function addBenchmark(page: Page) {
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add comparison', exact: true })
    .click();
  await expect(
    page.getByRole('group', { name: 'Benchmark comparison', exact: true }),
  ).toBeVisible();
}

async function expectValue(page: Page, value: number) {
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId('chart-normalized-value')
          .getAttribute('data-value'),
      ),
    )
    .toBeCloseTo(value, 6);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(display(page)).toBeVisible();
});

for (const [mode, expected, label, expectedScale] of [
  ['price', 136.5, '136.50', 'linear'],
  ['percent', (136.5 / 100.5 - 1) * 100, '+35.82%', 'linear'],
  ['indexed', (136.5 / 100.5) * 100, '135.82', 'linear'],
  ['ratio', 136.5 / 100.5, '1.3582', 'linear'],
  [
    'logReturn',
    100 * Math.log(136.5 / 100.5),
    `+${(100 * Math.log(136.5 / 100.5)).toFixed(2)}%`,
    'log',
  ],
  ['zscore', 18 / Math.sqrt(120), '1.64', 'linear'],
  ['minmax', 100, '100.00', 'linear'],
] as const) {
  test(`standalone ${mode} normalization displays the independently calculated value and axis label`, async ({
    page,
  }) => {
    await loadBase(page);
    const before = await savedSession(page);
    await normalization(page).selectOption(mode);
    await expectValue(page, expected);
    await expect(chart(page)).toHaveAttribute('data-chart-normalization', mode);
    await expect(chart(page)).toHaveAttribute(
      'data-chart-scale',
      expectedScale,
    );
    await expect(chart(page)).toHaveAttribute('data-chart-base-label', label);
    await expect(chart(page)).toHaveAttribute(
      'data-chart-anchor',
      String(before.market.bars[0].time),
    );
    await expect(chart(page)).not.toHaveAttribute(
      'data-comparison-ticker',
      /.+/,
    );
    if (['zscore', 'minmax', 'logReturn'].includes(mode))
      await expect(scale(page)).toBeDisabled();
    else await expect(scale(page)).toBeEnabled();
    expect(await savedSession(page)).toEqual(before);
  });
}

for (const chartType of ['candles', 'line'] as const) {
  test(`a standalone ${chartType} chart supports logarithmic price scaling`, async ({
    page,
  }) => {
    await loadBase(page);
    if (chartType === 'line')
      await page
        .getByRole('button', { name: 'Switch to line chart', exact: true })
        .click();
    await expect(normalization(page)).toHaveValue('price');
    await scale(page).selectOption('log');
    await expect(chart(page)).toHaveAttribute('data-chart-scale', 'log');
    await expect(chart(page)).toHaveAttribute(
      'data-chart-base-label',
      '136.50',
    );
    await expectValue(page, 136.5);
    await expect(
      page.getByRole('img', { name: /Interactive historical price chart/ }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Next candle', exact: true })
      .click();
    await expectValue(page, 138.5);
    await expect(chart(page)).toHaveAttribute('data-chart-scale', 'log');
    await scale(page).selectOption('linear');
    await expect(chart(page)).toHaveAttribute('data-chart-scale', 'linear');
  });
}

test('statistical normalization recalibrates from only the selected trailing revealed window', async ({
  page,
}) => {
  const fixture = yahooFixture();
  fixture.bars = fixture.bars.map((bar, index) => {
    if (index < 19) return bar;
    const close = index === 19 ? 120 : 10_000 + index;
    return { ...bar, open: close, high: close + 1, low: close - 1, close };
  });
  await loadBase(page, fixture);
  await normalization(page).selectOption('zscore');
  await expectValue(page, 18 / Math.sqrt(120));
  await expect(chart(page)).toHaveAttribute('data-chart-sample-count', '19');
  await page
    .getByRole('spinbutton', { name: 'Normalization window', exact: true })
    .fill('3');
  await page.getByRole('button', { name: 'Apply window', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-chart-sample-count', '3');
  await expectValue(page, 2 / Math.sqrt(8 / 3));
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  const values = [134.5, 136.5, 120];
  const mean = values.reduce((sum, value) => sum + value, 0) / 3;
  const deviation = Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 3,
  );
  await expectValue(page, (120 - mean) / deviation);
  await normalization(page).selectOption('minmax');
  await expectValue(page, 0);
  await expect(chart(page)).toHaveAttribute('data-chart-sample-count', '3');
  await page
    .getByRole('slider', { name: 'Replay timeline', exact: true })
    .focus();
  await page.keyboard.press('Home');
  await page
    .getByRole('button', { name: 'Reset account & replay', exact: true })
    .click();
  await expect(normalization(page)).toHaveValue('minmax');
  await expect(chart(page)).toHaveAttribute(
    'data-chart-normalization',
    'price',
  );
  await expect(chart(page)).toHaveAttribute('data-chart-scale', 'linear');
  await expect(chart(page)).toHaveAttribute('data-chart-sample-count', '1');
  await expect(display(page)).toContainText(/warming|two|2|variation/i);
  await expectValue(page, 100.5);
});

test('normalization window rejects out-of-range and fractional sizes before applying a valid window', async ({
  page,
}) => {
  await loadBase(page);
  await normalization(page).selectOption('zscore');
  const input = page.getByRole('spinbutton', {
    name: 'Normalization window',
    exact: true,
  });
  await expect(input).toHaveValue('50');
  for (const value of ['1', '501', '2.5']) {
    await input.fill(value);
    await expect(
      page.getByRole('button', { name: 'Apply window', exact: true }),
    ).toBeDisabled();
    await input.press('Enter');
    await expect
      .poll(() =>
        input.evaluate((element: HTMLInputElement) => element.validity.valid),
      )
      .toBe(false);
    await expect(chart(page)).toHaveAttribute('data-chart-sample-count', '19');
  }
  await input.fill('5');
  await page.getByRole('button', { name: 'Apply window', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-chart-sample-count', '5');
  await expectValue(page, 4 / Math.sqrt(8));
  await page.reload();
  await expect(normalization(page)).toHaveValue('zscore');
  await expect(input).toHaveValue('5');
  await expect(chart(page)).toHaveAttribute('data-chart-sample-count', '5');
});

test('benchmark statistical windows use only exact shared timestamps while the base readout tracks its current candle', async ({
  page,
}) => {
  const fixture = yahooFixture();
  await loadBase(page, fixture);
  const benchmark: MarketData = {
    ...fixture,
    ticker: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    bars: fixture.bars
      .map((bar, index) => ({
        ...bar,
        open: 299.5 + index,
        high: 301 + index,
        low: 299 + index,
        close: 300 + index,
      }))
      .filter((_, index) => [1, 5, 10, 19, 30, 59].includes(index)),
  };
  await page.route('**/api/market-data?**', (route) =>
    new URL(route.request().url()).searchParams.get('ticker') === 'SPY'
      ? route.fulfill({ json: benchmark })
      : route.fallback(),
  );
  await addBenchmark(page);
  await normalization(page).selectOption('zscore');
  const shared = [102.5, 110.5, 120.5];
  const mean = shared.reduce((sum, value) => sum + value, 0) / 3;
  const deviation = Math.sqrt(
    shared.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 3,
  );
  await expectValue(page, (136.5 - mean) / deviation);
  await expect(chart(page)).toHaveAttribute('data-chart-sample-count', '3');
  await expect(display(page)).toContainText('3 revealed shared closes used');
  await expect(chart(page)).toHaveAttribute(
    'data-comparison-last-time',
    String(fixture.bars[10].time),
  );
  await page
    .getByRole('spinbutton', { name: 'Normalization window', exact: true })
    .fill('2');
  await page.getByRole('button', { name: 'Apply window', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-chart-sample-count', '2');
  await expectValue(page, 4.2);
  await expect(chart(page)).toHaveAttribute(
    'data-comparison-last-label',
    '1.00',
  );
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId('base-comparison-return')
          .getAttribute('data-value'),
      ),
    )
    .toBeCloseTo((120.5 / 102.5 - 1) * 100, 6);
});

test('flat prices show a statistical warm-up explanation and a usable linear price chart', async ({
  page,
}) => {
  const fixture = yahooFixture();
  fixture.bars = fixture.bars.map((bar) => ({
    ...bar,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
  await loadBase(page, fixture);
  for (const mode of ['zscore', 'minmax']) {
    await normalization(page).selectOption(mode);
    await expect(normalization(page)).toHaveValue(mode);
    await expect(chart(page)).toHaveAttribute(
      'data-chart-normalization',
      'price',
    );
    await expect(chart(page)).toHaveAttribute('data-chart-scale', 'linear');
    await expect(display(page)).toContainText(
      /flat|variation|constant|warming|zero.range/i,
    );
    await expectValue(page, 100);
    await expect(scale(page)).toBeDisabled();
    await expect(
      page.getByRole('img', { name: /Interactive historical price chart/ }),
    ).toBeVisible();
  }
});

test('user display choices survive benchmark addition and removal, replay, reload, and a base-market change', async ({
  page,
}) => {
  await loadBase(page);
  await mockBenchmark(page);
  await normalization(page).selectOption('ratio');
  await scale(page).selectOption('log');
  await addBenchmark(page);
  await expect(normalization(page)).toHaveValue('ratio');
  await expect(scale(page)).toHaveValue('log');
  await page
    .getByRole('button', { name: 'Remove comparison', exact: true })
    .click();
  await expect(
    page.getByRole('group', { name: 'Benchmark comparison', exact: true }),
  ).toHaveCount(0);
  await expect(display(page)).toBeVisible();
  await expect(normalization(page)).toHaveValue('ratio');
  await expect(scale(page)).toHaveValue('log');
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await expectValue(page, 138.5 / 100.5);
  await page.reload();
  await expect(normalization(page)).toHaveValue('ratio');
  await expect(scale(page)).toHaveValue('log');
  await openData(page);
  await page
    .getByRole('button', { name: 'Explore with synthetic sample data' })
    .click();
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  await expect(normalization(page)).toHaveValue('ratio');
  await expect(scale(page)).toHaveValue('log');
  const session = await savedSession(page);
  await expectValue(
    page,
    session.market.bars[session.cursor].close / session.market.bars[0].close,
  );
});

test('active legacy benchmark display preferences migrate into the global chart controls', async ({
  page,
}) => {
  await loadBase(page);
  await mockBenchmark(page);
  await page.evaluate(() => {
    localStorage.removeItem('replay-chart-display:v1');
    localStorage.setItem(
      'replay-benchmark:v1',
      JSON.stringify({
        ticker: 'SPY',
        normalization: 'indexed',
        scale: 'log',
        color: '#f0b86e',
        cache: null,
      }),
    );
  });
  await page.reload();
  await expect(normalization(page)).toHaveValue('indexed');
  await expect(scale(page)).toHaveValue('log');
  await expect(chart(page)).toHaveAttribute('data-comparison-ticker', 'SPY');
  await expect(chart(page)).toHaveAttribute(
    'data-chart-normalization',
    'indexed',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(localStorage.getItem('replay-chart-display:v1')),
      ),
    )
    .toBe(true);
  await page
    .getByRole('button', { name: 'Remove comparison', exact: true })
    .click();
  await page.reload();
  await expect(normalization(page)).toHaveValue('indexed');
  await expect(scale(page)).toHaveValue('log');
});

test('normalization and scale changes preserve open trades, indicators, and raw-price drawing anchors', async ({
  page,
}) => {
  await loadBase(page);
  await page.getByRole('button', { name: /^Buy MSFT/ }).click();
  await page.getByRole('button', { name: 'Indicators', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add Relative Strength Index', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page
    .getByRole('button', { name: 'Horizontal line', exact: true })
    .click();
  await page.getByTestId('drawing-surface').scrollIntoViewIfNeeded();
  const surface = await page.getByTestId('drawing-surface').boundingBox();
  await page.mouse.click(
    surface!.x + surface!.width * 0.4,
    surface!.y + surface!.height * 0.4,
  );
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(1);
  const before = await savedSession(page);
  const preferences = await page.evaluate(() =>
    localStorage.getItem('replay-chart-workspace:v1'),
  );
  await normalization(page).selectOption('zscore');
  await expect(chart(page)).toHaveAttribute(
    'data-chart-normalization',
    'zscore',
  );
  await normalization(page).selectOption('ratio');
  await scale(page).selectOption('log');
  await expect(chart(page)).toHaveAttribute('data-chart-scale', 'log');
  await expect(page.getByText('LONG', { exact: true })).toBeVisible();
  await expect(page.getByTestId('indicator-chip')).toContainText('RSI');
  await expect(chart(page)).toHaveAttribute('data-indicator-panes', '1');
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(1);
  expect(await savedSession(page)).toEqual(before);
  expect(
    await page.evaluate(() =>
      localStorage.getItem('replay-chart-workspace:v1'),
    ),
  ).toBe(preferences);
  await page
    .getByRole('button', { name: 'Close position', exact: true })
    .click();
  await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
});

test('the global display controls remain usable at a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadBase(page);
  await expect(display(page)).toBeVisible();
  await normalization(page).selectOption('zscore');
  await page
    .getByRole('spinbutton', { name: 'Normalization window', exact: true })
    .fill('5');
  await page.getByRole('button', { name: 'Apply window', exact: true }).click();
  await expectValue(page, 4 / Math.sqrt(8));
  // A fixed mobile panel height used to clip playback below longer statistical
  // controls. Check the real geometry before Playwright can scroll hidden content.
  const panel = await page.locator('.chart-panel').boundingBox();
  const playback = await page.locator('.replay-controls').boundingBox();
  expect(playback!.y + playback!.height).toBeLessThanOrEqual(
    panel!.y + panel!.height + 1,
  );
  const cursor = (await savedSession(page)).cursor;
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await expect
    .poll(async () => (await savedSession(page)).cursor)
    .toBe(cursor + 1);
  await normalization(page).selectOption('price');
  await scale(page).selectOption('log');
  await expect(chart(page)).toHaveAttribute('data-chart-scale', 'log');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

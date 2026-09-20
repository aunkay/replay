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
const comparison = (page: Page) =>
  page.getByRole('group', { name: 'Benchmark comparison', exact: true });

function benchmarkFixture(base = yahooFixture()): MarketData {
  return {
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
}

async function loadBase(page: Page, fixture = yahooFixture()) {
  await page.route('**/api/market-data?**', (route) => {
    const ticker = new URL(route.request().url()).searchParams.get('ticker');
    return ticker === fixture.ticker
      ? route.fulfill({ json: fixture })
      : route.fallback();
  });
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
    page.getByRole('heading', { name: new RegExp(fixture.name) }),
  ).toBeVisible();
}

async function mockBenchmark(page: Page, fixture = benchmarkFixture()) {
  await page.route('**/api/market-data?**', (route) =>
    new URL(route.request().url()).searchParams.get('ticker') === 'SPY'
      ? route.fulfill({ json: fixture })
      : route.fallback(),
  );
}

async function openComparison(page: Page) {
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Compare symbol', exact: true }),
  ).toBeVisible();
}

async function addComparison(page: Page) {
  await openComparison(page);
  await expect(
    page.getByRole('textbox', { name: 'Benchmark ticker', exact: true }),
  ).toHaveValue('SPY');
  await page
    .getByRole('button', { name: 'Add comparison', exact: true })
    .click();
  await expect(comparison(page)).toBeVisible();
  await expect(chart(page)).toHaveAttribute('data-comparison-ticker', 'SPY');
}

async function expectReturns(page: Page, base: number, benchmark: number) {
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId('base-comparison-return')
          .getAttribute('data-value'),
      ),
    )
    .toBeCloseTo(base, 6);
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId('benchmark-comparison-return')
          .getAttribute('data-value'),
      ),
    )
    .toBeCloseTo(benchmark, 6);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
});

test('SPY comparison loads the matching interval and complete date window without changing the trading account', async ({
  page,
}) => {
  const base = yahooFixture();
  await loadBase(page, base);
  await mockBenchmark(page);
  await page.getByRole('button', { name: /^Buy MSFT/ }).click();
  await expect(page.getByText('LONG', { exact: true })).toBeVisible();
  const before = await savedSession(page);
  const requested = page.waitForRequest(
    (request) =>
      request.url().includes('/api/market-data?') &&
      new URL(request.url()).searchParams.get('ticker') === 'SPY',
  );
  await addComparison(page);
  const params = new URL((await requested).url()).searchParams;
  expect(params.get('interval')).toBe('15m');
  expect(params.get('period')).toBeNull();
  expect(Date.parse(params.get('start')!) / 1000).toBeLessThanOrEqual(
    base.bars[0].time,
  );
  expect(Date.parse(params.get('end')!) / 1000).toBeGreaterThan(
    base.bars.at(-1)!.time,
  );
  await expect(chart(page)).toHaveAttribute('data-comparison-points', '19');
  await expect(chart(page)).toHaveAttribute(
    'data-comparison-last-time',
    String(base.bars[18].time),
  );
  await expectReturns(page, (136.5 / 100.5 - 1) * 100, 6);
  await expect(comparison(page)).toContainText('SPY');
  expect(await savedSession(page)).toEqual(before);
});

test('normalization and logarithmic scale controls update the comparison without changing its returns', async ({
  page,
}) => {
  await loadBase(page);
  await mockBenchmark(page);
  await addComparison(page);
  const before = await savedSession(page);
  for (const mode of ['indexed', 'price', 'percent']) {
    await page
      .getByRole('combobox', { name: 'Normalization', exact: true })
      .selectOption(mode);
    await expect(chart(page)).toHaveAttribute(
      'data-comparison-normalization',
      mode,
    );
    await expect(chart(page)).toHaveAttribute(
      'data-comparison-last-label',
      {
        indexed: '106.00',
        price: '106.53',
        percent: '+6.00%',
      }[mode]!,
    );
    await expect(chart(page)).toHaveAttribute(
      'data-comparison-base-label',
      {
        indexed: '136.50 · 135.82',
        price: '136.50',
        percent: '136.50 · +35.82%',
      }[mode]!,
    );
    await expectReturns(page, (136.5 / 100.5 - 1) * 100, 6);
  }
  await page
    .getByRole('combobox', { name: 'Price scale', exact: true })
    .selectOption('log');
  await expect(chart(page)).toHaveAttribute('data-comparison-scale', 'log');
  await expect(chart(page)).toHaveAttribute('data-comparison-points', '19');
  await page
    .getByRole('combobox', { name: 'Price scale', exact: true })
    .selectOption('linear');
  await expect(chart(page)).toHaveAttribute('data-comparison-scale', 'linear');
  expect(await savedSession(page)).toEqual(before);
});

test('comparison reveals only replayed candles and rewinds its returns to the shared starting point', async ({
  page,
}) => {
  const base = yahooFixture();
  await loadBase(page, base);
  await mockBenchmark(page);
  await addComparison(page);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-comparison-points', '20');
  await expect(chart(page)).toHaveAttribute(
    'data-comparison-last-time',
    String(base.bars[19].time),
  );
  await expectReturns(page, (138.5 / 100.5 - 1) * 100, (319 / 300 - 1) * 100);
  await page
    .getByRole('slider', { name: 'Replay timeline', exact: true })
    .focus();
  await page.keyboard.press('Home');
  await page
    .getByRole('button', { name: 'Reset account & replay', exact: true })
    .click();
  await expect(chart(page)).toHaveAttribute('data-comparison-points', '1');
  await expect(chart(page)).toHaveAttribute(
    'data-comparison-last-time',
    String(base.bars[0].time),
  );
  await expectReturns(page, 0, 0);
});

test('sparse benchmark candles align only at exact timestamps and returns share the same horizon', async ({
  page,
}) => {
  const base = yahooFixture();
  const benchmark = benchmarkFixture(base);
  benchmark.bars = benchmark.bars.filter((_, index) =>
    [1, 5, 10, 19, 30, 59].includes(index),
  );
  await loadBase(page, base);
  await mockBenchmark(page, benchmark);
  await addComparison(page);
  await expect(chart(page)).toHaveAttribute('data-comparison-points', '3');
  await expect(chart(page)).toHaveAttribute(
    'data-comparison-last-time',
    String(base.bars[10].time),
  );
  await expectReturns(page, (120.5 / 102.5 - 1) * 100, (310 / 301 - 1) * 100);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-comparison-points', '4');
  await expect(chart(page)).toHaveAttribute(
    'data-comparison-last-time',
    String(base.bars[19].time),
  );
  await expectReturns(page, (138.5 / 102.5 - 1) * 100, (319 / 301 - 1) * 100);
  await expect(page.getByTestId('comparison-anchor')).toHaveAttribute(
    'data-time',
    String(base.bars[1].time),
  );
  await page
    .getByRole('slider', { name: 'Replay timeline', exact: true })
    .focus();
  await page.keyboard.press('Home');
  await page
    .getByRole('button', { name: 'Reset account & replay', exact: true })
    .click();
  await expect(chart(page)).toHaveAttribute('data-comparison-points', '0');
  await expect(chart(page)).not.toHaveAttribute(
    'data-comparison-last-time',
    /.+/,
  );
  await expect(page.getByTestId('comparison-anchor')).toHaveCount(0);
  await expect(page.getByTestId('benchmark-comparison-return')).toHaveCount(0);
  await expect(comparison(page)).toContainText(
    'Waiting for the first shared candle',
  );
});

test('comparison ticker and display settings survive reload and removal stays removed', async ({
  page,
}) => {
  await loadBase(page);
  await mockBenchmark(page);
  await addComparison(page);
  await page
    .getByRole('combobox', { name: 'Normalization', exact: true })
    .selectOption('indexed');
  await page
    .getByRole('combobox', { name: 'Price scale', exact: true })
    .selectOption('log');
  const before = await savedSession(page);
  await page.reload();
  await expect(comparison(page)).toBeVisible();
  await expect(chart(page)).toHaveAttribute('data-comparison-ticker', 'SPY');
  await expect(
    page.getByRole('combobox', { name: 'Normalization', exact: true }),
  ).toHaveValue('indexed');
  await expect(
    page.getByRole('combobox', { name: 'Price scale', exact: true }),
  ).toHaveValue('log');
  expect(await savedSession(page)).toEqual(before);
  await page
    .getByRole('button', { name: 'Remove comparison', exact: true })
    .click();
  await expect(comparison(page)).toHaveCount(0);
  await expect(chart(page)).not.toHaveAttribute(
    'data-comparison-ticker',
    'SPY',
  );
  await page.reload();
  await expect(comparison(page)).toHaveCount(0);
  expect(await savedSession(page)).toEqual(before);
});

test('comparison coexists with an oscillator and editable drawings without altering their saved state', async ({
  page,
}) => {
  await loadBase(page);
  await mockBenchmark(page);
  await page.getByRole('button', { name: 'Indicators', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add Relative Strength Index', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page
    .getByRole('button', { name: 'Horizontal line', exact: true })
    .click();
  const surface = await page.getByTestId('drawing-surface').boundingBox();
  await page.mouse.click(
    surface!.x + surface!.width * 0.4,
    surface!.y + surface!.height * 0.4,
  );
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(1);
  const preferences = await page.evaluate(() =>
    localStorage.getItem('replay-chart-workspace:v1'),
  );
  const session = await savedSession(page);
  await addComparison(page);
  await expect(chart(page)).toHaveAttribute('data-indicator-panes', '1');
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(1);
  await expect(page.getByTestId('indicator-chip')).toContainText('RSI');
  expect(
    await page.evaluate(() =>
      localStorage.getItem('replay-chart-workspace:v1'),
    ),
  ).toBe(preferences);
  expect(await savedSession(page)).toEqual(session);
  await page
    .getByRole('button', { name: 'Remove comparison', exact: true })
    .click();
  await expect(chart(page)).toHaveAttribute('data-indicator-panes', '1');
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem('replay-chart-workspace:v1'),
    ),
  ).toBe(preferences);
});

test('failed benchmark requests preserve the account and the dialog supports retrying', async ({
  page,
}) => {
  await loadBase(page);
  let requests = 0;
  await page.route('**/api/market-data?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('ticker') !== 'SPY')
      return route.fallback();
    requests += 1;
    return requests === 1
      ? route.abort('failed')
      : route.fulfill({ json: benchmarkFixture() });
  });
  const before = await savedSession(page);
  await openComparison(page);
  await page
    .getByRole('button', { name: 'Add comparison', exact: true })
    .click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add comparison', exact: true }),
  ).toBeEnabled();
  expect(await savedSession(page)).toEqual(before);
  await page
    .getByRole('button', { name: 'Add comparison', exact: true })
    .click();
  await expect(comparison(page)).toBeVisible();
  await expect(chart(page)).toHaveAttribute('data-comparison-ticker', 'SPY');
  expect(requests).toBe(2);
});

test('a benchmark with no shared historical timestamps is rejected without replacing the base market', async ({
  page,
}) => {
  await loadBase(page);
  const shifted = benchmarkFixture();
  shifted.bars = shifted.bars.map((bar) => ({
    ...bar,
    time: bar.time + 365 * 86400,
  }));
  await mockBenchmark(page, shifted);
  const before = await savedSession(page);
  await openComparison(page);
  await page
    .getByRole('button', { name: 'Add comparison', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    /overlap|shared|matching|aligned/i,
  );
  await expect(comparison(page)).toHaveCount(0);
  expect(await savedSession(page)).toEqual(before);
});

test('an unsuccessful benchmark edit retains the last comparison and a retry replaces only its symbol', async ({
  page,
}) => {
  await loadBase(page);
  await mockBenchmark(page);
  await addComparison(page);
  await page
    .getByRole('combobox', { name: 'Normalization', exact: true })
    .selectOption('indexed');
  const before = await savedSession(page);
  let requests = 0;
  const replacement = {
    ...benchmarkFixture(),
    ticker: 'QQQ',
    name: 'Invesco QQQ Trust',
  };
  await page.route('**/api/market-data?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('ticker') !== 'QQQ')
      return route.fallback();
    requests += 1;
    return requests === 1
      ? route.fulfill({
          status: 422,
          json: { detail: 'Requested benchmark is temporarily unavailable.' },
        })
      : route.fulfill({ json: replacement });
  });
  await page
    .getByRole('button', { name: 'Edit comparison', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Benchmark ticker', exact: true })
    .fill('QQQ');
  await page
    .getByRole('button', { name: 'Update comparison', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'temporarily unavailable',
  );
  await expect(chart(page)).toHaveAttribute('data-comparison-ticker', 'SPY');
  expect(await savedSession(page)).toEqual(before);
  await page
    .getByRole('button', { name: 'Update comparison', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(chart(page)).toHaveAttribute('data-comparison-ticker', 'QQQ');
  await expect(comparison(page)).toContainText('QQQ');
  await expect(
    page.getByRole('combobox', { name: 'Normalization', exact: true }),
  ).toHaveValue('indexed');
  expect(await savedSession(page)).toEqual(before);
});

test('changing the base interval refetches the benchmark and removing it ignores an older pending response', async ({
  page,
}) => {
  const base = yahooFixture();
  await loadBase(page, base);
  await mockBenchmark(page);
  await addComparison(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const daily: MarketData = {
    ...base,
    interval: '1d',
    bars: base.bars.map((bar, index) => ({
      ...bar,
      time: Date.parse('2025-01-06T00:00:00Z') / 1000 + index * 86400,
    })),
  };
  await page.route('**/api/market-data?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('interval') !== '1d') return route.fallback();
    if (params.get('ticker') === 'MSFT') return route.fulfill({ json: daily });
    if (params.get('ticker') !== 'SPY') return route.fallback();
    await gate;
    return route.fulfill({ json: benchmarkFixture(daily) });
  });
  const requested = page.waitForRequest((request) => {
    if (!request.url().includes('/api/market-data?')) return false;
    const params = new URL(request.url()).searchParams;
    return params.get('ticker') === 'SPY' && params.get('interval') === '1d';
  });
  await page.getByRole('button', { name: '1D', exact: true }).click();
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  const pending = await requested;
  const params = new URL(pending.url()).searchParams;
  expect(Date.parse(params.get('start')!) / 1000).toBeLessThanOrEqual(
    daily.bars[0].time,
  );
  expect(Date.parse(params.get('end')!) / 1000).toBeGreaterThan(
    daily.bars.at(-1)!.time,
  );
  const returned = Promise.race([
    page
      .waitForResponse((response) => response.request() === pending)
      .then((response) => response.finished()),
    page.waitForEvent('requestfailed', {
      predicate: (request) => request === pending,
    }),
  ]);
  try {
    await page
      .getByRole('button', { name: 'Remove comparison', exact: true })
      .click();
    await expect(comparison(page)).toHaveCount(0);
  } finally {
    release();
  }
  await returned;
  // Allow the completed fetch and React render to settle before checking that
  // the cancelled generation did not restore an obsolete comparison.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(comparison(page)).toHaveCount(0);
  await expect(chart(page)).not.toHaveAttribute(
    'data-comparison-ticker',
    'SPY',
  );
  expect((await savedSession(page)).market.interval).toBe('1d');
  await page.reload();
  await expect(comparison(page)).toHaveCount(0);
});

test('changing the base market during the first benchmark request leaves comparison controls ready for a new request', async ({
  page,
}) => {
  const base = yahooFixture();
  await loadBase(page, base);
  const daily: MarketData = {
    ...base,
    interval: '1d',
    bars: base.bars.map((bar, index) => ({
      ...bar,
      time: Date.parse('2025-01-06T00:00:00Z') / 1000 + index * 86400,
    })),
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/market-data?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('ticker') === 'MSFT' && params.get('interval') === '1d')
      return route.fulfill({ json: daily });
    if (params.get('ticker') !== 'SPY') return route.fallback();
    if (params.get('interval') === '15m') {
      await gate;
      return route.fulfill({ json: benchmarkFixture(base) });
    }
    return route.fulfill({ json: benchmarkFixture(daily) });
  });
  await openComparison(page);
  const pendingEvent = page.waitForRequest(
    (request) =>
      request.url().includes('/api/market-data?') &&
      new URL(request.url()).searchParams.get('ticker') === 'SPY',
  );
  await page
    .getByRole('button', { name: 'Add comparison', exact: true })
    .click();
  const pending = await pendingEvent;
  const settled = Promise.race([
    page
      .waitForResponse((response) => response.request() === pending)
      .then((response) => response.finished()),
    page.waitForEvent('requestfailed', {
      predicate: (request) => request === pending,
    }),
  ]);
  try {
    await expect(
      page.getByRole('button', { name: 'Loading benchmark…', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await page.getByRole('button', { name: '1D', exact: true }).click();
    await page
      .getByRole('button', { name: 'Load & start replay', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await openComparison(page);
    await expect(
      page.getByRole('textbox', { name: 'Benchmark ticker', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Add comparison', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Add comparison', exact: true })
      .click();
    await expect(chart(page)).toHaveAttribute('data-comparison-ticker', 'SPY');
    await expect(chart(page)).toHaveAttribute(
      'data-comparison-last-time',
      String(daily.bars[18].time),
    );
  } finally {
    release();
  }
  await settled;
  await expect(chart(page)).toHaveAttribute(
    'data-comparison-last-time',
    String(daily.bars[18].time),
  );
});

test('full stack: comparison prices load through the API and preserve the traded base symbol', async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'Requires the isolated deterministic API server.',
  );
  await openData(page);
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  const before = await savedSession(page);
  const responseEvent = page.waitForResponse(
    (response) =>
      response.url().includes('/api/market-data?') &&
      new URL(response.url()).searchParams.get('ticker') === 'SPY',
  );
  await addComparison(page);
  const response = await responseEvent;
  expect(response.status()).toBe(200);
  expect((await response.json()).ticker).toBe('SPY');
  await expectReturns(page, (137 / 101 - 1) * 100, (537 / 501 - 1) * 100);
  expect(await savedSession(page)).toEqual(before);
});

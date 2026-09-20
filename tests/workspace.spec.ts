import {
  buy,
  dollars,
  expect,
  openData,
  savedSession,
  test,
  yahooFixture,
} from './helpers/workspace';

const STORAGE_KEY = 'replay-market-lab:v1';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Market replay/ }),
  ).toBeVisible();
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedSession(page))?.market.ticker)
    .toBe('AAPL');
});

for (const damage of ['invalid JSON', 'invalid account'] as const) {
  test(`a saved session with ${damage} recovers to a usable fresh account`, async ({
    page,
  }) => {
    await buy(page, 25);
    await page
      .getByRole('button', { name: 'Next candle', exact: true })
      .click();
    const session = await savedSession(page);
    const corrupted =
      damage === 'invalid JSON'
        ? '{"market":'
        : JSON.stringify({
            ...session,
            account: { ...session.account, cash: 'broken' },
          });
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: STORAGE_KEY,
      value: corrupted,
    });

    await page.reload();

    await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
    await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
    await expect(
      page
        .locator('.metric')
        .filter({ hasText: 'Account equity' })
        .locator('strong'),
    ).toHaveText('$100,000.00');
    await expect(
      page.getByText('Saved locally', { exact: true }),
    ).toBeVisible();
    const recovered = await savedSession(page);
    expect(recovered.account.orders).toEqual([]);
    expect(recovered.account.position.quantity).toBe(0);
    expect(recovered.cursor).toBe(recovered.startCursor);
    expect(recovered.account.cash).toBe(100_000);

    await buy(page, 1);
    await page
      .getByRole('button', { name: 'Next candle', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Close position', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Trade history', exact: true })
      .click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });
}

test('a browser storage quota failure is visible while trading and replay continue', async ({
  page,
}) => {
  const initial = await savedSession(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException(
        'The quota has been exceeded.',
        'QuotaExceededError',
      );
    };
  });

  await buy(page, 1);
  await expect(
    page.getByText('Storage unavailable', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue(String(initial.cursor + 1));
  await page
    .getByRole('button', { name: 'Close position', exact: true })
    .click();

  await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
  const entry = initial.market.bars[initial.cursor].close * 1.0001;
  const exit = initial.market.bars[initial.cursor + 1].close * 0.9999;
  const finalEquity = 100_000 + exit - entry - (entry + exit) * 0.0001;
  await expect(
    page
      .locator('.metric')
      .filter({ hasText: 'Account equity' })
      .locator('strong'),
  ).toHaveText(dollars(finalEquity));
  await page
    .getByRole('button', { name: 'Trade history', exact: true })
    .click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(
    page.getByText('Storage unavailable', { exact: true }),
  ).toBeVisible();
  expect(await savedSession(page)).toEqual(initial);
});

test('data dialog traps keyboard focus and Escape returns it to its opener', async ({
  page,
}) => {
  const opener = page
    .getByRole('button', { name: 'Load market data', exact: true })
    .last();
  await openData(page);
  const close = page.getByRole('button', { name: 'Close dialog', exact: true });
  const last = page.getByRole('button', {
    name: 'Explore with synthetic sample data',
  });
  await expect(close).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('textbox', { name: 'Ticker symbol', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Find your market.' }),
  ).toBeVisible();
});

test('chart type, moving average, and volume controls redraw without changing the account or candle', async ({
  page,
}) => {
  await buy(page);
  const before = await savedSession(page);
  const chart = page.getByRole('img', {
    name: /Interactive historical price chart/,
  });
  await expect(chart).toBeVisible();
  const candles = await chart.screenshot();

  await page
    .getByRole('button', { name: 'Switch to line chart', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Switch to candlestick chart',
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(async () => (await chart.screenshot()).equals(candles))
    .toBe(false);
  const line = await chart.screenshot();

  await page.getByRole('button', { name: 'Indicators', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add Simple Moving Average', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('.indicator-legend')).toContainText('SMA (20)');
  await expect
    .poll(async () => (await chart.screenshot()).equals(line))
    .toBe(false);
  const withAverage = await chart.screenshot();
  const volume = page.getByRole('button', {
    name: 'Toggle volume',
    exact: true,
  });
  await volume.click();
  await expect(volume).not.toHaveClass(/active/);
  await expect
    .poll(async () => (await chart.screenshot()).equals(withAverage))
    .toBe(false);

  await page
    .getByRole('button', { name: 'Switch to candlestick chart', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Remove Simple Moving Average (20)',
      exact: true,
    })
    .click();
  await volume.click();
  await expect(volume).toHaveClass(/active/);
  await expect(page.getByTestId('indicator-chip')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Switch to line chart', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue(String(before.cursor));
  await expect(page.getByText('LONG', { exact: true })).toBeVisible();
  expect(await savedSession(page)).toEqual(before);
});

test('quick market and interval selection populate appropriate history defaults', async ({
  page,
}) => {
  const before = await savedSession(page);
  await page
    .locator('.watchlist')
    .getByRole('button', { name: /MSFT/ })
    .click();
  const ticker = page.getByRole('textbox', {
    name: 'Ticker symbol',
    exact: true,
  });
  const interval = page.getByRole('combobox', {
    name: 'Candle interval',
    exact: true,
  });
  const range = page.getByRole('combobox', {
    name: 'History range',
    exact: true,
  });
  await expect(ticker).toHaveValue('MSFT');
  await expect(interval).toHaveValue('1d');
  await expect(range).toHaveValue('1y');

  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'BTC-USD', exact: true })
    .click();
  await expect(ticker).toHaveValue('BTC-USD');
  await interval.selectOption('1m');
  await expect(range).toHaveValue('5d');
  await expect(page.getByRole('dialog')).toContainText('7-day window');
  await interval.selectOption('60m');
  await expect(range).toHaveValue('3mo');
  await expect(page.getByRole('dialog')).toContainText('730 days');
  await interval.selectOption('1wk');
  await expect(range).toHaveValue('1y');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '5m', exact: true }).click();
  await expect(ticker).toHaveValue('AAPL');
  await expect(interval).toHaveValue('5m');
  await expect(range).toHaveValue('1mo');
  await expect(page.getByRole('dialog')).toContainText('last 60 days');
  await page.keyboard.press('Escape');
  expect(await savedSession(page)).toEqual(before);
});

test('a pending history request disables repeat submission and prevents closing the dialog', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/market-data?**', async (route) => {
    requests += 1;
    await gate;
    await route.fulfill({ json: yahooFixture() });
  });
  await openData(page);
  const requested = page.waitForRequest('**/api/market-data?**');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await requested;
  try {
    await expect(
      page.getByRole('button', {
        name: 'Fetching market history…',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Close dialog', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Explore with synthetic sample data' }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Find your market.' }),
    ).toBeVisible();
    await page.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(
      page.getByRole('dialog', { name: 'Find your market.' }),
    ).toBeVisible();
    expect(requests).toBe(1);
  } finally {
    release();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Microsoft Corporation/ }),
  ).toBeVisible();
});

test('a network failure keeps the trading session and allows a successful retry', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/market-data?**', (route) => {
    requests += 1;
    return requests === 1
      ? route.abort('failed')
      : route.fulfill({ json: yahooFixture() });
  });
  await buy(page, 25);
  const before = await savedSession(page);
  await openData(page);
  await page
    .getByRole('textbox', { name: 'Ticker symbol', exact: true })
    .fill('MSFT');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(/fetch|network/i);
  await expect(
    page.getByRole('button', { name: 'Load & start replay', exact: true }),
  ).toBeEnabled();
  expect(await savedSession(page)).toEqual(before);

  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
  await expect(page.locator('.instrument-price')).toContainText('$136.50');
  expect(requests).toBe(2);
  const after = await savedSession(page);
  expect(after.market.ticker).toBe('MSFT');
  expect(after.account.orders).toEqual([]);
  expect(after.account.cash).toBe(100_000);
});

for (const currency of [null, 'GBp'] as const) {
  test(`${currency ?? 'unavailable currency'} preserves quote units and small-price precision`, async ({
    page,
  }) => {
    const fixture = yahooFixture();
    fixture.currency = currency;
    fixture.bars = fixture.bars.map((bar) => ({
      ...bar,
      open: bar.open / 1000,
      high: bar.high / 1000,
      low: bar.low / 1000,
      close: bar.close / 1000,
    }));
    await page.route('**/api/market-data?**', (route) =>
      route.fulfill({ json: fixture }),
    );
    await openData(page);
    await page
      .getByRole('textbox', { name: 'Ticker symbol', exact: true })
      .fill('MSFT');
    await page
      .getByRole('button', { name: 'Load & start replay', exact: true })
      .click();

    const suffix = currency ? ` ${currency}` : '';
    await expect(page.locator('.order-market-price')).toHaveText(
      `0.13650${suffix}Replay price`,
    );
    await expect(page.locator('.chart-footer')).toContainText(
      currency ?? 'Currency unavailable',
    );
    await expect(
      page
        .locator('.metric')
        .filter({ hasText: 'Account equity' })
        .locator('strong'),
    ).toHaveText(`100,000.00${suffix}`);
    await page.getByRole('button', { name: 'Limit', exact: true }).click();
    await expect(
      page.getByRole('spinbutton', { name: /Limit price/ }),
    ).toHaveValue('0.13650');
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('spinbutton', { name: /Quantity/ }).fill('1');
    await page.getByRole('button', { name: /^Buy MSFT/ }).click();
    await expect(page.getByText('LONG', { exact: true })).toBeVisible();
    await expect(
      page.locator('.position-detail').filter({ hasText: 'Average entry' }),
    ).toContainText(`0.13651${suffix}`);
    expect((await savedSession(page)).market.currency).toBe(currency);
  });
}

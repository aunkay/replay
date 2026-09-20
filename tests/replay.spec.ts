import { readFile } from 'node:fs/promises';
import {
  test,
  expect,
  savedSession,
  openData,
  buy,
  dollars,
  yahooFixture,
} from './helpers/workspace';

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

for (const side of ['long', 'short'] as const) {
  test(`${side} position marks to the revealed candle and closes with correct P&L and fees`, async ({
    page,
  }) => {
    const initial = await savedSession(page);
    const units = 10;
    const direction = side === 'long' ? 1 : -1;
    const entryBar = initial.market.bars[initial.cursor];
    const nextBar = initial.market.bars[initial.cursor + 1];
    const slippage = initial.account.config.slippageBps / 10_000;
    const commission = initial.account.config.commissionBps / 10_000;
    const entry = entryBar.close * (1 + direction * slippage);
    const entryFee = units * entry * commission;

    if (side === 'short')
      await page
        .getByRole('button', { name: 'Sell / Short', exact: true })
        .click();
    await page
      .getByRole('button', {
        name: side === 'long' ? /^Buy AAPL/ : /^Sell AAPL/,
      })
      .click();
    await expect(
      page.getByText(side.toUpperCase(), { exact: true }),
    ).toBeVisible();
    const opened = await savedSession(page);
    expect(opened.account.position.quantity).toBe(direction * units);
    expect(opened.account.position.averagePrice).toBeCloseTo(entry, 8);
    expect(opened.account.cash).toBeCloseTo(
      100_000 - direction * units * entry - entryFee,
      8,
    );
    expect(opened.account.equityHistory.at(-1)!.equity).toBeLessThan(100_000);

    await page
      .getByRole('button', { name: 'Next candle', exact: true })
      .click();
    await expect(
      page.getByRole('slider', { name: 'Replay timeline', exact: true }),
    ).toHaveValue(String(initial.cursor + 1));
    const markedEquity =
      opened.account.cash + direction * units * nextBar.close;
    const equityMetric = page
      .locator('.metric')
      .filter({ hasText: 'Account equity' });
    await expect(equityMetric.locator('strong')).toHaveText(
      dollars(markedEquity),
    );

    await page
      .getByRole('button', { name: 'Close position', exact: true })
      .click();
    await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
    const closed = await savedSession(page);
    const exit = nextBar.close * (1 - direction * slippage);
    const fees = entryFee + units * exit * commission;
    const profit = direction * units * (exit - entry) - fees;
    expect(closed.account.position.quantity).toBe(0);
    expect(closed.account.orders).toHaveLength(2);
    expect(closed.account.feesPaid).toBeCloseTo(fees, 8);
    expect(closed.account.cash).toBeCloseTo(100_000 + profit, 8);
    expect(closed.account.realizedPnl).toBeCloseTo(profit, 8);
    expect(closed.account.equityHistory.at(-1)!.equity).toBeCloseTo(
      closed.account.cash,
      8,
    );
    await expect(equityMetric.locator('strong')).toHaveText(
      dollars(100_000 + profit),
    );
    await expect(
      page
        .locator('.metric')
        .filter({ hasText: 'Realized P&L' })
        .locator('strong'),
    ).toHaveText(`${profit > 0 ? '+' : ''}${dollars(profit)}`);
    await page
      .getByRole('button', { name: 'Trade history', exact: true })
      .click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });
}

test('limit orders wait for a future candle, fill at a favorable opening price, and can be cancelled', async ({
  page,
}) => {
  const initial = await savedSession(page);
  const nextBar = initial.market.bars[initial.cursor + 1];
  await page.getByRole('button', { name: 'Limit', exact: true }).click();
  await page.getByRole('spinbutton', { name: /Limit price/ }).fill('10000');
  await page.getByRole('button', { name: /^Buy AAPL/ }).click();
  await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open orders', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'pending', exact: true }),
  ).toBeVisible();
  expect((await savedSession(page)).account.orders[0].filledAt).toBeUndefined();

  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'filled', exact: true }),
  ).toBeVisible();
  const filled = (await savedSession(page)).account.orders[0];
  expect(filled.fillPrice).toBe(nextBar.open);
  expect(filled.filledAt).toBe(nextBar.time);

  await page.getByRole('spinbutton', { name: /Limit price/ }).fill('1');
  await page.getByRole('button', { name: /^Buy AAPL/ }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'cancelled', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  const after = await savedSession(page);
  expect(after.account.orders[1].status).toBe('cancelled');
  expect(after.account.position.quantity).toBe(10);
});

test('oversized market orders are rejected without changing the account', async ({
  page,
}) => {
  await page.getByRole('spinbutton', { name: /Quantity/ }).fill('1000000000');
  await page.getByRole('button', { name: /^Buy AAPL/ }).click();
  await expect(page.getByRole('status')).toContainText(
    'Insufficient buying power',
  );
  await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
  const after = await savedSession(page);
  expect(after.account.cash).toBe(100_000);
  expect(after.account.feesPaid).toBe(0);
  expect(after.account.orders[0].status).toBe('rejected');
  await page.getByRole('button', { name: 'Open orders', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'rejected', exact: true }),
  ).toBeVisible();
});

test('play advances the timeline and pause stops it at the selected speed', async ({
  page,
}) => {
  const before = await savedSession(page);
  await page
    .getByRole('combobox', { name: 'Replay speed', exact: true })
    .selectOption('10');
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await expect
    .poll(async () => (await savedSession(page)).cursor)
    .toBeGreaterThan(before.cursor);
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  const paused = await savedSession(page);
  await page.waitForTimeout(350); // More than three replay intervals at 10×.
  expect((await savedSession(page)).cursor).toBe(paused.cursor);
  await expect(
    page.getByRole('button', { name: 'Play replay', exact: true }),
  ).toBeVisible();
});

test('rewinding requires a fresh account and clears orders, positions, and equity history', async ({
  page,
}) => {
  await buy(page);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  const before = await savedSession(page);
  await page
    .getByRole('slider', { name: 'Replay timeline', exact: true })
    .focus();
  await page.keyboard.press('Home');
  await expect(
    page.getByRole('dialog', { name: 'A new starting point.' }),
  ).toBeVisible();
  expect((await savedSession(page)).account.orders).toEqual(
    before.account.orders,
  );
  await page
    .getByRole('button', { name: 'Reset account & replay', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const reset = await savedSession(page);
  expect(reset.cursor).toBe(0);
  expect(reset.startCursor).toBe(0);
  expect(reset.account.position.quantity).toBe(0);
  expect(reset.account.orders).toEqual([]);
  expect(reset.account.equityHistory).toEqual([
    { time: reset.market.bars[0].time, equity: 100_000 },
  ]);
  expect(reset.account.cash).toBe(100_000);
  await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
});

test('reload restores the current candle, position, orders, and account value', async ({
  page,
}) => {
  await buy(page, 25);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  const before = await savedSession(page);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Close position', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue(String(before.cursor));
  expect(await savedSession(page)).toEqual(before);
  await expect(page.getByText('LONG', { exact: true })).toBeVisible();
});

test('Yahoo data loading sends ticker and interval and replaces the demo session', async ({
  page,
}) => {
  const fixture = yahooFixture();
  await page.route('**/api/market-data?**', (route) =>
    route.fulfill({ json: fixture }),
  );
  await buy(page);
  await openData(page);
  await page
    .getByRole('textbox', { name: 'Ticker symbol', exact: true })
    .fill('msft');
  await page
    .getByRole('combobox', { name: 'Candle interval', exact: true })
    .selectOption('15m');
  const request = page.waitForRequest('**/api/market-data?**');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  const url = new URL((await request).url());
  expect(Object.fromEntries(url.searchParams)).toEqual({
    ticker: 'MSFT',
    interval: '15m',
    period: '1mo',
  });
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Microsoft Corporation/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Interactive historical price chart/ }),
  ).toBeVisible();
  await expect(page.locator('.instrument-price')).toContainText('$136.50');
  const session = await savedSession(page);
  expect(session.market).toEqual({ ...fixture, request: { period: '1mo' } });
  expect(session.cursor).toBe(18);
  expect(session.account.orders).toHaveLength(0);
  expect(session.account.position.quantity).toBe(0);
  expect(session.account.cash).toBe(100_000);
});

test('custom history dates are sent instead of a period', async ({ page }) => {
  await page.route('**/api/market-data?**', (route) =>
    route.fulfill({ json: yahooFixture() }),
  );
  await openData(page);
  await page
    .getByRole('textbox', { name: 'Ticker symbol', exact: true })
    .fill('MSFT');
  await page
    .getByRole('combobox', { name: 'Candle interval', exact: true })
    .selectOption('15m');
  await page
    .getByRole('combobox', { name: 'History range', exact: true })
    .selectOption('custom');
  await page.getByLabel('Start date', { exact: true }).fill('2025-01-06');
  await page
    .getByLabel('End date (exclusive)', { exact: true })
    .fill('2025-01-07');
  const request = page.waitForRequest('**/api/market-data?**');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  const url = new URL((await request).url());
  expect(Object.fromEntries(url.searchParams)).toEqual({
    ticker: 'MSFT',
    interval: '15m',
    start: '2025-01-06',
    end: '2025-01-07',
  });
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
});

for (const failure of ['server rejection', 'invalid candle payload'] as const) {
  test(`${failure} shows an error and preserves the current session`, async ({
    page,
  }) => {
    const fixture = yahooFixture();
    await page.route('**/api/market-data?**', (route) =>
      failure === 'server rejection'
        ? route.fulfill({
            status: 422,
            json: {
              detail: 'No history is available for this ticker and interval.',
            },
          })
        : route.fulfill({
            json: {
              ...fixture,
              bars: fixture.bars.map((bar, index) =>
                index === 0 ? { ...bar, close: 'not-a-price' } : bar,
              ),
            },
          }),
    );
    await buy(page);
    const before = await savedSession(page);
    await openData(page);
    await page
      .getByRole('textbox', { name: 'Ticker symbol', exact: true })
      .fill('INVALID');
    await page
      .getByRole('button', { name: 'Load & start replay', exact: true })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    if (failure === 'server rejection')
      await expect(page.getByRole('alert')).toContainText(
        'No history is available',
      );
    expect(await savedSession(page)).toEqual(before);
    await page
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Close position', exact: true }),
    ).toBeVisible();
  });
}

test('CSV export downloads the summary, executed orders, and equity history', async ({
  page,
}) => {
  await buy(page);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await page
    .getByRole('button', { name: 'Close position', exact: true })
    .click();
  const session = await savedSession(page);
  const downloadEvent = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export session', exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(
    /^replay-AAPL-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('"Replay session","AAPL","1d","demo","USD"');
  expect(csv).toContain(`"Equity","${session.account.cash}"`);
  expect(csv).toContain(`"Fees paid","${session.account.feesPaid}"`);
  expect(csv).toContain('"order-1","buy","market","10"');
  expect(csv).toContain('"order-2","sell","market","10"');
  expect(csv).toContain('"Equity date (UTC)","Equity"');
});

test('390px layout keeps the workspace and data dialog within the viewport and supports trading', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await buy(page, 1);
  await page
    .getByRole('button', { name: 'Close position', exact: true })
    .click();
  await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
  await openData(page);
  const dialog = await page.getByRole('dialog').boundingBox();
  expect(dialog).not.toBeNull();
  expect(dialog!.x).toBeGreaterThanOrEqual(0);
  expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(390);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

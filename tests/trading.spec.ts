import type { Page } from '@playwright/test';
import type { MarketData } from '../src/lib/data';
import {
  test,
  expect,
  savedSession,
  openData,
  buy,
  dollars,
  yahooFixture,
} from './helpers/workspace';

const signedDollars = (value: number) =>
  `${value > 0 ? '+' : ''}${dollars(value)}`;

async function loadFixture(page: Page, fixture: MarketData) {
  await page.route('**/api/market-data?**', (route) =>
    route.fulfill({ json: fixture }),
  );
  await openData(page);
  await page
    .getByRole('textbox', { name: 'Ticker symbol' })
    .fill(fixture.ticker);
  await page
    .getByRole('combobox', { name: 'Candle interval' })
    .selectOption(fixture.interval);
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedSession(page)).market.ticker)
    .toBe(fixture.ticker);
}

function flatFixture(): MarketData {
  const fixture = yahooFixture();
  fixture.bars = fixture.bars.map((bar) => ({
    ...bar,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
  return fixture;
}

const equityValue = (page: Page) =>
  page
    .locator('.metric')
    .filter({ hasText: 'Account equity' })
    .locator('strong');
const realizedValue = (page: Page) =>
  page.locator('.metric').filter({ hasText: 'Realized P&L' }).locator('strong');

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

for (const side of ['buy', 'sell'] as const) {
  test(`${side} stop waits for the next candle and fills across a gap with adverse slippage`, async ({
    page,
  }) => {
    const fixture = flatFixture();
    // The currently visible candle already crosses either trigger. An order
    // submitted now must still wait for the next candle, which gaps past it.
    fixture.bars[18] = { ...fixture.bars[18], high: 120, low: 80 };
    fixture.bars[19] = {
      ...fixture.bars[19],
      ...(side === 'buy'
        ? { open: 110, high: 112, low: 109, close: 111 }
        : { open: 90, high: 92, low: 88, close: 91 }),
    };
    await loadFixture(page, fixture);
    if (side === 'sell')
      await page
        .getByRole('button', { name: 'Sell / Short', exact: true })
        .click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page
      .getByRole('spinbutton', { name: /Stop trigger/ })
      .fill(side === 'buy' ? '105' : '95');
    await page
      .getByRole('button', {
        name: side === 'buy' ? /^Buy MSFT/ : /^Sell MSFT/,
      })
      .click();
    await expect(page.getByRole('status')).toContainText(
      `${side === 'buy' ? 'Buy' : 'Sell'} stop order placed`,
    );
    await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Open orders/ }).click();
    await expect(
      page.getByRole('cell', { name: 'pending', exact: true }),
    ).toBeVisible();
    expect(
      (await savedSession(page)).account.orders[0].filledAt,
    ).toBeUndefined();

    await page
      .getByRole('button', { name: 'Next candle', exact: true })
      .click();
    await expect(
      page.getByRole('cell', { name: 'filled', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(side === 'buy' ? 'LONG' : 'SHORT', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.position-amount')).toHaveText('10 MSFT');
    const direction = side === 'buy' ? 1 : -1;
    const execution = (side === 'buy' ? 110 : 90) * (1 + direction * 0.0001);
    const fee = 10 * execution * 0.0001;
    await page
      .getByRole('button', { name: 'Trade history', exact: true })
      .click();
    const cells = page.locator('tbody tr').first().getByRole('cell');
    await expect(cells.nth(2)).toHaveText(side.toUpperCase());
    await expect(cells.nth(3)).toHaveText('stop');
    // Quotes below $100 use three decimals; account totals always use cents.
    await expect(cells.nth(5)).toHaveText(
      side === 'sell' ? '$89.991' : dollars(execution),
    );
    await expect(cells.nth(6)).toHaveText(dollars(fee));
    const account = (await savedSession(page)).account;
    expect(account.orders[0].fillPrice).toBeCloseTo(execution, 8);
    expect(account.orders[0].filledAt).toBe(fixture.bars[19].time);
    await page
      .getByRole('button', { name: 'Performance', exact: true })
      .click();
    const equity =
      100_000 -
      direction * 10 * execution -
      fee +
      direction * 10 * fixture.bars[19].close;
    await expect(equityValue(page)).toHaveText(dollars(equity));
  });
}

test('partially closing a long and reversing to a short updates quantity, average entry, fees, and P&L', async ({
  page,
}) => {
  await loadFixture(page, yahooFixture());
  const entry = 136.5 * 1.0001;
  const entryFee = 10 * entry * 0.0001;
  await page.getByRole('button', { name: /^Buy MSFT/ }).click();
  await expect(page.locator('.position-amount')).toHaveText('10 MSFT');
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await page.getByRole('button', { name: 'Sell / Short', exact: true }).click();
  await page.getByRole('spinbutton', { name: /Quantity/ }).fill('4');
  await page.getByRole('button', { name: /^Sell MSFT/ }).click();
  const firstExit = 138.5 * 0.9999;
  const firstFee = 4 * firstExit * 0.0001;
  const partialRealized = 4 * (firstExit - entry) - entryFee - firstFee;
  await expect(page.getByText('LONG', { exact: true })).toBeVisible();
  await expect(page.locator('.position-amount')).toHaveText('6 MSFT');
  await expect(
    page.locator('.position-detail').filter({ hasText: 'Average entry' }),
  ).toContainText(dollars(entry));
  await expect(realizedValue(page)).toHaveText(signedDollars(partialRealized));
  await expect(
    page
      .locator('.position-detail')
      .filter({ hasText: 'Unrealized P&L' })
      .locator('strong'),
  ).toHaveText(signedDollars(6 * (138.5 - entry)));

  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await page.getByRole('spinbutton', { name: /Quantity/ }).fill('9');
  await page.getByRole('button', { name: /^Sell MSFT/ }).click();
  const reversal = 140.5 * 0.9999;
  const reversalFee = 9 * reversal * 0.0001;
  const realized = partialRealized + 6 * (reversal - entry) - reversalFee;
  const unrealized = -3 * (140.5 - reversal);
  await expect(page.getByText('SHORT', { exact: true })).toBeVisible();
  await expect(page.locator('.position-amount')).toHaveText('3 MSFT');
  await expect(
    page.locator('.position-detail').filter({ hasText: 'Average entry' }),
  ).toContainText(dollars(reversal));
  await expect(
    page
      .locator('.position-detail')
      .filter({ hasText: 'Unrealized P&L' })
      .locator('strong'),
  ).toHaveText(signedDollars(unrealized));
  await expect(realizedValue(page)).toHaveText(signedDollars(realized));
  await expect(equityValue(page)).toHaveText(
    dollars(100_000 + realized + unrealized),
  );
  await expect(page.locator('.equity-stats').getByText(/Fees paid/)).toHaveText(
    `Fees paid ${dollars(entryFee + firstFee + reversalFee)}`,
  );
  await expect(
    page.getByText('2 closing trades', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Trade history', exact: true })
    .click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(
    page.locator('tbody tr').first().getByRole('cell').nth(4),
  ).toHaveText('9');
  expect((await savedSession(page)).account.position.quantity).toBe(-3);
});

test('account settings reset at the current candle and persist the new balance and execution costs', async ({
  page,
}) => {
  await buy(page);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  const before = await savedSession(page);
  await page
    .getByRole('button', { name: 'Account settings', exact: true })
    .click();
  await page
    .getByRole('spinbutton', { name: /Starting balance/ })
    .fill('25000');
  await page
    .getByRole('spinbutton', { name: 'Commission (bps)', exact: true })
    .fill('25');
  await page
    .getByRole('spinbutton', { name: 'Slippage (bps)', exact: true })
    .fill('50');
  await page
    .getByRole('button', { name: 'Apply & start fresh', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
  await expect(equityValue(page)).toHaveText('$25,000.00');
  await expect(realizedValue(page)).toHaveText('$0.00');
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue(String(before.cursor));
  const reset = await savedSession(page);
  expect(reset.startCursor).toBe(before.cursor);
  expect(reset.account.orders).toEqual([]);
  expect(reset.account.equityHistory).toEqual([
    { time: before.market.bars[before.cursor].time, equity: 25_000 },
  ]);

  await page.reload();
  await expect(equityValue(page)).toHaveText('$25,000.00');
  await page
    .getByRole('button', { name: 'Account settings', exact: true })
    .click();
  await expect(
    page.getByRole('spinbutton', { name: /Starting balance/ }),
  ).toHaveValue('25000');
  await expect(
    page.getByRole('spinbutton', { name: 'Commission (bps)', exact: true }),
  ).toHaveValue('25');
  await expect(
    page.getByRole('spinbutton', { name: 'Slippage (bps)', exact: true }),
  ).toHaveValue('50');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await buy(page, 1);
  const fillPrice = before.market.bars[before.cursor].close * 1.005;
  const fee = fillPrice * 0.0025;
  await expect(realizedValue(page)).toHaveText(signedDollars(-fee));
  await expect(equityValue(page)).toHaveText(
    dollars(25_000 - fillPrice - fee + before.market.bars[before.cursor].close),
  );
  await page
    .getByRole('button', { name: 'Trade history', exact: true })
    .click();
  await expect(page.locator('tbody tr').getByRole('cell').nth(5)).toHaveText(
    dollars(fillPrice),
  );
  await expect(page.locator('tbody tr').getByRole('cell').nth(6)).toHaveText(
    dollars(fee),
  );
});

test('zero, negative, and empty quantities are blocked without changing the account', async ({
  page,
}) => {
  const before = await savedSession(page);
  const quantity = page.getByRole('spinbutton', { name: /Quantity/ });
  for (const value of ['0', '-1', '']) {
    await quantity.fill(value);
    await page.getByRole('button', { name: /^Buy AAPL/ }).click();
    await expect(quantity).toBeFocused();
    expect(
      await quantity.evaluate((input: HTMLInputElement) =>
        input.checkValidity(),
      ),
    ).toBe(false);
    expect(
      await quantity.evaluate(
        (input: HTMLInputElement) => input.validationMessage,
      ),
    ).not.toBe('');
    await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
    await expect(equityValue(page)).toHaveText('$100,000.00');
    expect(await savedSession(page)).toEqual(before);
  }
  await buy(page, 0.5);
  await expect(page.locator('.position-amount')).toHaveText('0.5 AAPL');
});

for (const type of ['Limit', 'Stop'] as const) {
  test(`${type.toLowerCase()} ticket rejects zero, negative, and empty prices without placing an order`, async ({
    page,
  }) => {
    const before = await savedSession(page);
    await page.getByRole('button', { name: type, exact: true }).click();
    const price = page.getByRole('spinbutton', {
      name: type === 'Limit' ? /Limit price/ : /Stop trigger/,
    });
    for (const value of ['0', '-1', '']) {
      await price.fill(value);
      await page.getByRole('button', { name: /^Buy AAPL/ }).click();
      await expect(price).toBeFocused();
      expect(
        await price.evaluate((input: HTMLInputElement) =>
          input.checkValidity(),
        ),
      ).toBe(false);
      expect(
        await price.evaluate(
          (input: HTMLInputElement) => input.validationMessage,
        ),
      ).not.toBe('');
      expect(await savedSession(page)).toEqual(before);
    }
    await page.getByRole('button', { name: /Open orders/ }).click();
    await expect(
      page.getByText('No orders yet', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await price.fill('105');
    await page.getByRole('button', { name: /^Buy AAPL/ }).click();
    await expect(
      page.getByRole('cell', { name: 'pending', exact: true }),
    ).toBeVisible();
  });
}

test('forward seeking executes a pending order on an intermediate candle even when the final candle misses its trigger', async ({
  page,
}) => {
  const fixture = flatFixture();
  fixture.bars[21] = { ...fixture.bars[21], high: 106, close: 101 };
  await loadFixture(page, fixture);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('spinbutton', { name: /Stop trigger/ }).fill('105');
  await page.getByRole('button', { name: /^Buy MSFT/ }).click();
  await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
  await page
    .getByRole('slider', { name: 'Replay timeline', exact: true })
    .press('End');
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue('59');
  await expect(page.getByText('LONG', { exact: true })).toBeVisible();
  await expect(page.locator('.position-amount')).toHaveText('10 MSFT');
  const execution = 105 * 1.0001;
  await expect(equityValue(page)).toHaveText(
    dollars(100_000 - 10 * execution * 1.0001 + 10 * 100),
  );
  await page
    .getByRole('button', { name: 'Trade history', exact: true })
    .click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').getByRole('cell').nth(5)).toHaveText(
    dollars(execution),
  );
  const session = await savedSession(page);
  expect(session.account.orders[0].filledAt).toBe(fixture.bars[21].time);
  expect(session.account.equityHistory).toHaveLength(42);
  expect(session.account.equityHistory.map((point) => point.time)).toEqual(
    fixture.bars.slice(18).map((bar) => bar.time),
  );
});

test('playing the final candle stops replay and disables forward controls', async ({
  page,
}) => {
  const fixture = yahooFixture();
  await loadFixture(page, fixture);
  await page.clock.install();
  await page
    .getByRole('button', { name: 'Restart replay', exact: true })
    .click();
  await page
    .getByLabel('Replay starts on', { exact: true })
    .fill(new Date(fixture.bars[58].time * 1000).toISOString().slice(0, 16));
  await page
    .getByRole('button', { name: 'Reset account & replay', exact: true })
    .click();
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue('58');
  await page
    .getByRole('combobox', { name: 'Replay speed', exact: true })
    .selectOption('10');
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await page.clock.runFor(150);
  await expect(
    page.getByText('End of available history', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue('59');
  await expect(
    page.getByRole('button', { name: 'Play replay', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Next candle', exact: true }),
  ).toBeDisabled();
  const finished = await savedSession(page);
  await page.clock.runFor(500);
  expect(await savedSession(page)).toEqual(finished);
  await page
    .getByRole('button', { name: 'Restart replay', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Reset account & replay', exact: true })
    .click();
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue('58');
  await expect(
    page.getByRole('button', { name: 'Play replay', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Next candle', exact: true }),
  ).toBeEnabled();
});

test('dismissing a rewind confirmation preserves the candle, open position, and performance', async ({
  page,
}) => {
  await buy(page, 25);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  const before = await savedSession(page);
  const equity = await equityValue(page).innerText();
  await page
    .getByRole('slider', { name: 'Replay timeline', exact: true })
    .press('Home');
  await expect(
    page.getByRole('dialog', { name: 'A new starting point.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue(String(before.cursor));
  await expect(page.getByText('LONG', { exact: true })).toBeVisible();
  await expect(page.locator('.position-amount')).toHaveText('25 AAPL');
  await expect(equityValue(page)).toHaveText(equity);
  expect(await savedSession(page)).toEqual(before);
  await page
    .getByRole('button', { name: 'Trade history', exact: true })
    .click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('keyboard shortcuts control the workspace but do not trade or advance while editing a field', async ({
  page,
}) => {
  await page.clock.install();
  const initial = await savedSession(page);
  await page
    .getByRole('combobox', { name: 'Replay speed', exact: true })
    .selectOption('10');
  await page.getByRole('heading', { name: /Market replay/ }).click();
  await page.keyboard.press('s');
  await expect(page.getByRole('button', { name: /^Sell AAPL/ })).toBeVisible();
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: /^Buy AAPL/ })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue(String(initial.cursor + 1));

  const quantity = page.getByRole('spinbutton', { name: /Quantity/ });
  await quantity.focus();
  await page.keyboard.press('s');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await page.clock.runFor(350);
  await expect(page.getByRole('button', { name: /^Buy AAPL/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Play replay', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue(String(initial.cursor + 1));
  expect((await savedSession(page)).account.orders).toEqual([]);

  await page.getByRole('heading', { name: /Market replay/ }).click();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: 'Pause replay', exact: true }),
  ).toBeVisible();
  await page.clock.runFor(110);
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue(String(initial.cursor + 2));
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: 'Play replay', exact: true }),
  ).toBeVisible();
  await page.clock.runFor(350);
  await expect(
    page.getByRole('slider', { name: 'Replay timeline', exact: true }),
  ).toHaveValue(String(initial.cursor + 2));
});

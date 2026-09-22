import {
  test,
  expect,
  savedSession,
  openData,
  yahooFixture,
} from './helpers/workspace';

test('three profit levels scale out and preserve the remaining stop across reload', async ({
  page,
  isMobile,
}) => {
  const fixture = yahooFixture();
  fixture.bars = fixture.bars.map((b) => ({
    ...b,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
  fixture.bars[19] = {
    ...fixture.bars[19],
    open: 100,
    high: 106,
    low: 99,
    close: 105,
  };
  fixture.bars[20] = {
    ...fixture.bars[20],
    open: 105,
    high: 116,
    low: 104,
    close: 115,
  };
  await page.route('**/api/market-data?**', (r) =>
    r.fulfill({ json: fixture }),
  );
  await page.goto('/');
  await openData(page);
  await page.getByRole('textbox', { name: 'Ticker symbol' }).fill('MSFT');
  await page
    .getByRole('combobox', { name: 'Candle interval' })
    .selectOption('15m');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect
    .poll(async () => (await savedSession(page))?.market.ticker)
    .toBe('MSFT');
  if (isMobile)
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .click();
  await page.getByText('Protection & risk sizing', { exact: true }).click();
  await page.getByRole('spinbutton', { name: /Quantity/ }).fill('10');
  await page.getByLabel('Stop-loss', { exact: true }).fill('90');
  await page.getByLabel('Multiple take-profit levels').check();
  for (let i = 1; i <= 3; i++)
    await page
      .getByLabel(`TP${i} price`, { exact: true })
      .fill(String(100 + i * 5));
  await page.getByRole('button', { name: /^Buy MSFT/ }).click();
  await expect
    .poll(
      async () =>
        (await savedSession(page)).account.orders.filter(
          (o) => o.status === 'pending',
        ).length,
    )
    .toBe(4);
  // Adjust one handle without replacing the staged exits or their allocations.
  await page
    .getByRole('button', { name: 'Drag stop-loss price', exact: true })
    .press('ArrowUp');
  await page
    .getByRole('button', { name: 'Drag take-profit price', exact: true })
    .first()
    .press('ArrowUp');
  const adjusted = (await savedSession(page)).account.orders.filter(
    (o) => o.status === 'pending',
  );
  expect(adjusted).toHaveLength(4);
  expect(
    adjusted.filter((o) => o.role === 'takeProfit').map((o) => o.quantity),
  ).toEqual([3, 3, 4]);
  const step = () =>
    page
      .getByRole('button', {
        name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
        exact: true,
      })
      .click();
  await step();
  await expect
    .poll(async () => (await savedSession(page)).account.position.quantity)
    .toBe(7);
  await page.reload();
  await expect
    .poll(
      async () =>
        (await savedSession(page)).account.orders.find(
          (o) => o.role === 'stopLoss',
        )?.quantity,
    )
    .toBe(7);
  await step();
  await expect
    .poll(async () => (await savedSession(page)).account.position.quantity)
    .toBe(0);
  const account = (await savedSession(page)).account;
  expect(
    account.orders.filter(
      (o) => o.role === 'takeProfit' && o.status === 'filled',
    ),
  ).toHaveLength(3);
  expect(account.orders.filter((o) => o.status === 'pending')).toHaveLength(0);
});

test('trailing and break-even controls persist and tighten after replay advances', async ({
  page,
  isMobile,
}) => {
  const fixture = yahooFixture();
  fixture.bars = fixture.bars.map((b) => ({
    ...b,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
  fixture.bars[19] = {
    ...fixture.bars[19],
    open: 100,
    high: 112,
    low: 99,
    close: 110,
  };
  fixture.bars[20] = {
    ...fixture.bars[20],
    open: 103,
    high: 104,
    low: 100,
    close: 102,
  };
  await page.route('**/api/market-data?**', (r) =>
    r.fulfill({ json: fixture }),
  );
  await page.goto('/');
  await openData(page);
  await page.getByRole('textbox', { name: 'Ticker symbol' }).fill('MSFT');
  await page
    .getByRole('combobox', { name: 'Candle interval' })
    .selectOption('15m');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect
    .poll(async () => (await savedSession(page))?.market.ticker)
    .toBe('MSFT');
  if (isMobile)
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .click();
  await page.getByText('Protection & risk sizing', { exact: true }).click();
  await page.getByLabel('Trailing stop', { exact: true }).selectOption('price');
  await page.getByLabel('Trailing distance', { exact: true }).fill('5');
  await page.getByLabel('Break-even activation %', { exact: true }).fill('2');
  await page.getByRole('button', { name: /^Buy MSFT/ }).click();
  await expect
    .poll(
      async () =>
        (await savedSession(page)).account.orders.find(
          (o) => o.role === 'stopLoss',
        )?.price,
    )
    .toBe(95);
  const step = () =>
    page
      .getByRole('button', {
        name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
        exact: true,
      })
      .click();
  await step();
  await expect
    .poll(
      async () =>
        (await savedSession(page)).account.orders.find(
          (o) => o.role === 'stopLoss',
        )?.price,
    )
    .toBe(105);
  await page.reload();
  await step();
  await expect
    .poll(async () => (await savedSession(page)).account.position.quantity)
    .toBe(0);
  expect(
    (await savedSession(page)).account.orders.find((o) => o.role === 'stopLoss')
      ?.fillPrice,
  ).toBeLessThanOrEqual(103);
});

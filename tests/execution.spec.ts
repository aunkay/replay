import {
  test,
  expect,
  openData,
  savedSession,
  yahooFixture,
} from './helpers/workspace';
test('execution settings split orders by candle volume and persist remaining fills', async ({
  page,
  isMobile,
}) => {
  const market = yahooFixture();
  market.bars = market.bars.map((b) => ({
    ...b,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }));
  await page.route('**/api/market-data?**', (r) => r.fulfill({ json: market }));
  await page.goto('/');
  await openData(page);
  await page.getByLabel('Ticker symbol', { exact: true }).fill('MSFT');
  await page
    .getByRole('combobox', { name: 'Candle interval' })
    .selectOption('15m');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: isMobile ? 'Mobile account settings' : 'Account settings',
      exact: true,
    })
    .click();
  await page.getByLabel('Bid/ask spread (bps)', { exact: true }).fill('10');
  await page.getByLabel('Short borrow APR (%)', { exact: true }).fill('5');
  await page.getByLabel('Volume participation (%)', { exact: true }).fill('20');
  await page
    .getByRole('button', { name: 'Apply & start fresh', exact: true })
    .click();
  if (isMobile)
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .click();
  await page.getByRole('spinbutton', { name: /Quantity/ }).fill('5');
  await page.getByRole('button', { name: /^Buy MSFT/ }).click();
  await expect
    .poll(async () => (await savedSession(page)).account.position.quantity)
    .toBe(2);
  expect(
    (await savedSession(page)).account.position.averagePrice,
  ).toBeGreaterThan(100);
  await page.reload();
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
    .toBe(4);
  await step();
  await expect
    .poll(async () => (await savedSession(page)).account.position.quantity)
    .toBe(5);
  expect(
    (await savedSession(page)).account.orders.filter(
      (o) => o.status === 'pending',
    ),
  ).toHaveLength(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

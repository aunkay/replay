import { test, expect } from './helpers/workspace';
import type { MarketData } from '../src/lib/data';
test('Live finer execution settings and staged trailing protection survive reconnect', async ({
  page,
  request,
  isMobile,
}) => {
  test.setTimeout(70000);
  await request.post('/api/test/reset-provider');
  await page.goto('/');
  await page.getByRole('button', { name: '● Live', exact: true }).click();
  await expect(
    page.getByLabel('Keep monitoring when browser closes'),
  ).toBeEnabled({ timeout: 20000 });
  await page.getByLabel('Keep monitoring when browser closes').check();
  const client = await page.evaluate(() =>
    sessionStorage.getItem('replay-controller'),
  );
  let monitor: any;
  for (const row of await (await request.get('/api/live')).json()) {
    const state = await (await request.get(`/api/live/${row.id}`)).json();
    if (state.controller === client) monitor = state;
  }
  const read = async () =>
    await (await request.get(`/api/live/${monitor.id}`)).json();
  const market: MarketData = monitor.session.market;
  const parent = market.bars.at(-1)!;
  await page.clock.setFixedTime(new Date((parent.time + 86400) * 1000));
  const n = Math.floor(
    ((parent.endTime ?? parent.time + 86400) - parent.time) / 60,
  );
  const fine = {
    ...market,
    interval: '1m',
    bars: Array.from({ length: n }, (_, i) => ({
      time: parent.time + i * 60,
      endTime: parent.time + (i + 1) * 60,
      open: i ? parent.close : parent.open,
      high: i ? parent.close : parent.high,
      low: i ? parent.close : parent.low,
      close: parent.close,
      volume: parent.volume / n,
      complete: true,
    })),
  };
  await page.route('**/api/market-data?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('interval') === '1m')
      await route.fulfill({ json: fine });
    else await route.continue();
  });
  await page.getByText('Finer-candle execution', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Fetch finer candles', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Finer execution settings' }),
  ).toContainText('Enabled: 1m');
  await expect
    .poll(async () =>
      (await read()).streams.some((s: any) => s.interval === '1m'),
    )
    .toBe(true);
  if (isMobile)
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .click();
  await page.getByText('Protection & risk sizing', { exact: true }).click();
  await page.getByRole('spinbutton', { name: /Quantity/ }).fill('10');
  await page
    .getByLabel('Trailing stop', { exact: true })
    .selectOption('percent');
  await page.getByLabel('Trailing distance', { exact: true }).fill('5');
  await page.getByLabel('Break-even activation %', { exact: true }).fill('1');
  await page.getByLabel('Multiple take-profit levels').check();
  const price = parent.close;
  for (let i = 1; i <= 3; i++)
    await page
      .getByLabel(`TP${i} price`, { exact: true })
      .fill(String(price + 100 * i));
  await page.getByRole('button', { name: /^Buy AAPL/ }).click();
  await expect.poll(async () => (await read()).pendingOrders.length).toBe(1);
  await request.post(`/api/test/live/${monitor.id}/portfolio-next`);
  await expect
    .poll(async () => (await read()).session.account.position.quantity, {
      timeout: 30000,
    })
    .toBe(10);
  const account = (await read()).session.account;
  expect(account.dynamicProtection.trailing.mode).toBe('percent');
  expect(
    account.orders.filter(
      (o: any) => o.role === 'takeProfit' && o.status === 'pending',
    ),
  ).toHaveLength(3);
  expect(account.executionCoverage.fallback).toBeGreaterThan(0);
  await page.reload();
  await page
    .locator(`[data-monitor-id="${monitor.id}"]`)
    .getByRole('button', { name: 'Connect to monitor' })
    .click();
  await expect
    .poll(
      async () => (await read()).session.account.dynamicProtection.breakEvenPct,
    )
    .toBe(1);
  expect((await read()).session.finerMarket.interval).toBe('1m');
  await page.getByRole('button', { name: '● Live', exact: true }).click();
});

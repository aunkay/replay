import { test, expect } from './helpers/workspace';
test('background monitor records alerts with no browser lease and reconnects', async ({
  page,
  context,
  browser,
  request,
  baseURL,
  isMobile,
}) => {
  test.setTimeout(60000);
  await request.post('/api/test/reset-provider');
  await page.goto('/');
  await page.getByRole('button', { name: '● Live', exact: true }).click();
  const status = page.getByRole('region', { name: 'Live update status' });
  const toggle = status.getByLabel('Keep monitoring when browser closes');
  await expect(toggle).toBeEnabled({ timeout: 20000 });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  // Identify this monitor by its controlling client, not another test's monitor.
  const client = await page.evaluate(() =>
    sessionStorage.getItem('replay-controller'),
  );
  const list = await (await request.get('/api/live')).json();
  let monitor: any;
  for (const row of list) {
    const s = await (await request.get(`/api/live/${row.id}`)).json();
    if (s.controller === client) monitor = s;
  }
  expect(monitor).toBeTruthy();
  await request.put(`/api/live/${monitor.id}/streams`,{data:{client,streams:[{ticker:'AAPL',interval:'1d'},{ticker:'SPY',interval:'1d'}]}});
  const last = monitor.session.market.bars.at(-1);
  const rule = {
    join: 'and',
    conditions: [
      {
        left: { kind: 'price', field: 'close' },
        op: 'crossUp',
        right: { kind: 'constant', value: last.close + 0.5 },
      },
    ],
  };
  await request.post(`/api/live/${monitor.id}/orders`, {
    data: {
      client,
      key: 'background-alert',
      command: {
        type: 'alert',
        action: 'save',
        id: 'background-price',
        name: 'Background breakout',
        rule,
        pause: false,
      },
    },
  });
  await context.close();
  await request.post(`/api/test/live/${monitor.id}/disconnect-and-advance`);
  await expect
    .poll(
      async () => {
        const s = await (await request.get(`/api/live/${monitor.id}`)).json();
        return s.session.alertEvents?.length ?? 0;
      },
      { timeout: 25000 },
    )
    .toBeGreaterThan(0);
  const newContext = await browser.newContext({
    baseURL,
    viewport: isMobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 720 },
    isMobile,
    hasTouch: isMobile,
  });
  const reconnect = await newContext.newPage();
  await reconnect.goto('/');
  const target = reconnect.locator(`[data-monitor-id="${monitor.id}"]`);
  await target.getByRole('button', { name: 'Connect to monitor' }).click();
  await expect(
    reconnect.getByLabel('Keep monitoring when browser closes'),
  ).toBeChecked();
  await expect(reconnect.getByRole('region',{name:'Live update status'})).toContainText('SPY 1d');
  await reconnect.locator('.market-alerts-panel summary').click();
  await expect(
    reconnect
      .getByRole('region', { name: 'Market alerts' })
      .getByRole('listitem'),
  ).toContainText('Background breakout');
  await reconnect.getByRole('button', { name: '● Live', exact: true }).click();
  expect(
    (await (await request.get(`/api/live/${monitor.id}`)).json()).active,
  ).toBe(false);
  await newContext.close();
});

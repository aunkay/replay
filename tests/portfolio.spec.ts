import { test, expect, savedSession } from './helpers/workspace';
import type { StoredSession } from '../src/lib/session';
for (const server of [false, true])
  test(`portfolio shares capital, advances prices and restores positions ${server ? 'on server' : 'in browser'}`, async ({
    page,
    request,
    isMobile,
  }) => {
    const name = `Portfolio ${Date.now()} ${server} ${isMobile}`;
    const start = Date.parse('2020-01-01T00:00:00Z') / 1000;
    const datasets = [];
    for (const [ticker, price] of [
      ['PBASE', 100],
      ['PCOMP', 50],
    ] as const) {
      const csv =
        'time,open,high,low,close,volume\n' +
        Array.from({ length: 10 }, (_, i) => {
          const p = i >= 4 ? price * 1.1 : price;
          return `${start + i * 86400},${p},${p},${p},${p},1000000`;
        }).join('\n');
      const response = await request.post('/api/datasets/import', {
        data: { name: name + ticker, ticker, interval: '1d', csv },
      });
      expect(response.ok()).toBeTruthy();
      datasets.push(await response.json());
    }
    const read = async () => (await savedSession(page)) as StoredSession;
    await page.goto('/');
    await page.getByText('Data library & CSV import', { exact: true }).click();
    await page
      .getByRole('article', { name: `Dataset ${name}PBASE` })
      .getByRole('button', { name: 'Load dataset', exact: true })
      .click();
    await expect.poll(async () => (await read()).market.ticker).toBe('PBASE');
    await page.getByText('Portfolio trading', { exact: true }).click();
    await page
      .getByLabel('Portfolio dataset', { exact: true })
      .selectOption(datasets[1].id);
    await page
      .getByRole('button', { name: 'Add dataset to portfolio', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'Portfolio position PCOMP' }),
    ).toBeVisible();
    if (server) {
      await page
        .getByRole('button', { name: 'Practice & research', exact: true })
        .click();
      await page.getByLabel('Session name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Save as new session' }).click();
      await expect(page.locator('.server-save-status')).toContainText(
        'Saved on server',
      );
      await page
        .getByRole('button', { name: 'Close practice workspace' })
        .click();
    }
    await page.getByLabel('Portfolio quantity', { exact: true }).fill('600');
    await page
      .getByRole('button', { name: 'Place portfolio order', exact: true })
      .click();
    await expect
      .poll(async () => (await read()).account.position.quantity)
      .toBe(600);
    await page
      .getByLabel('Portfolio trade ticker', { exact: true })
      .selectOption('PCOMP');
    await page.getByLabel('Portfolio quantity', { exact: true }).fill('900');
    await page
      .getByRole('button', { name: 'Place portfolio order', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'Portfolio position PCOMP' }),
    ).toContainText('Insufficient buying power');
    await page.getByLabel('Portfolio quantity', { exact: true }).fill('600');
    await page
      .getByRole('button', { name: 'Place portfolio order', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await read()).portfolio?.book.assets[1].account.position.quantity,
      )
      .toBe(600);
    const before = (await read()).portfolio!;
    expect(before.book.cash).toBeLessThan(10000);
    await page
      .getByRole('button', {
        name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await read()).portfolio?.book.assets[1].bar.close)
      .toBeCloseTo(55);
    await page.reload();
    await expect
      .poll(
        async () =>
          (await read()).portfolio?.book.assets[1].account.position.quantity,
      )
      .toBe(600);
    await page
      .getByRole('button', { name: 'Practice & research', exact: true })
      .click();
    await page
      .getByLabel('Checkpoint name', { exact: true })
      .fill('Portfolio before exits');
    await page
      .getByRole('button', { name: 'Save checkpoint', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Checkpoint saved.' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Close practice workspace' })
      .click();
    await page.getByText('Portfolio trading', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Close PCOMP position', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await read()).portfolio?.book.assets[1].account.position.quantity,
      )
      .toBe(0);
    await page
      .getByRole('button', { name: 'Close PBASE position', exact: true })
      .click();
    await expect
      .poll(async () => (await read()).account.position.quantity)
      .toBe(0);
    expect((await read()).portfolio!.book.cash).toBeGreaterThan(108900);
    await page
      .getByRole('button', { name: 'Practice & research', exact: true })
      .click();
    if (server) {
      await page
        .getByRole('button', { name: 'Trade journal', exact: true })
        .click();
      await expect(
        page.locator('.hub-journal-trade').filter({ hasText: 'PCOMP' }),
      ).toBeVisible();
      const baseEntry = page
        .locator('.hub-journal-trade')
        .filter({ hasText: 'PBASE' });
      const comparisonEntry = page
        .locator('.hub-journal-trade')
        .filter({ hasText: 'PCOMP' });
      await baseEntry.locator('summary').click();
      await baseEntry.getByLabel('Setup', { exact: true }).fill('Base setup');
      await baseEntry
        .getByRole('button', { name: 'Save notes', exact: true })
        .click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Notes saved.' }),
      ).toBeVisible();
      await comparisonEntry.locator('summary').click();
      await expect(
        comparisonEntry.getByLabel('Setup', { exact: true }),
      ).toHaveValue('');
      await comparisonEntry
        .getByLabel('Setup', { exact: true })
        .fill('Comparison setup');
      await comparisonEntry
        .getByRole('button', { name: 'Save notes', exact: true })
        .click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Notes saved.' }),
      ).toBeVisible();
      await expect(baseEntry.getByLabel('Setup', { exact: true })).toHaveValue(
        'Base setup',
      );
    }
    await page
      .getByRole('button', { name: 'Performance', exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: 'Performance table' }).first(),
    ).toContainText('PCOMP');
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    await page
      .getByRole('button', { name: 'Restore checkpoint', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Checkpoint restored.' }),
    ).toBeVisible();
    expect(
      (await read()).portfolio!.book.assets.map(
        (a) => a.account.position.quantity,
      ),
    ).toEqual([600, 600]);
    await page
      .getByRole('button', { name: 'Close practice workspace' })
      .click();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const d of datasets) await request.delete(`/api/datasets/${d.id}`);
  });

test('Live portfolio fills comparison orders after staggered fetches and reconnects', async ({
  page,
  request,
}) => {
  test.setTimeout(70000);
  await request.post('/api/test/reset-provider');
  await page.goto('/');
  await page.getByRole('button', { name: '● Live', exact: true }).click();
  await expect(
    page.getByLabel('Keep monitoring when browser closes'),
  ).toBeEnabled({ timeout: 20000 });
  await page.getByLabel('Keep monitoring when browser closes').check();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Benchmark ticker', exact: true })
    .fill('SPY');
  await page
    .getByRole('button', { name: 'Add comparison', exact: true })
    .click();
  const client = await page.evaluate(() =>
    sessionStorage.getItem('replay-controller'),
  );
  let monitor: any;
  for (const row of await (await request.get('/api/live')).json()) {
    const state = await (await request.get(`/api/live/${row.id}`)).json();
    if (state.controller === client) monitor = state;
  }
  expect(monitor).toBeTruthy();
  const state = async () =>
    await (await request.get(`/api/live/${monitor.id}`)).json();
  await expect
    .poll(
      async () =>
        (await state()).streams.find((s: any) => s.ticker === 'SPY')?.status,
      { timeout: 25000 },
    )
    .toBe('current');
  await page.getByText('Portfolio trading', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Trade SPY in portfolio', exact: true })
    .click();
  await expect(
    page.getByRole('article', { name: 'Portfolio position SPY' }),
  ).toBeVisible();
  await page
    .getByLabel('Portfolio trade ticker', { exact: true })
    .selectOption('SPY');
  await page.getByLabel('Portfolio quantity', { exact: true }).fill('2');
  await page
    .getByRole('button', { name: 'Place portfolio order', exact: true })
    .click();
  await expect.poll(async () => (await state()).pendingOrders.length).toBe(1);
  await request.post(`/api/test/live/${monitor.id}/portfolio-next`);
  await expect
    .poll(
      async () =>
        (await state()).session.portfolio?.book.assets.find(
          (a: any) => a.ticker === 'SPY',
        ).account.position.quantity,
      { timeout: 30000 },
    )
    .toBe(2);
  const filled = (await state()).session.portfolio.book;
  expect(filled.cash).toBeLessThan(filled.config.initialCapital);
  await page.reload();
  await page
    .locator(`[data-monitor-id="${monitor.id}"]`)
    .getByRole('button', { name: 'Connect to monitor' })
    .click();
  await page.getByText('Portfolio trading', { exact: true }).click();
  await expect(
    page.getByRole('article', { name: 'Portfolio position SPY' }),
  ).toContainText('2 units');
  await page.getByRole('button', { name: '● Live', exact: true }).click();
  expect((await state()).active).toBe(false);
});

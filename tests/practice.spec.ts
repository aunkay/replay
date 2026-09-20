import { test, expect, savedSession } from './helpers/workspace';
test('protected position exits conservatively and research panel shows closed trades', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  if (isMobile)
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .tap();
  await page.getByText('Protection & risk sizing', { exact: true }).click();
  const initial = await savedSession(page),
    price = initial.market.bars[initial.cursor].close;
  await page
    .getByRole('spinbutton', { name: 'Stop-loss', exact: true })
    .fill(String(price * 0.99));
  await page
    .getByRole('spinbutton', { name: 'Take-profit', exact: true })
    .fill(String(price * 1.02));
  await page.getByRole('button', { name: /^Buy AAPL/ }).click();
  await expect
    .poll(
      async () =>
        (await savedSession(page)).account.orders.filter(
          (o) => o.status === 'pending',
        ).length,
    )
    .toBe(2);
  const next = isMobile
    ? page.getByRole('button', { name: 'Next candle from mobile toolbar' })
    : page.getByRole('button', { name: 'Next candle', exact: true });
  for (let i = 0; i < 8; i++) await next.click();
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page.getByRole('button', { name: 'analytics', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Closed-trade analysis' }),
  ).toBeVisible();
});
test('server library saves and resumes a named session', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page
    .getByLabel('Session name', { exact: true })
    .fill(`Saved ${Date.now()}`);
  await page.getByRole('button', { name: 'Save as new session' }).click();
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close practice workspace' }).click();
  await expect(page.locator('.server-save-status')).toContainText(
    'Saved on server',
  );
  await page.reload();
  await expect(page.locator('.server-save-status')).toContainText(
    'Saved on server',
  );
});
test('four panels fit desktop or stack without phone overflow', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Chart panel count').selectOption('4');
  await expect(page.locator('.analysis-panel')).toHaveCount(3);
  await expect(page.locator('.analysis-panel .market-chart')).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
});
test('blind exercise hides dates and can finish', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page.getByRole('button', { name: 'blind', exact: true }).click();
  await page.getByLabel('Exercise candles').fill('10');
  await page.getByRole('button', { name: 'Start blind exercise' }).click();
  await expect(
    page.getByRole('button', { name: 'Finish exercise' }),
  ).toBeVisible();
  await expect(page.locator('.replay-date')).toContainText('Candle');
  await page.getByRole('button', { name: 'Finish exercise' }).click();
  await expect(
    page.getByRole('button', { name: 'Finish exercise' }),
  ).toBeHidden();
});

test('visual strategy runs in the server worker and returns a result', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page.getByRole('button', { name: 'strategies', exact: true }).click();
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Backtest results', exact: true }),
  ).toBeVisible({ timeout: 30000 });
});

test('Live is off by default and returns to the original replay account', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  const before = await savedSession(page);
  const button = page.getByRole('button', { name: '● Live', exact: true });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(
    page.getByRole('region', { name: 'Live update status' }),
  ).toBeVisible();
  await expect
    .poll(async () => (await savedSession(page)).market.source, {
      timeout: 20000,
    })
    .toBe('yfinance');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await savedSession(page)).toEqual(before);
});

test('Live stream edits succeed and stopping restores the saved library session', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page
    .getByLabel('Session name', { exact: true })
    .fill(`Live return ${Date.now()}`);
  await page.getByRole('button', { name: 'Save as new session' }).click();
  await expect(page.locator('.server-save-status')).toContainText(
    'Saved on server',
  );
  const id = await page.evaluate(() =>
    localStorage.getItem('replay-server-session'),
  );
  await page.getByRole('button', { name: 'Close practice workspace' }).click();
  const button = page.getByRole('button', { name: '● Live', exact: true });
  await button.click();
  await expect
    .poll(async () => (await savedSession(page)).market.source)
    .toBe('yfinance');
  await page.getByLabel('Chart panel count').selectOption('2');
  const updated = page.waitForResponse(
    (r) => r.url().endsWith('/streams') && r.request().method() === 'PUT',
  );
  await page.getByLabel('Panel interval').selectOption('1m');
  expect((await updated).ok()).toBeTruthy();
  await button.click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('replay-server-session')),
    )
    .toBe(id);
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
});

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
  await page.getByRole('button', { name: 'Performance', exact: true }).click();
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
  await page
    .getByRole('button', { name: 'Blind practice', exact: true })
    .click();
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
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
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

test('practice navigation keeps keyboard focus inside and fits every phone section', async ({
  page,
}) => {
  await page.goto('/');
  const opener = page.getByRole('button', {
    name: 'Practice & research',
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole('dialog', {
    name: 'Practice and research',
    exact: true,
  });
  const close = page.getByRole('button', { name: 'Close practice workspace' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  for (const section of [
    'Sessions',
    'Trade journal',
    'Performance',
    'Blind practice',
    'Strategy lab',
  ]) {
    const nav = page.getByRole('button', { name: section, exact: true });
    await nav.click();
    await expect(nav).toHaveAttribute('aria-pressed', 'true');
    const guide = page.getByRole('complementary', {
      name: `${section} guide`,
      exact: true,
    });
    await expect(
      guide.getByRole('heading', {
        name: `How to use ${section}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(guide.getByRole('listitem')).toHaveCount(3);
    await guide.getByText('Example & terms explained', { exact: true }).click();
    await expect(guide.locator('dl')).toBeVisible();
    await expect(guide.locator('.practice-guide-example')).toContainText(
      'Example',
    );
    await guide.getByText('Example & terms explained', { exact: true }).click();
    await expect(guide.locator('dl')).toBeHidden();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await expect
      .poll(() =>
        page
          .locator('.hub-content')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      )
      .toBe(true);
  }
  await page.getByLabel('Strategy name').fill('Keep this draft');
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  await expect(page.getByLabel('Strategy name')).toHaveValue('Keep this draft');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    'hidden',
  );
});

test('session actions rename, archive, restore, export and safely delete', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  const name = `UX library ${Date.now()}-${Math.random()}`;
  await page.getByLabel('Session name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save as new session' }).click();
  const card = page.getByRole('article', {
    name: `Session ${name}`,
    exact: true,
  });
  await expect(card).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Session saved.' }),
  ).toBeVisible();
  await page.getByLabel('Search sessions').fill(name);
  await card.getByLabel(`More actions for ${name}`).click();
  await card.getByRole('button', { name: 'Rename', exact: true }).click();
  const renamed = `${name} renamed`;
  await card.getByLabel('New session name').fill(renamed);
  await card.getByRole('button', { name: 'Save name' }).click();
  const updated = page.getByRole('article', {
    name: `Session ${renamed}`,
    exact: true,
  });
  await expect(updated).toBeVisible();
  const download = page.waitForEvent('download');
  await updated.getByRole('link', { name: 'Export ZIP' }).click();
  const archive = await download;
  expect(archive.suggestedFilename()).toMatch(/\.zip$/);
  await updated.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(updated).toBeHidden();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(updated).toBeVisible();
  await updated.getByLabel(`More actions for ${renamed}`).click();
  await updated.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await updated.getByLabel(`More actions for ${renamed}`).click();
  await updated
    .getByRole('button', { name: 'Delete session', exact: true })
    .click();
  await updated.getByRole('button', { name: 'Keep session' }).click();
  await expect(updated).toBeVisible();
  await updated
    .getByRole('button', { name: 'Delete session', exact: true })
    .click();
  await updated
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click();
  await expect(updated).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'No matching sessions' }),
  ).toBeVisible();
  // The export can be imported through the secondary storage workflow.
  await page.getByText('Import & browser storage', { exact: true }).click();
  await page
    .getByLabel('Import archive', { exact: true })
    .setInputFiles((await archive.path())!);
  await expect(
    page.getByRole('status').filter({ hasText: 'Archive imported' }),
  ).toBeVisible();
  const imported = page.getByRole('article').filter({ hasText: renamed });
  await expect(imported).toBeVisible();
});

test('journal notes and chart captures persist and completed trades export', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  if (isMobile)
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .tap();
  await page.getByRole('button', { name: /^Buy AAPL/ }).click();
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page
    .getByLabel('Session name', { exact: true })
    .fill(`Journal UX ${Date.now()}`);
  await page.getByRole('button', { name: 'Save as new session' }).click();
  await expect(page.locator('.server-save-status')).toContainText(
    'Saved on server',
  );
  await page
    .getByRole('button', { name: 'Trade journal', exact: true })
    .click();
  await page.getByLabel('Setup', { exact: true }).fill('Pullback');
  await page.getByLabel('Tags', { exact: true }).fill('patient, trend');
  await page
    .getByLabel('Why did you enter?')
    .fill('A planned entry after the pullback.');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Notes saved.' }),
  ).toBeVisible();
  await page
    .getByLabel('Lessons & notes', { exact: true })
    .fill('Keep this draft when capturing.');
  await page
    .getByRole('button', { name: 'Capture chart', exact: true })
    .click();
  await expect(
    page.getByRole('img', { name: 'Saved trade chart' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close practice workspace' }).click();
  await page.reload();
  await expect(page.locator('.server-save-status')).toContainText(
    'Saved on server',
  );
  if (isMobile)
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .tap();
  await page
    .getByRole('button', { name: 'Close position', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Trade journal', exact: true })
    .click();
  await expect(page.getByLabel('Setup', { exact: true })).toHaveValue(
    'Pullback',
  );
  await expect(page.getByLabel('Lessons & notes', { exact: true })).toHaveValue(
    'Keep this draft when capturing.',
  );
  await expect(
    page.getByRole('img', { name: 'Saved trade chart' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  await expect(page.getByText('Closed trades', { exact: true })).toBeVisible();
  await expect(
    page
      .locator('.metric-grid article')
      .filter({ hasText: 'Closed trades' })
      .locator('strong'),
  ).toHaveText('1');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export closed trades CSV' }).click();
  expect((await download).suggestedFilename()).toBe('closed-trades.csv');
});

test('blind practice validates its length and strategy search produces held-out results', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Blind practice', exact: true })
    .click();
  await page.getByRole('button', { name: '25 candles', exact: true }).click();
  await expect(page.getByLabel('Exercise candles')).toHaveValue('25');
  await page.getByLabel('Exercise candles').fill('0');
  await expect(
    page.getByRole('button', { name: 'Start blind exercise' }),
  ).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Choose a whole number');
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  await page
    .getByRole('button', { name: 'RSI threshold', exact: true })
    .click();
  await expect(page.getByLabel('Strategy name')).toHaveValue('RSI threshold');
  await page.getByText('2. Entry & exit rules', { exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'long Entry', exact: true }),
  ).toBeVisible();
  await page.getByText('3. Position size & costs', { exact: true }).click();
  await page.getByLabel('Fixed quantity', { exact: true }).fill('2');
  await page
    .getByText('4. Parameter search (optional)', { exact: true })
    .click();
  await page.getByLabel('Parameter search with held-out test data').check();
  await page.getByLabel('Maximum', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Held-out test results', exact: true }),
  ).toBeVisible({ timeout: 30000 });
});

test('session load errors offer a working retry', async ({ page }) => {
  let fail = true;
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'GET' && fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Library temporarily unavailable' }),
      });
    } else await route.continue();
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Library temporarily unavailable',
  );
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Library refreshed.' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('strategy catalog searches all templates, explains rules and compares historical metrics', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  const templates = page.getByLabel('Strategy templates', { exact: true });
  await expect(templates.getByRole('button')).toHaveCount(24);
  await page
    .getByLabel('Strategy category', { exact: true })
    .selectOption('Volume');
  await expect(templates.getByRole('button')).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Chaikin money flow trend', exact: true })
    .click();
  await expect(page.getByLabel('Strategy name')).toHaveValue(
    'Chaikin money flow trend',
  );
  await expect(
    page.getByRole('article', { name: 'Selected template explanation' }),
  ).toContainText('CMF(20) > 0');
  await page
    .getByLabel('Strategy category', { exact: true })
    .selectOption('All');
  await page
    .getByLabel('Find a strategy', { exact: true })
    .fill('nonexistent strategy');
  await expect(templates.getByRole('button')).toHaveCount(0);
  await expect(
    page.getByText('No matches. Clear your search or choose All categories.'),
  ).toBeVisible();
  await page.getByLabel('Find a strategy', { exact: true }).fill('Connors');
  await expect(templates.getByRole('button')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Connors RSI 4 pullback', exact: true })
    .click();
  await expect(page.getByRole('link', { name: /Connors RSI/ })).toHaveAttribute(
    'href',
    /reddit.com\/r\/algotrading/,
  );
  await page
    .getByText('Historical quick tests · P&L, drawdown & Sharpe', {
      exact: true,
    })
    .click();
  const table = page.getByRole('region', {
    name: 'Historical strategy comparison',
  });
  await expect(table.getByRole('row')).toHaveCount(26);
  await expect(
    table.getByRole('columnheader', { name: 'Sharpe', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Research ticker', { exact: true }).selectOption('QQQ');
  await page
    .getByLabel('Research period', { exact: true })
    .selectOption('Development');
  await expect(table).toContainText('Buy and hold (95%)');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Backtest results', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Sharpe: UTC daily/)).toBeVisible();
});

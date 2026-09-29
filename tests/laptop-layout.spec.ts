import {
  test,
  expect,
  openData,
  yahooFixture,
  savedSession,
} from './helpers/workspace';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`laptop ${viewport.width}: hourly session profiles have usable chart space and reversible focus`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const fixture = yahooFixture();
    fixture.ticker = 'ASTS';
    fixture.name = 'AST SpaceMobile, Inc.';
    fixture.interval = '60m';
    fixture.exchangeTimezone = 'America/New_York';
    fixture.bars = fixture.bars.map((bar, i) => ({
      ...bar,
      time:
        Date.parse('2025-01-06T14:30:00Z') / 1000 +
        Math.floor(i / 7) * 86400 +
        (i % 7) * 3600,
      session: 'regular' as const,
    }));
    await page.route('**/api/market-data?**', (route) =>
      route.fulfill({ json: fixture }),
    );
    await page.goto('/');
    await openData(page);
    await page.getByLabel('Ticker symbol', { exact: true }).fill('ASTS');
    await page
      .getByRole('combobox', { name: 'Candle interval' })
      .selectOption('60m');
    await page
      .getByRole('button', { name: 'Load & start replay', exact: true })
      .click();
    await expect
      .poll(async () => (await savedSession(page)).market.ticker)
      .toBe('ASTS');
    await page.locator('.volume-profile-menu summary').click();
    await page
      .getByLabel('Profile range', { exact: true })
      .selectOption('sessions');
    await page.locator('.volume-profile-menu summary').click();
    await expect
      .poll(async () =>
        Number(
          await page
            .locator('.volume-profile-layer')
            .getAttribute('data-profile-count'),
        ),
      )
      .toBeGreaterThan(1);
    await page.evaluate(() => scrollTo(0, 0));
    const chart = page.locator('.market-chart').first();
    const normal = (await chart.boundingBox())!;
    expect(normal.y).toBeLessThan(410);
    expect(
      Math.min(normal.y + normal.height, viewport.height) - normal.y,
    ).toBeGreaterThan(viewport.height >= 900 ? 350 : 300);
    await expect(
      page.getByRole('button', { name: 'Play replay', exact: true }),
    ).toBeInViewport();
    await page
      .getByRole('button', { name: 'Chart focus', exact: true })
      .click();
    await expect(page.locator('.order-panel')).toBeHidden();
    await expect
      .poll(async () => (await chart.boundingBox())!.width)
      .toBeGreaterThan(normal.width + 200);
    const focus = (await chart.boundingBox())!;
    expect(focus.width * focus.height).toBeGreaterThan(
      normal.width * normal.height * 1.3,
    );
    await expect(
      page.getByRole('button', { name: 'Play replay', exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath('asts-hourly-session-profiles.png'),
    });
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Show order ticket', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.volume-profile-layer')).toBeVisible();
    await page
      .getByRole('button', { name: 'Show order ticket', exact: true })
      .click();
    await expect(page.locator('.order-panel')).toBeVisible();
    await page.getByText('Data library & CSV import', { exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Data library' }),
    ).toBeVisible();
    await page.getByText('Data library & CSV import', { exact: true }).click();
    await page.getByText('Quick tickers', { exact: true }).click();
    await expect(page.locator('.quick-tickers .watchlist')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
}

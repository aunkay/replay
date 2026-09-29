import {
  test,
  expect,
  savedSession,
  yahooFixture,
  openData,
} from './helpers/workspace';
test('volume profiles render, inspect on touch, change views and persist without future volume', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await page.locator('.volume-profile-menu summary').click();
  await page
    .getByLabel('Profile range', { exact: true })
    .selectOption('recent');
  const session = await savedSession(page);
  const expected = session.market.bars
    .slice(Math.max(0, session.cursor + 1 - 100), session.cursor + 1)
    .reduce((s, b) => s + b.volume, 0);
  const profile = page.locator('.volume-profile-layer');
  await expect(profile).toHaveAttribute('data-profile-count', '1');
  await expect
    .poll(async () => Number(await profile.getAttribute('data-profile-volume')))
    .toBeCloseTo(expected, 3);
  await page.getByLabel('Profile visualization').selectOption('total');
  await page.getByLabel('Profile position').selectOption('left');
  await page.getByLabel('Inspect profile bars (hover or tap)').check();
  await page.locator('.volume-profile-menu summary').click();
  const hit = page.locator('.profile-hit').nth(16);
  if (isMobile) await hit.tap();
  else await hit.hover();
  await expect(page.locator('.profile-inspector')).toContainText('Volume');
  await page.getByRole('button', { name: 'Close profile inspection' }).click();
  await page.reload();
  await expect(profile).toHaveAttribute('data-profile-count', '1');
  await page.locator('.volume-profile-menu summary').click();
  await expect(page.getByLabel('Profile visualization')).toHaveValue('total');
  await page.getByLabel('Profile visualization').selectOption('delta');
  await page
    .getByLabel('Profile range', { exact: true })
    .selectOption('sessions');
  await expect(
    page.getByText('Choose an intraday interval for session profiles.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset volume profile' }).click();
  await expect(profile).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test('intraday session profiles group revealed sessions and update during playback', async ({
  page,
  isMobile,
}) => {
  const fixture = yahooFixture();
  fixture.interval = '5m';
  fixture.exchangeTimezone = 'America/New_York';
  fixture.bars = fixture.bars.map((b, i) => ({
    ...b,
    time:
      Date.parse('2024-01-02T14:30:00Z') / 1000 +
      Math.floor(i / 10) * 86400 +
      (i % 10) * 300,
    session: i % 10 < 2 ? 'premarket' : 'regular',
  }));
  await page.route('**/api/market-data?**', (r) =>
    r.fulfill({ json: fixture }),
  );
  await page.goto('/');
  await openData(page);
  await page.getByLabel('Ticker symbol', { exact: true }).fill('MSFT');
  await page
    .getByRole('combobox', { name: 'Candle interval' })
    .selectOption('5m');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect
    .poll(async () => (await savedSession(page)).market.interval)
    .toBe('5m');
  await page.locator('.volume-profile-menu summary').click();
  await page
    .getByLabel('Profile range', { exact: true })
    .selectOption('sessions');
  const layer = page.locator('.volume-profile-layer');
  await expect
    .poll(async () => Number(await layer.getAttribute('data-profile-count')))
    .toBeGreaterThan(1);
  await page
    .getByLabel('Session hours', { exact: true })
    .selectOption('regular');
  const s = await savedSession(page);
  const sum = s.market.bars
    .slice(0, s.cursor + 1)
    .filter((b: any) => b.session === 'regular')
    .reduce((v, b) => v + b.volume, 0);
  await expect
    .poll(async () => Number(await layer.getAttribute('data-profile-volume')))
    .toBeCloseTo(sum, 3);
  await page
    .getByLabel('Profile range', { exact: true })
    .selectOption('session');
  await expect(layer).toHaveAttribute('data-profile-count', '1');
  await page.locator('.volume-profile-menu summary').click();
  await page
    .getByRole('button', {
      name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await savedSession(page)).cursor)
    .toBe(s.cursor + 1);
  const next = await savedSession(page);
  const day = new Date(next.market.bars[next.cursor].time * 1000)
    .toISOString()
    .slice(0, 10);
  const total = next.market.bars
    .slice(0, next.cursor + 1)
    .filter(
      (b: any) =>
        b.session === 'regular' &&
        new Date(b.time * 1000).toISOString().startsWith(day),
    )
    .reduce((v, b) => v + b.volume, 0);
  await expect
    .poll(async () => Number(await layer.getAttribute('data-profile-volume')))
    .toBeCloseTo(total, 3);
  await page.getByLabel('Price scale', { exact: true }).selectOption('log');
  await expect(page.locator('.market-chart').first()).toHaveAttribute(
    'data-chart-scale',
    'log',
  );
  await expect(layer.locator('line')).toHaveCount(3);
  const levelY = Number(await layer.locator('line').first().getAttribute('y1'));
  expect(levelY).toBeGreaterThanOrEqual(0);
  expect(levelY).toBeLessThan(Number(await layer.getAttribute('height')));
  await page.screenshot({
    path: test.info().outputPath('session-volume-profile.png'),
  });
});

test('visible-range profile recomputes when the chart zooms', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'Desktop wheel zoom; mobile profile gestures are covered above.',
  );
  await page.goto('/');
  await page.locator('.volume-profile-menu summary').click();
  await page
    .getByLabel('Profile range', { exact: true })
    .selectOption('visible');
  await page.locator('.volume-profile-menu summary').click();
  const profile = page.locator('.volume-profile-layer');
  await expect(profile).toHaveAttribute('data-profile-count', '1');
  const before = Number(await profile.getAttribute('data-profile-volume'));
  const box = await page.locator('.chart-canvas').first().boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await page.mouse.wheel(0, -600);
  await expect
    .poll(async () => Number(await profile.getAttribute('data-profile-volume')))
    .toBeLessThan(before);
});

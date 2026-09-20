import { expect, savedSession, test } from './helpers/workspace';

test('volume inspection shows the exact historical value on hover or touch', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  const session = await savedSession(page);
  // Use a historical annotation to locate a real rendered candle precisely.
  const bar = session.market.bars[72];
  await page.evaluate((bar) => {
    localStorage.setItem(
      'replay-chart-workspace:v1',
      JSON.stringify({
        indicators: [],
        drawings: {
          'demo:AAPL:1d': [
            {
              id: 'volume-target',
              tool: 'trendline',
              color: '#b29aff',
              points: [
                { time: bar.time, price: bar.close },
                { time: bar.time + 86400, price: bar.close },
              ],
            },
          ],
        },
      }),
    );
  }, bar);
  await page.reload();
  if (isMobile)
    await page.getByRole('button', { name: 'Go to chart', exact: true }).tap();
  const chart = page.locator('.chart-canvas');
  await chart.scrollIntoViewIfNeeded();
  const annotation = page
    .locator('[data-drawing-id="volume-target"] line')
    .first();
  await expect(annotation).toBeAttached();
  const box = (await chart.boundingBox())!;
  const x = Number(await annotation.getAttribute('x1'));
  const y = box.height - 45;
  const point = { x: box.x + x, y: box.y + y };
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.move(point.x, point.y);
  const tooltip = page.getByRole('tooltip', { name: 'Historical volume' });
  await expect(tooltip).toContainText(
    `Volume: ${bar.volume.toLocaleString('en-US')}`,
  );
  await expect(tooltip).toContainText(
    new Date(bar.time * 1000).toISOString().slice(0, 10),
  );
  const bounds = (await tooltip.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(box.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width);
  if (!isMobile) {
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
  }
  await page
    .getByRole('button', { name: 'Toggle volume', exact: true })
    .click();
  await expect(tooltip).toBeHidden();
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.move(point.x, point.y);
  await expect(tooltip).toBeHidden();
});

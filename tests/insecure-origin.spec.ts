import type { Locator } from '@playwright/test';
import { expect, savedSession, test } from './helpers/workspace';

test('indicators and drawings work without randomUUID, as on a local-network HTTP origin', async ({
  page,
  isMobile,
}) => {
  // Reproduce the missing secure-context API independently of the CI hostname.
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
  });
  const press = (control: Locator) =>
    isMobile ? control.tap() : control.click();
  await page.goto('/');
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  const account = await savedSession(page);
  await press(page.getByRole('button', { name: 'Indicators', exact: true }));
  for (const name of [
    'Simple Moving Average',
    'Simple Moving Average',
    'Relative Strength Index',
  ])
    await press(page.getByRole('button', { name: `Add ${name}`, exact: true }));
  await expect(page.locator('.active-indicator')).toHaveCount(3);
  await press(page.getByRole('button', { name: 'Close dialog', exact: true }));
  await expect(
    page.locator('.chart-indicator-values [data-indicator-id]'),
  ).toHaveCount(3);
  const workspace = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('replay-chart-workspace:v1') || '{}'),
    );
  const added = (await workspace()).indicators;
  expect(new Set(added.map((item: { id: string }) => item.id)).size).toBe(3);
  for (const instance of added)
    await expect(
      page.locator(
        `.chart-indicator-values [data-indicator-id="${instance.id}"] [data-value]`,
      ),
    ).not.toHaveCount(0);
  await press(
    page.getByRole('button', { name: 'Horizontal line', exact: true }),
  );
  const surface = page.getByTestId('drawing-surface');
  await surface.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  const box = (await surface.boundingBox())!;
  const x = box.x + box.width * 0.4,
    y = box.y + box.height * 0.4;
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(1);
  await expect
    .poll(async () => (await workspace()).drawings['demo:AAPL:1d']?.length)
    .toBe(1);
  const saved = await workspace();
  await page.reload();
  await expect(
    page.locator('.chart-indicator-values [data-indicator-id]'),
  ).toHaveCount(3);
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(1);
  expect(await workspace()).toEqual(saved);
  await press(page.getByRole('button', { name: 'Indicators', exact: true }));
  await press(
    page
      .getByRole('button', {
        name: 'Remove Simple Moving Average',
        exact: true,
      })
      .first(),
  );
  await expect(page.locator('.active-indicator')).toHaveCount(2);
  expect(
    (await workspace()).indicators.map((item: { id: string }) => item.id),
  ).toEqual(added.slice(1).map((item: { id: string }) => item.id));
  expect(await savedSession(page)).toEqual(account);
});

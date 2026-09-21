import { test, expect, openData, savedSession } from './helpers/workspace';
test('extended-hours selection persists, shades sessions and reaches Live polling', async ({
  page,
  request,
}) => {
  await request.post('/api/test/reset-provider');
  await page.goto('/');
  await openData(page);
  await page
    .getByRole('combobox', { name: 'Candle interval' })
    .selectOption('5m');
  await page.getByLabel('Include premarket and after-hours').check();
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/market-data?') &&
      r.url().includes('extendedHours=true'),
  );
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect
    .poll(async () => (await savedSession(page)).market.extendedHours)
    .toBe(true);
  await expect
    .poll(async () =>
      Number(
        await page
          .locator('.chart-canvas')
          .first()
          .getAttribute('data-extended-session-bars'),
      ),
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect
    .poll(async () =>
      Number(
        await page
          .locator('.chart-canvas')
          .first()
          .getAttribute('data-extended-session-bars'),
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '● Live', exact: true }).click();
  await expect(
    page.getByLabel('Keep monitoring when browser closes'),
  ).toBeEnabled({ timeout: 20000 });
  await expect
    .poll(async () => (await savedSession(page)).market.extendedHours)
    .toBe(true);
  await page.getByRole('button', { name: '● Live', exact: true }).click();
  await openData(page);
  await expect(
    page.getByLabel('Include premarket and after-hours'),
  ).toBeChecked();
  await page.getByLabel('Include premarket and after-hours').uncheck();
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect
    .poll(async () => (await savedSession(page)).market.extendedHours)
    .toBe(false);
  await expect(page.locator('.chart-canvas').first()).toHaveAttribute(
    'data-extended-session-bars',
    '0',
  );
});

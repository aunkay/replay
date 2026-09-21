import { test, expect } from './helpers/workspace';
test('walk-forward research produces fold metrics, stability heatmap and seeded bootstrap', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Practice & research', exact: true })
    .click();
  await page.getByRole('button', { name: 'Strategy lab', exact: true }).click();
  await page
    .getByText('5. Robustness & walk-forward research', { exact: true })
    .click();
  await page.getByLabel('Enable robustness analysis').check();
  await page
    .getByLabel('Research mode', { exact: true })
    .selectOption('walk-forward');
  await page.getByLabel('Monte Carlo simulations', { exact: true }).fill('100');
  // A one-parameter search makes training stability visible for every fold.
  await page
    .getByText('4. Parameter search (optional)', { exact: true })
    .click();
  await page.getByLabel('Parameter search with held-out test data').check();
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Walk-forward results', exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole('table', { name: 'Parameter stability heatmap' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Monte Carlo trade bootstrap',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('Training fold', { exact: true }).selectOption('1');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

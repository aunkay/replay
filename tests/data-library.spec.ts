import { test, expect, savedSession } from './helpers/workspace';
const csv =
  'time,open,high,low,close,volume\n2020-01-01T00:00:00Z,100,102,99,101,1000\n2020-01-01T00:01:00Z,101,103,100,102,2000\n2020-01-01T00:04:00Z,102,104,101,103,3000\n2020-01-01T00:05:00Z,103,105,102,104,4000';
test('CSV library validates, inspects gaps and replays a persisted dataset', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await page.getByText('Data library & CSV import', { exact: true }).click();
  const library = page.getByRole('region', { name: 'Historical data library' });
  const name = `Imported ${Date.now()} ${isMobile}`;
  await library.getByLabel('Dataset name', { exact: true }).fill(name);
  await library.getByLabel('Import ticker', { exact: true }).fill('CUSTOM');
  await library
    .getByLabel('Import interval', { exact: true })
    .selectOption('1m');
  await library
    .getByLabel('CSV file', { exact: true })
    .setInputFiles({
      name: 'history.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
  await library
    .getByRole('button', { name: 'Import dataset', exact: true })
    .click();
  const entry = library.getByRole('article', { name: `Dataset ${name}` });
  await expect(entry).toContainText('4 candles');
  await expect(
    page.getByRole('region', { name: 'Dataset inspection' }),
  ).toContainText('2 empty interval slots');
  await page.reload();
  await page.getByText('Data library & CSV import', { exact: true }).click();
  await entry
    .getByRole('button', { name: 'Load dataset', exact: true })
    .click();
  await expect
    .poll(async () => (await savedSession(page)).market.ticker)
    .toBe('CUSTOM');
  await expect(page.getByText('IMPORTED CSV', { exact: true })).toBeVisible();
  expect((await savedSession(page)).account.position.quantity).toBe(0);
  await page
    .getByRole('button', {
      name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
      exact: true,
    })
    .click();
  expect((await savedSession(page)).market.source).toBe('csv');
  await library
    .getByLabel('Dataset name', { exact: true })
    .fill('Invalid rows');
  await library
    .getByLabel('CSV contents', { exact: true })
    .fill(csv.replace('100,102,99,101', '100,90,99,101'));
  await library
    .getByRole('button', { name: 'Import dataset', exact: true })
    .click();
  await expect(library.getByRole('alert')).toContainText('invalid OHLCV');
  await entry
    .getByRole('button', { name: 'Delete dataset', exact: true })
    .click();
  await expect(entry).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

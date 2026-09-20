import { chromium, webkit, devices, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Capture real UI with the built-in, explicitly labeled synthetic demo.
const baseURL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173';
const output = new URL('../docs/images/', import.meta.url);
await mkdir(output, { recursive: true });
const errors = [];
const capture = async (page, name, fullPage = false) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: fileURLToPath(new URL(name, output)),
    fullPage,
    animations: 'disabled',
    scale: 'css',
  });
  console.log(`Captured ${name}`);
};

const desktop = await chromium.launch();
let storageState;
try {
  const context = await desktop.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Indicators', exact: true }).click();
  for (const name of ['Add Simple Moving Average', 'Add Relative Strength Index']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: /^Buy AAPL/ }).click();
  for (let i = 0; i < 12; i++) {
    await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  }
  const dismiss = page.getByRole('button', { name: 'Dismiss notification' });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'replay-desktop.png', true);
  storageState = await context.storageState();
  await page.getByRole('button', { name: 'Indicators', exact: true }).click();
  await capture(page, 'replay-indicators.png');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Chart panel count').selectOption('4');
  await expect(page.locator('.analysis-panel .market-chart')).toHaveCount(3);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'replay-four-charts.png', true);
  await page.getByRole('button', { name: 'Practice & research', exact: true }).click();
  await page.getByRole('button', { name: 'strategies', exact: true }).click();
  await capture(page, 'replay-strategy-builder.png');
} finally {
  await desktop.close();
}

const mobile = await webkit.launch();
try {
  const context = await mobile.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
    storageState,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Go to chart', exact: true }).tap();
  await page.waitForTimeout(500); // Allow the dock's smooth scroll to settle.
  await capture(page, 'replay-iphone-chart.png');
  await page.getByRole('button', { name: 'Go to order ticket', exact: true }).tap();
  await page.waitForTimeout(500);
  await capture(page, 'replay-iphone-trading.png');
} finally {
  await mobile.close();
}
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);

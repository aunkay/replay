import { test as base, expect, type Page } from '@playwright/test';
import type { TradingState } from '../../src/lib/engine';
import type { MarketData } from '../../src/lib/data';

export { expect };

// Runtime failures fail the test even when the affected control is not asserted.
// Preserve console output alongside Playwright traces for failed journeys.
export const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [
    async ({ page }, use, testInfo) => {
      const runtimeErrors: string[] = [];
      const consoleMessages: string[] = [];
      page.on('pageerror', (error) => runtimeErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          consoleMessages.push(`${message.type()}: ${message.text()}`);
        }
      });
      await use();
      if (testInfo.status !== testInfo.expectedStatus || runtimeErrors.length) {
        await testInfo.attach('browser-diagnostics', {
          body: JSON.stringify({ runtimeErrors, consoleMessages }, null, 2),
          contentType: 'application/json',
        });
      }
      expect(runtimeErrors, 'Browser runtime errors').toEqual([]);
    },
    { auto: true },
  ],
});

const STORAGE_KEY = 'replay-market-lab:v1';
export type SavedSession = {
  market: MarketData;
  cursor: number;
  startCursor: number;
  account: TradingState;
};

export async function savedSession(page: Page): Promise<SavedSession> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) || 'null'),
    STORAGE_KEY,
  );
}

export function dollars(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

export async function buy(page: Page, quantity = 10) {
  await page
    .getByRole('spinbutton', { name: /Quantity/ })
    .fill(String(quantity));
  await page.getByRole('button', { name: /^Buy AAPL/ }).click();
  await expect(
    page.getByRole('button', { name: 'Close position', exact: true }),
  ).toBeVisible();
}

export async function openData(page: Page) {
  await page
    .getByRole('button', { name: 'Load market data', exact: true })
    .last()
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Find your market.' }),
  ).toBeVisible();
}

export function yahooFixture(): MarketData {
  const start = Date.parse('2025-01-06T14:30:00Z') / 1000;
  return {
    ticker: 'MSFT',
    name: 'Microsoft Corporation',
    currency: 'USD',
    exchange: 'NASDAQ',
    interval: '15m',
    source: 'yfinance',
    adjusted: true,
    fetchedAt: '2025-01-07T00:00:00Z',
    range: { start: '2025-01-06', end: '2025-01-07' },
    warnings: [],
    bars: Array.from({ length: 60 }, (_, index) => ({
      time: start + index * 900,
      open: 100 + index * 2,
      high: 101 + index * 2,
      low: 99 + index * 2,
      close: 100.5 + index * 2,
      volume: 100_000 + index * 1000,
    })),
  };
}

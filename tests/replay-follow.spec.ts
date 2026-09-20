import type { Locator, Page } from '@playwright/test';
import { expect, savedSession, test } from './helpers/workspace';

// Fixed historical annotations expose the chart's rendered time coordinates,
// so these assertions test actual viewport movement, not an app follow flag.
async function coordinates(page: Page) {
  const a = Number(
    await page
      .locator('[data-drawing-id="follow-50"] line')
      .first()
      .getAttribute('x1'),
  );
  const b = Number(
    await page
      .locator('[data-drawing-id="follow-51"] line')
      .first()
      .getAttribute('x1'),
  );
  const cursor = (await savedSession(page)).cursor;
  return { x: a, spacing: b - a, latest: a + (cursor - 50) * (b - a) };
}

for (const decorated of [false, true]) {
  test(`replay follows the right edge ${decorated ? 'with indicators, a benchmark and logarithmic line view' : 'in the candlestick view'}`, async ({
    page,
    isMobile,
  }) => {
    const press = (locator: Locator) =>
      isMobile ? locator.tap() : locator.click();
    await page.goto('/');
    await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
    const initial = await savedSession(page);
    await page.evaluate(
      ({ bars, decorated }) => {
        localStorage.setItem(
          'replay-chart-workspace:v1',
          JSON.stringify({
            indicators: decorated
              ? [
                  {
                    id: 'follow-sma',
                    indicatorId: 'sma',
                    period: 20,
                    color: '#b29aff',
                  },
                  {
                    id: 'follow-rsi',
                    indicatorId: 'rsi',
                    period: 14,
                    color: '#35cda0',
                  },
                ]
              : [],
            drawings: {
              'demo:AAPL:1d': [50, 51].map((index) => ({
                id: `follow-${index}`,
                tool: 'vertical',
                color: '#b29aff',
                points: [{ time: bars[index].time, price: bars[index].close }],
              })),
            },
          }),
        );
      },
      { bars: initial.market.bars, decorated },
    );
    await page.reload();
    await expect(page.locator('[data-drawing-tool="vertical"]')).toHaveCount(2);
    if (decorated) {
      await page.route('**/api/market-data?**', (route) =>
        route.fulfill({
          json: {
            ...initial.market,
            ticker: 'SPY',
            name: 'Benchmark',
            source: 'yfinance',
            adjusted: true,
          },
        }),
      );
      await press(page.getByRole('button', { name: 'Compare', exact: true }));
      await press(
        page.getByRole('button', { name: 'Add comparison', exact: true }),
      );
      await expect(page.locator('.market-chart')).toHaveAttribute(
        'data-comparison-ticker',
        'SPY',
      );
      await page
        .getByRole('combobox', { name: 'Normalization', exact: true })
        .selectOption('ratio');
      await page
        .getByRole('combobox', { name: 'Price scale', exact: true })
        .selectOption('log');
      await press(
        page.getByRole('button', { name: 'Switch to line chart', exact: true }),
      );
      await expect(
        page.locator('.chart-indicator-values [data-indicator-id]'),
      ).toHaveCount(2);
    }
    const before = await coordinates(page);
    expect(before.spacing).toBeGreaterThan(0);
    await press(page.getByRole('button', { name: 'Next candle', exact: true }));
    await expect
      .poll(async () => (await coordinates(page)).x)
      .toBeCloseTo(before.x - before.spacing, 1);
    await expect
      .poll(async () => (await coordinates(page)).latest)
      .toBeCloseTo(before.latest, 1);

    await page
      .getByRole('combobox', { name: 'Replay speed' })
      .selectOption('10');
    await press(page.getByRole('button', { name: 'Play replay', exact: true }));
    await expect
      .poll(async () => (await savedSession(page)).cursor)
      .toBeGreaterThanOrEqual(initial.cursor + 12);
    await press(
      page.getByRole('button', { name: 'Pause replay', exact: true }),
    );
    await expect
      .poll(async () => (await coordinates(page)).latest)
      .toBeCloseTo(before.latest, 1);
    expect((await coordinates(page)).spacing).toBeCloseTo(before.spacing, 1);
    const width = (await page.getByTestId('drawing-surface').boundingBox())!
      .width;
    expect((await coordinates(page)).latest).toBeLessThan(width);
    expect((await coordinates(page)).latest).toBeGreaterThan(0);

    // A mouse drag checks that history inspection is not pulled back to replay.
    // Mobile touch panning itself has dedicated WebKit gesture coverage.
    if (!isMobile) {
      const surface = page.getByTestId('drawing-surface');
      await surface.scrollIntoViewIfNeeded();
      const box = (await surface.boundingBox())!;
      const pan = async (distance: number) => {
        await page.mouse.move(
          box.x + box.width * 0.7,
          box.y + box.height * 0.7,
        );
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width * 0.7 + distance,
          box.y + box.height * 0.7,
          { steps: 10 },
        );
        await page.mouse.up();
      };
      const followed = await coordinates(page);
      await pan(120);
      await expect
        .poll(async () => (await coordinates(page)).x)
        .toBeGreaterThan(followed.x + 80);
      const history = await coordinates(page);
      await press(
        page.getByRole('button', { name: 'Next candle', exact: true }),
      );
      await expect
        .poll(async () => (await savedSession(page)).cursor)
        .toBeGreaterThan(initial.cursor + 12);
      // Wait for a real chart redraw, then compare the same historical anchor.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      expect((await coordinates(page)).x).toBeCloseTo(history.x, 1);
      await surface.scrollIntoViewIfNeeded();
      await pan(-150);
      await expect
        .poll(async () => (await coordinates(page)).x)
        .toBeLessThan(history.x - 100);
      const returned = await coordinates(page);
      await press(
        page.getByRole('button', { name: 'Next candle', exact: true }),
      );
      await expect
        .poll(async () => (await coordinates(page)).x)
        .toBeCloseTo(returned.x - returned.spacing, 1);
    }
    expect((await savedSession(page)).account.orders).toEqual(
      initial.account.orders,
    );
  });
}

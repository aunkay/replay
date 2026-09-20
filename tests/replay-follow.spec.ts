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

for (const multiple of [false, true]) {
  test(`play resumes following with a stable right margin ${multiple ? 'across linked charts' : 'in one chart'}`, async ({
    page,
    isMobile,
  }) => {
    await page.goto('/');
    if (multiple) await page.getByLabel('Chart panel count').selectOption('2');
    const chart = page.locator('.market-chart').first();
    const follow = chart.getByRole('button', {
      name: 'Follow latest candle',
      exact: true,
    });
    const gap = async () =>
      Number(
        await chart
          .locator('.chart-canvas')
          .getAttribute('data-replay-right-gap'),
      );
    const span = async () =>
      chart
        .locator('.chart-canvas')
        .evaluate(
          (e) =>
            Number((e as HTMLElement).dataset.logicalTo) -
            Number((e as HTMLElement).dataset.logicalFrom),
        );
    const pan = async () => {
      const surface = chart.getByTestId('drawing-surface');
      await surface.scrollIntoViewIfNeeded();
      const box = (await surface.boundingBox())!;
      const start = {
        x: box.x + box.width * 0.3,
        y: Math.max(50, box.y + box.height * 0.5),
      };
      if (!isMobile) {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 120, start.y, { steps: 12 });
        await page.mouse.up();
      } else {
        // WebKit DOM touch routing, matching the existing mobile pan coverage.
        await page.evaluate(async (start) => {
          const target = document.elementFromPoint(start.x, start.y)!;
          const doc = document as any;
          const emit = (type: string, x: number) => {
            const touch = doc.createTouch(
              window,
              target,
              77,
              x + scrollX,
              start.y + scrollY,
              x,
              start.y,
            );
            target.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: doc.createTouchList(
                  ...(type === 'touchend' ? [] : [touch]),
                ),
                targetTouches: doc.createTouchList(
                  ...(type === 'touchend' ? [] : [touch]),
                ),
                changedTouches: doc.createTouchList(touch),
              }),
            );
          };
          emit('touchstart', start.x);
          for (let i = 1; i <= 12; i++) {
            emit('touchmove', start.x + i * 10);
            await new Promise((r) => setTimeout(r, 16));
          }
          emit('touchend', start.x + 120);
        }, start);
      }
      await expect(follow).toHaveAttribute('aria-pressed', 'false');
    };
    await page
      .getByRole('combobox', { name: 'Replay speed', exact: true })
      .selectOption('10');
    const play = () =>
      page
        .getByRole('button', {
          name: isMobile ? 'Play from mobile toolbar' : 'Play replay',
          exact: true,
        })
        .click();
    const pause = () =>
      page
        .getByRole('button', {
          name: isMobile ? 'Pause from mobile toolbar' : 'Pause replay',
          exact: true,
        })
        .click();
    await play();
    const start = (await savedSession(page)).cursor;
    await expect
      .poll(async () => (await savedSession(page)).cursor)
      .toBeGreaterThan(start + 2);
    await pause();
    await pan();
    const zoom = await span();
    const stopped = (await savedSession(page)).cursor;
    await play();
    await expect.poll(gap).toBeCloseTo(6, 2);
    await expect
      .poll(async () => (await savedSession(page)).cursor)
      .toBeGreaterThan(stopped + 2);
    if (!isMobile) {
      const box = (await chart.boundingBox())!;
      await page.mouse.move(
        box.x + box.width * 0.6,
        Math.max(30, box.y + box.height * 0.4),
      );
    }
    await expect
      .poll(async () => (await savedSession(page)).cursor)
      .toBeGreaterThan(stopped + 5);
    await expect.poll(gap).toBeCloseTo(6, 2);
    await pause();
    expect(await span()).toBeCloseTo(zoom, 1);
    await pan();
    const before = await savedSession(page);
    await follow.click();
    await expect.poll(gap).toBeCloseTo(6, 2);
    expect(await savedSession(page)).toEqual(before);
    for (const canvas of await page.locator('.chart-canvas').all())
      await expect
        .poll(async () =>
          Number(await canvas.getAttribute('data-replay-right-gap')),
        )
        .toBeCloseTo(6, 2);
  });
}

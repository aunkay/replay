import { test, expect, savedSession } from './helpers/workspace';
import { createDemo } from '../src/lib/data';
import { advanceBar, createAccount } from '../src/lib/engine';

for (const baseInterval of ['1d', '5m']) {
  test(`${baseInterval} base and 2m/5m panels load independently without viewport feedback`, async ({
    page,
    isMobile,
  }) => {
    if (!isMobile) await page.setViewportSize({ width: 1600, height: 1000 });
    const day = 86400;
    const today = Math.floor(Date.now() / 1000 / day) * day;
    const origin = today - 3 * day + 14 * 3600;
    const makeBars = (interval: string) =>
      Array.from(
        { length: interval === '1d' ? 300 : interval === '5m' ? 100 : 250 },
        (_, index) => {
          const time =
            interval === '1d'
              ? today - (300 - index) * day
              : origin + index * (interval === '5m' ? 300 : 120);
          const open = 100 + index * 0.1 + Math.sin(index / 4);
          return {
            time,
            open,
            high: open + 2,
            low: open - 2,
            close: open + 0.5,
            volume: 10000 + index,
            endTime:
              time + (interval === '1d' ? day : interval === '5m' ? 300 : 120),
            complete: true,
          };
        },
      );
    const baseBars = makeBars(baseInterval);
    const cursor = baseInterval === '1d' ? 299 : 80;
    const market = {
      ...createDemo(),
      source: 'yfinance' as const,
      adjusted: true,
      interval: baseInterval,
      bars: baseBars,
      request: {
        start: new Date((today - 365 * day) * 1000).toISOString().slice(0, 10),
        end: new Date(today * 1000).toISOString().slice(0, 10),
      },
    };
    const account = advanceBar(
      createAccount({
        initialCapital: 100000,
        commissionBps: 1,
        slippageBps: 1,
      }),
      baseBars[cursor],
    );
    await page.addInitScript(
      ({ market, account, cursor }) => {
        localStorage.setItem(
          'replay-market-lab:v1',
          JSON.stringify({ market, account, cursor, startCursor: cursor }),
        );
        localStorage.removeItem('replay-panels:v1');
        (window as any).rangeEvents = [];
        window.addEventListener('replay:range-sync', (e: any) =>
          (window as any).rangeEvents.push(e.detail.range),
        );
      },
      { market, account, cursor },
    );
    const requests: URL[] = [];
    let fail = false;
    await page.route('**/api/market-data?**', async (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      if (fail) {
        await route.fulfill({
          status: 503,
          json: { detail: 'Panel provider unavailable' },
        });
        return;
      }
      const interval = url.searchParams.get('interval')!;
      await route.fulfill({
        json: { ...market, interval, bars: makeBars(interval) },
      });
    });
    await page.goto('/');
    await page.getByLabel('Chart panel count').selectOption('2');
    const panel = page.locator('.analysis-panel');
    await page
      .getByLabel('Panel interval')
      .selectOption(baseInterval === '1d' ? '5m' : '2m');
    await expect(panel.locator('.market-chart')).toBeVisible();
    await expect
      .poll(async () => Number(await panel.getAttribute('data-panel-candles')))
      .toBeGreaterThan(0);
    const count = Number(await panel.getAttribute('data-panel-candles'));
    expect(count).toBe(baseInterval === '1d' ? 100 : 202);
    const request = requests.at(-1)!;
    expect(
      Date.parse(request.searchParams.get('start')!),
    ).toBeGreaterThanOrEqual((today - 60 * day) * 1000);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    // Both chart containers stay inside their panel, including narrow side-by-side desktop layouts.
    for (const chart of await page.locator('.market-chart').all()) {
      const box = await chart.boundingBox();
      expect(box!.width).toBeGreaterThan(200);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        (await page.viewportSize())!.width + 1,
      );
    }
    const chart = panel.locator('.market-chart');
    await chart.scrollIntoViewIfNeeded();
    const rect = (await chart.boundingBox())!;
    if (isMobile) await chart.tap({ position: { x: 100, y: 100 } });
    else {
      await page.mouse.move(rect.x + 100, rect.y + 100);
      await page.mouse.wheel(0, -120);
    }
    // A range event has one origin; recipient redraws must not echo it back.
    await page.waitForTimeout(400);
    const before = await page.evaluate(
      () => (window as any).rangeEvents.length,
    );
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => (window as any).rangeEvents.length);
    expect(after - before).toBeLessThanOrEqual(1);
    expect(after).toBeLessThan(40);
    if (baseInterval === '5m') {
      const charts = page.locator('.market-chart .chart-canvas');
      for (const attr of ['data-visible-time-from', 'data-visible-time-to']) {
        const a = Number(await charts.nth(0).getAttribute(attr));
        const b = Number(await charts.nth(1).getAttribute(attr));
        expect(a).toBeGreaterThan(0);
        expect(Math.abs(a - b)).toBeLessThanOrEqual(300);
      }
    }
    expect((await savedSession(page)).account).toEqual(account);
    // A failed interval change must not leave the old candles under the new label.
    fail = true;
    await page.getByLabel('Panel interval').selectOption('15m');
    await expect(panel.getByRole('alert')).toContainText(
      'Panel provider unavailable',
    );
    await expect(panel.locator('.market-chart')).toHaveCount(0);
    await page.getByLabel('Panel interval').selectOption(baseInterval);
    await expect(panel.locator('.market-chart')).toBeVisible();
  });
}

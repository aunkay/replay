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
      for (const attr of ['data-visible-time-to']) {
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

for (const [baseInterval, panelInterval] of [
  ['1d', '5m'],
  ['2m', '5m'],
  ['5m', '2m'],
]) {
  test(`${baseInterval}/${panelInterval} playback advances the secondary candles and keeps the latest readable`, async ({
    page,
    isMobile,
  }) => {
    if (!isMobile) await page.setViewportSize({ width: 1600, height: 1000 });
    const day = 86400,
      origin = Math.floor(Date.now() / 1000 / day) * day - 22 * day;
    const makeBars = (interval: string) => {
      const minutes = interval === '5m' ? 5 : 2;
      const perDay = interval === '1d' ? 1 : 360 / minutes;
      return Array.from({ length: 20 * perDay }, (_, index) => {
        const date = origin + Math.floor(index / perDay) * day;
        const offset = interval === '1d' ? 0 : (index % perDay) * minutes * 60;
        const time = date + (interval === '1d' ? 0 : 14 * 3600 + offset);
        const open = 100 + Math.floor(index / perDay) + offset / 86400;
        return {
          time,
          endTime: interval === '1d' ? date + 20 * 3600 : time + minutes * 60,
          complete: true,
          open,
          high: open + 1,
          low: open - 1,
          close: open + 0.3,
          volume: 10000,
        };
      });
    };
    const baseBars = makeBars(baseInterval),
      otherBars = makeBars(panelInterval);
    const cursor =
      baseInterval === '1d' ? 6 : 6 * (baseInterval === '5m' ? 72 : 180) + 30;
    const market = {
      ...createDemo(),
      source: 'yfinance' as const,
      adjusted: true,
      interval: baseInterval,
      // Legacy saved daily sessions may predate explicit candle end times.
      bars:
        baseInterval === '1d'
          ? baseBars.map((b) => ({ ...b, endTime: undefined }))
          : baseBars,
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
      },
      { market, account, cursor },
    );
    await page.route('**/api/market-data?**', (route) =>
      route.fulfill({
        json: { ...market, interval: panelInterval, bars: otherBars },
      }),
    );
    await page.goto('/');
    await page.getByLabel('Chart panel count').selectOption('2');
    await page.getByLabel('Panel interval').selectOption(panelInterval);
    const panel = page.locator('.analysis-panel'),
      canvas = panel.locator('.chart-canvas');
    const assertCurrent = async () => {
      const state = await savedSession(page);
      const clock = baseBars[state.cursor].endTime;
      const completed = otherBars.filter((b) => b.endTime <= clock);
      await expect(panel).toHaveAttribute(
        'data-panel-candles',
        String(completed.length),
      );
      await expect(canvas).toHaveAttribute(
        'data-visible-time-to',
        String(completed.at(-1)!.time),
      );
      await expect
        .poll(async () => Number(await canvas.getAttribute('data-bar-spacing')))
        .toBeGreaterThanOrEqual(4.99);
      return completed.length;
    };
    const before = await assertCurrent();
    await expect
      .poll(async () =>
        Number(
          await page
            .locator('.chart-panel .chart-canvas')
            .getAttribute('data-visible-time-from'),
        ),
      )
      .toBeLessThanOrEqual(baseBars[Math.max(0, cursor - 60)].time);
    const next = page.getByRole('button', {
      name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
      exact: true,
    });
    for (let i = 0; i < (baseInterval === '1d' ? 1 : 8); i++)
      await next.click();
    expect(await assertCurrent()).toBeGreaterThan(before);
    // Exercise the timer as well as the single-step control.
    if (!isMobile)
      await page
        .getByRole('combobox', { name: 'Replay speed', exact: true })
        .selectOption('10');
    const start = (await savedSession(page)).cursor;
    await page
      .getByRole('button', {
        name: isMobile ? 'Play from mobile toolbar' : 'Play replay',
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await savedSession(page)).cursor)
      .toBeGreaterThan(start);
    const pause = page.getByRole('button', {
      name: isMobile ? 'Pause from mobile toolbar' : 'Pause replay',
      exact: true,
    });
    if (await pause.isVisible()) await pause.click();
    await assertCurrent();
  });
}

import type { Locator, Page } from '@playwright/test';
import {
  dollars,
  expect,
  savedSession,
  test,
  yahooFixture,
} from './helpers/workspace';

// This project runs WebKit with iPhone 13 mobile/touch settings. locator.tap()
// and touchscreen.tap() deliver trusted touch input. OS keyboards, system share
// sheets, and physical-device gesture arbitration still require device testing.
async function noHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function touchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  // WebKit may report a 44px SVG circle as 43.999992 CSS pixels.
  expect(Math.round(box!.width * 1000) / 1000).toBeGreaterThanOrEqual(44);
  expect(Math.round(box!.height * 1000) / 1000).toBeGreaterThanOrEqual(44);
}

async function openData(page: Page) {
  await page
    .getByRole('button', { name: 'Load market data', exact: true })
    .last()
    .tap();
  await expect(
    page.getByRole('dialog', { name: 'Find your market.' }),
  ).toBeVisible();
}

async function tapChart(page: Page, x: number, y: number) {
  const surface = page.getByTestId('drawing-surface');
  // Centering avoids the fixed bottom dock, which ordinary visibility scrolling
  // cannot account for when the price pane is already inside the viewport.
  await surface.evaluate((element) =>
    element.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'instant',
    }),
  );
  const bounds = await surface.boundingBox();
  const target = {
    x: bounds!.x + bounds!.width * x,
    y: bounds!.y + bounds!.height * y,
  };
  expect(target.y).toBeGreaterThanOrEqual(0);
  expect(target.y).toBeLessThan(page.viewportSize()!.height);
  expect(
    await page.evaluate(
      ({ x, y }) =>
        Boolean(document.elementFromPoint(x, y)?.closest('.market-chart')),
      target,
    ),
  ).toBe(true);
  await page.touchscreen.tap(target.x, target.y);
  return target;
}

async function savedDrawings(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('replay-chart-workspace:v1') || '{}')
        .drawings?.['demo:AAPL:1d'] || [],
  );
}

test.beforeEach(async ({ page, browserName }) => {
  expect(browserName).toBe('webkit');
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  await page.evaluate(() =>
    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && event.isTrusted)
        document.documentElement.dataset.trustedTouch = 'true';
    }),
  );
});

for (const [name, width, height] of [
  ['full-height WebView portrait', 390, 844],
  ['Safari portrait with browser chrome', 390, 664],
  ['landscape', 844, 390],
] as const) {
  test(`${name} fits the viewport and exposes usable touch trading controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await noHorizontalOverflow(page);
    expect(
      await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
    ).toBe(true);
    await expect(page.locator('.rail')).not.toBeVisible();
    for (const label of [
      'Go to chart',
      'Go to order ticket',
      'Go to performance',
      'Play from mobile toolbar',
      'Next candle from mobile toolbar',
    ])
      await touchTarget(page.getByRole('button', { name: label, exact: true }));
    const before = await savedSession(page);
    await page
      .getByRole('button', {
        name: 'Next candle from mobile toolbar',
        exact: true,
      })
      .tap();
    await expect
      .poll(async () => (await savedSession(page)).cursor)
      .toBe(before.cursor + 1);
    await expect(page.locator('html')).toHaveAttribute(
      'data-trusted-touch',
      'true',
    );
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .tap();
    await touchTarget(page.getByRole('button', { name: /^Buy AAPL/ }));
    const quantity = page.getByRole('spinbutton', { name: /Quantity/ });
    await touchTarget(quantity);
    expect(
      await quantity.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      ),
    ).toBeGreaterThanOrEqual(16);
    await quantity.tap();
    await quantity.fill('1');
    await page.getByRole('button', { name: /^Buy AAPL/ }).tap();
    await expect(page.getByText('LONG', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Go to performance', exact: true })
      .tap();
    await expect(
      page.locator('.metric').filter({ hasText: 'Account equity' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
  });
}

for (const side of ['long', 'short'] as const) {
  test(`touch ${side} trading reconciles fees and realized P&L after replay`, async ({
    page,
  }) => {
    const initial = await savedSession(page);
    const direction = side === 'long' ? 1 : -1;
    const entry =
      initial.market.bars[initial.cursor].close *
      (1 + (direction * initial.account.config.slippageBps) / 10_000);
    const exit =
      initial.market.bars[initial.cursor + 1].close *
      (1 - (direction * initial.account.config.slippageBps) / 10_000);
    const fees =
      (10 * (entry + exit) * initial.account.config.commissionBps) / 10_000;
    const profit = direction * 10 * (exit - entry) - fees;
    await page
      .getByRole('button', { name: 'Go to order ticket', exact: true })
      .tap();
    if (side === 'short')
      await page
        .getByRole('button', { name: 'Sell / Short', exact: true })
        .tap();
    await page
      .getByRole('button', {
        name: side === 'long' ? /^Buy AAPL/ : /^Sell AAPL/,
      })
      .tap();
    await expect(
      page.getByText(side.toUpperCase(), { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: 'Next candle from mobile toolbar',
        exact: true,
      })
      .tap();
    await page
      .getByRole('button', { name: 'Close position', exact: true })
      .tap();
    await expect(page.getByText('FLAT', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Go to performance', exact: true })
      .tap();
    await expect(
      page
        .locator('.metric')
        .filter({ hasText: 'Account equity' })
        .locator('strong'),
    ).toHaveText(dollars(100_000 + profit));
    const closed = await savedSession(page);
    expect(closed.account.realizedPnl).toBeCloseTo(profit, 7);
    expect(closed.account.feesPaid).toBeCloseTo(fees, 7);
    expect(closed.account.orders).toHaveLength(2);
  });
}

test('the market sheet keeps text fields readable and loading a ticker does not zoom the viewport', async ({
  page,
}) => {
  await page.route('**/api/market-data?**', (route) =>
    route.fulfill({ json: yahooFixture() }),
  );
  await openData(page);
  const dialog = page.getByRole('dialog', { name: 'Find your market.' });
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  const ticker = page.getByRole('textbox', {
    name: 'Ticker symbol',
    exact: true,
  });
  await ticker.tap();
  await expect(ticker).toBeFocused();
  expect(
    await ticker.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  await ticker.fill('msft');
  await page
    .getByRole('combobox', { name: 'Candle interval', exact: true })
    .selectOption('15m');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .tap();
  await expect(
    page.getByRole('heading', { name: /Microsoft Corporation/ }),
  ).toBeVisible();
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
});

test('touch chart controls support logarithmic normalization and a benchmark without changing the account', async ({
  page,
}) => {
  const before = await savedSession(page);
  const benchmark = {
    ...before.market,
    ticker: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    source: 'yfinance',
    adjusted: true,
    bars: before.market.bars.map((bar, index) => ({
      ...bar,
      open: 300 + index,
      high: 301 + index,
      low: 299 + index,
      close: 300.5 + index,
    })),
  };
  await page.route('**/api/market-data?**', (route) =>
    route.fulfill({ json: benchmark }),
  );
  await page.getByRole('button', { name: 'Go to chart', exact: true }).tap();
  await page
    .getByRole('combobox', { name: 'Normalization', exact: true })
    .selectOption('ratio');
  await page
    .getByRole('combobox', { name: 'Price scale', exact: true })
    .selectOption('log');
  await page.getByRole('button', { name: 'Compare', exact: true }).tap();
  await page.getByRole('button', { name: 'Add comparison', exact: true }).tap();
  const chart = page.getByRole('group', {
    name: 'Chart workspace',
    exact: true,
  });
  await expect(chart).toHaveAttribute('data-chart-normalization', 'ratio');
  await expect(chart).toHaveAttribute('data-chart-scale', 'log');
  await expect(chart).toHaveAttribute('data-comparison-ticker', 'SPY');
  await noHorizontalOverflow(page);
  await page
    .getByRole('button', { name: 'Remove comparison', exact: true })
    .tap();
  await expect(chart).not.toHaveAttribute('data-comparison-ticker', 'SPY');
  expect(await savedSession(page)).toEqual(before);
});

test('the indicator sheet scrolls to editable settings and applies a period with touch controls', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Indicators', exact: true }).tap();
  await page
    .getByRole('textbox', { name: 'Search indicators', exact: true })
    .fill('Relative Strength');
  await page
    .getByRole('button', { name: 'Add Relative Strength Index', exact: true })
    .tap();
  const period = page.getByRole('spinbutton', {
    name: 'Period for Relative Strength Index',
    exact: true,
  });
  await period.tap();
  expect(
    await period.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(16);
  await period.fill('5');
  await page
    .getByRole('form', { name: 'Active indicator 1', exact: true })
    .getByRole('button', { name: 'Apply', exact: true })
    .tap();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).tap();
  await expect(page.getByTestId('indicator-chip')).toContainText('RSI (5)');
  await expect(
    page.getByRole('group', { name: 'Chart workspace', exact: true }),
  ).toHaveAttribute('data-indicator-panes', '1');
  await noHorizontalOverflow(page);
});

test('two touch anchors create a selectable drawing that can be deleted', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Trend line', exact: true }).tap();
  await tapChart(page, 0.3, 0.4);
  await tapChart(page, 0.7, 0.6);
  const drawing = page.locator('[data-drawing-tool="trendline"]');
  await expect(drawing).toHaveCount(1);
  const [saved] = await savedDrawings(page);
  expect(saved.points).toHaveLength(2);
  expect(saved.points[0].time).not.toBe(saved.points[1].time);
  await touchTarget(page.getByTestId('drawing-handle-0'));
  await tapChart(page, 0.15, 0.8);
  const remove = page.getByRole('button', {
    name: 'Delete selected drawing',
    exact: true,
  });
  await expect(remove).toBeDisabled();
  const line = await drawing.locator('line').first().boundingBox();
  await page.touchscreen.tap(
    line!.x + line!.width / 2,
    line!.y + line!.height / 2,
  );
  await expect(remove).toBeEnabled();
  await page
    .getByRole('button', { name: 'Delete selected drawing', exact: true })
    .tap();
  await expect(drawing).toHaveCount(0);
  expect(await savedDrawings(page)).toEqual([]);
  await expect(page.locator('html')).toHaveAttribute(
    'data-trusted-touch',
    'true',
  );
});

test('an interrupted touch drawing clears its pending anchor without committing a phantom shape', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Trend line', exact: true }).tap();
  await tapChart(page, 0.3, 0.4);
  await expect(page.getByTestId('drawing-preview')).toHaveCount(1);
  // DOM-level regression for an OS cancellation; the preceding tap is trusted.
  await page
    .getByRole('region', { name: 'Drawing canvas', exact: true })
    .dispatchEvent('pointercancel', {
      pointerType: 'touch',
      pointerId: 1,
      bubbles: true,
    });
  await expect(page.getByTestId('drawing-preview')).toHaveCount(0);
  expect(await savedDrawings(page)).toEqual([]);
  await tapChart(page, 0.4, 0.4);
  await tapChart(page, 0.65, 0.55);
  await expect(page.locator('[data-drawing-tool="trendline"]')).toHaveCount(1);
  expect(await savedDrawings(page)).toHaveLength(1);
});

test('DOM touch events pan the chart horizontally without moving saved drawing anchors', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Trend line', exact: true }).tap();
  await tapChart(page, 0.3, 0.4);
  await tapChart(page, 0.6, 0.55);
  const drawing = page.locator('[data-drawing-tool="trendline"]');
  const line = drawing.locator('line').first();
  const originalX = await line.getAttribute('x1');
  const saved = await savedDrawings(page);
  const surface = page.getByTestId('drawing-surface');
  await surface.evaluate((element) =>
    element.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'instant',
    }),
  );
  const bounds = await surface.boundingBox();
  // Playwright exposes trusted taps but no public WebKit swipe API. This
  // sequence tests browser event routing; it does not simulate OS arbitration.
  await page.evaluate(
    async (start) => {
      const target = document.elementFromPoint(start.x, start.y)!;
      const emit = (type: string, x: number) => {
        // WebKit exposes its legacy Touch factory, but disallows new Touch().
        const touchDocument = document as Document & {
          createTouchList: (...touches: Touch[]) => TouchList;
          createTouch: (
            view: Window,
            target: EventTarget,
            id: number,
            pageX: number,
            pageY: number,
            screenX: number,
            screenY: number,
          ) => Touch;
        };
        const touch = touchDocument.createTouch(
          window,
          target,
          77,
          x + scrollX,
          start.y + scrollY,
          x,
          start.y,
        );
        // WebKit's initializer requires TouchList rather than a JavaScript array.
        const active = touchDocument.createTouchList(
          ...(type === 'touchend' ? [] : [touch]),
        ) as unknown as Touch[];
        const changed = touchDocument.createTouchList(
          touch,
        ) as unknown as Touch[];
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: active,
            targetTouches: active,
            changedTouches: changed,
          }),
        );
      };
      emit('touchstart', start.x);
      for (let step = 1; step <= 6; step += 1) {
        emit('touchmove', start.x + step * 10);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      emit('touchend', start.x + 60);
    },
    {
      x: bounds!.x + bounds!.width * 0.65,
      y: bounds!.y + bounds!.height * 0.75,
    },
  );
  await expect.poll(() => line.getAttribute('x1')).not.toBe(originalX);
  expect(await savedDrawings(page)).toEqual(saved);
});

test('DOM pointer cancellation handles lost capture and multiple touches without saving a drawing', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).tap();
  const surface = page.getByTestId('drawing-surface');
  await surface.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  const bounds = await surface.boundingBox();
  const canvas = page.getByRole('region', {
    name: 'Drawing canvas',
    exact: true,
  });
  const primary = {
    pointerType: 'touch',
    pointerId: 71,
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: bounds!.x + bounds!.width * 0.3,
    clientY: bounds!.y + bounds!.height * 0.3,
    bubbles: true,
  };
  // These cancellation branches are DOM-level event regressions, distinct from
  // the trusted taps used to create and edit drawings in the other journeys.
  for (const interruption of ['lost capture', 'multiple touches']) {
    await canvas.dispatchEvent('pointerdown', primary);
    await expect(page.getByTestId('drawing-preview')).toHaveCount(1);
    if (interruption === 'lost capture') {
      await canvas.dispatchEvent('lostpointercapture', primary);
    } else {
      const secondary = {
        ...primary,
        pointerId: 72,
        isPrimary: false,
        clientX: primary.clientX + 40,
      };
      await canvas.dispatchEvent('pointerdown', secondary);
      await canvas.dispatchEvent('pointerup', { ...primary, buttons: 0 });
      await canvas.dispatchEvent('pointerup', { ...secondary, buttons: 0 });
    }
    await expect(page.getByTestId('drawing-preview')).toHaveCount(0);
    expect(await savedDrawings(page)).toEqual([]);
  }
  await tapChart(page, 0.3, 0.4);
  await tapChart(page, 0.6, 0.6);
  await expect(page.locator('[data-drawing-tool="rectangle"]')).toHaveCount(1);
});

test('tapping the replay track advances history and requires confirmation before rewinding', async ({
  page,
}) => {
  const initial = await savedSession(page);
  const timeline = page.getByRole('slider', {
    name: 'Replay timeline',
    exact: true,
  });
  await timeline.scrollIntoViewIfNeeded();
  let bounds = await timeline.boundingBox();
  await timeline.tap({
    position: { x: bounds!.width * 0.75, y: bounds!.height / 2 },
  });
  await expect
    .poll(async () => (await savedSession(page)).cursor)
    .toBeGreaterThan(initial.cursor);
  const advanced = await savedSession(page);
  bounds = await timeline.boundingBox();
  await timeline.tap({
    position: { x: bounds!.width * 0.2, y: bounds!.height / 2 },
  });
  await expect(
    page.getByRole('dialog', { name: 'A new starting point.' }),
  ).toBeVisible();
  expect(await savedSession(page)).toEqual(advanced);
  await page
    .getByRole('button', { name: 'Reset account & replay', exact: true })
    .tap();
  expect((await savedSession(page)).cursor).toBeLessThan(advanced.cursor);
});

test('a touched workspace restores its position, normalization and drawing after reload', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Go to order ticket', exact: true })
    .tap();
  await page.getByRole('button', { name: /^Buy AAPL/ }).tap();
  await page
    .getByRole('button', {
      name: 'Next candle from mobile toolbar',
      exact: true,
    })
    .tap();
  await page
    .getByRole('combobox', { name: 'Normalization', exact: true })
    .selectOption('ratio');
  await page
    .getByRole('button', { name: 'Horizontal line', exact: true })
    .tap();
  await tapChart(page, 0.4, 0.4);
  const before = await savedSession(page);
  const drawings = await savedDrawings(page);
  await page.reload();
  await expect(page.getByText('LONG', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Normalization', exact: true }),
  ).toHaveValue('ratio');
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(1);
  expect(await savedSession(page)).toEqual(before);
  expect(await savedDrawings(page)).toEqual(drawings);
});

test('safe-area padding keeps mobile dock actions inside simulated landscape insets', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty('--safe-top', '0px');
    style.setProperty('--safe-bottom', '34px');
    style.setProperty('--safe-left', '47px');
    style.setProperty('--safe-right', '47px');
  });
  for (const label of [
    'Go to chart',
    'Go to performance',
    'Next candle from mobile toolbar',
  ]) {
    const button = page.getByRole('button', { name: label, exact: true });
    const bounds = await button.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(47);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(844 - 47);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(390 - 34);
  }
  await page
    .getByRole('button', {
      name: 'Next candle from mobile toolbar',
      exact: true,
    })
    .tap();
  await noHorizontalOverflow(page);
});

test('the chart expands and exits using a portable touch overlay', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Fullscreen chart', exact: true })
    .tap();
  const close = page.getByRole('button', {
    name: 'Exit fullscreen chart',
    exact: true,
  });
  await touchTarget(close);
  const panel = await page.locator('.chart-panel').boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(844);
  await close.tap();
  await expect(close).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Next candle from mobile toolbar',
      exact: true,
    }),
  ).toBeVisible();
});

test('the native pause event stops mobile playback before background time advances', async ({
  page,
}) => {
  await page.clock.install();
  await page
    .getByRole('button', { name: 'Play from mobile toolbar', exact: true })
    .tap();
  await page.clock.fastForward(1100);
  await page.evaluate(() => window.dispatchEvent(new Event('replay:pause')));
  await expect(
    page.getByRole('button', { name: 'Play from mobile toolbar', exact: true }),
  ).toBeVisible();
  const paused = await savedSession(page);
  await page.clock.fastForward(5000);
  expect((await savedSession(page)).cursor).toBe(paused.cursor);
  await page
    .getByRole('button', { name: 'Play from mobile toolbar', exact: true })
    .tap();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(
    page.getByRole('button', { name: 'Play from mobile toolbar', exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(5000);
  expect((await savedSession(page)).cursor).toBe(paused.cursor);
});

test('touch export sends the session CSV to the native WebView bridge', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const context = window as unknown as {
      webkit: {
        messageHandlers: {
          replayExport: { postMessage: (payload: unknown) => void };
        };
      };
      replayNativeExports: unknown[];
    };
    context.replayNativeExports = [];
    Object.defineProperty(window, 'webkit', {
      configurable: true,
      value: {
        messageHandlers: {
          replayExport: {
            postMessage: (payload: unknown) =>
              context.replayNativeExports.push(payload),
          },
        },
      },
    });
  });
  await page.reload();
  await page
    .getByRole('button', { name: 'Go to order ticket', exact: true })
    .tap();
  await page.getByRole('button', { name: /^Buy AAPL/ }).tap();
  await page
    .getByRole('button', {
      name: 'Next candle from mobile toolbar',
      exact: true,
    })
    .tap();
  await page.getByRole('button', { name: 'Close position', exact: true }).tap();
  await page.getByRole('button', { name: 'Export session', exact: true }).tap();
  const exported = await page.evaluate(
    () =>
      (
        window as unknown as {
          replayNativeExports: {
            filename: string;
            mimeType: string;
            content: string;
          }[];
        }
      ).replayNativeExports,
  );
  expect(exported).toHaveLength(1);
  expect(exported[0].filename).toMatch(/^replay-AAPL-.*\.csv$/);
  expect(exported[0].mimeType).toBe('text/csv;charset=utf-8;');
  expect(exported[0].content).toContain('"order-1","buy","market","10"');
  expect(exported[0].content).toContain('"order-2","sell","market","10"');
  expect(exported[0].content).toContain('"Equity date (UTC)","Equity"');
});

import type { Page } from '@playwright/test';
import {
  expect,
  openData,
  savedSession,
  test,
  yahooFixture,
} from './helpers/workspace';

type StoredDrawing = {
  id: string;
  tool: string;
  points: { time: number; price: number }[];
  color: string;
  text?: string;
};

async function annotations(page: Page): Promise<StoredDrawing[]> {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('replay-chart-workspace:v1') || '{}')
        .drawings?.['demo:AAPL:1d'] || [],
  );
}

async function point(page: Page, x: number, y: number) {
  const drawingSurface = page.getByTestId('drawing-surface');
  // Mouse coordinates do not auto-scroll like locator.click(). Keep the full
  // price pane on screen before measuring, including after toolbar growth.
  await drawingSurface.scrollIntoViewIfNeeded();
  const surface = await drawingSurface.boundingBox();
  expect(surface).not.toBeNull();
  const target = {
    x: surface!.x + surface!.width * x,
    y: surface!.y + surface!.height * y,
  };
  const viewport = page.viewportSize()!;
  expect(target.x).toBeGreaterThanOrEqual(0);
  expect(target.x).toBeLessThan(viewport.width);
  expect(target.y).toBeGreaterThanOrEqual(0);
  expect(target.y).toBeLessThan(viewport.height);
  return target;
}

async function clickPoint(page: Page, x: number, y: number) {
  const target = await point(page, x, y);
  await page.mouse.click(target.x, target.y);
}

async function draw(page: Page, label: string, count = 2) {
  await page
    .getByRole('toolbar', { name: 'Drawing tools' })
    .getByRole('button', { name: label, exact: true })
    .click();
  await clickPoint(page, 0.3, 0.35);
  if (count >= 2) await clickPoint(page, 0.55, 0.55);
  if (count === 3) await clickPoint(page, 0.4, 0.65);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('toolbar', { name: 'Drawing tools' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Drawing canvas' }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.getByTestId('drawing-surface').boundingBox())?.height || 0,
    )
    .toBeGreaterThan(100);
});

for (const [tool, label, count] of [
  ['trendline', 'Trend line', 2],
  ['ray', 'Ray', 2],
  ['extended', 'Extended line', 2],
  ['horizontal', 'Horizontal line', 1],
  ['vertical', 'Vertical line', 1],
  ['rectangle', 'Rectangle', 2],
  ['ellipse', 'Ellipse', 2],
  ['channel', 'Parallel channel', 3],
  ['fib', 'Fibonacci retracement', 2],
  ['arrow', 'Arrow', 2],
  ['text', 'Text', 1],
  ['measure', 'Measure', 2],
] as const) {
  test(`${label} creates a saved annotation using historical time and price anchors`, async ({
    page,
  }) => {
    const before = await savedSession(page);
    await draw(page, label, count);
    if (tool === 'text') {
      await expect(
        page.getByRole('textbox', { name: 'Text annotation' }),
      ).toBeFocused();
      await page
        .getByRole('textbox', { name: 'Text annotation' })
        .fill('Watch this breakout');
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
    }
    await expect(page.locator(`[data-drawing-tool="${tool}"]`)).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Cursor', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await annotations(page)).length).toBe(1);
    const [drawing] = await annotations(page);
    expect(drawing.tool).toBe(tool);
    expect(drawing.points).toHaveLength(count);
    for (const anchor of drawing.points) {
      expect(anchor.time).toBeGreaterThanOrEqual(before.market.bars[0].time);
      expect(anchor.time).toBeLessThanOrEqual(
        before.market.bars[before.cursor].time,
      );
      expect(Number.isFinite(anchor.price)).toBe(true);
    }
    if (tool === 'text')
      await expect(
        page.getByText('Watch this breakout', { exact: true }),
      ).toBeVisible();
    if (tool === 'fib')
      await expect(page.locator('[data-drawing-tool="fib"]')).toContainText(
        '61.8%',
      );
    if (tool === 'measure')
      await expect(page.locator('[data-drawing-tool="measure"]')).toContainText(
        '%',
      );
    expect(await savedSession(page)).toEqual(before);
  });
}

test('drag placement, endpoint editing, and moving a whole drawing each produce an undoable edit', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Trend line', exact: true }).click();
  const start = await point(page, 0.25, 0.3);
  const end = await point(page, 0.5, 0.5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-drawing-tool="trendline"]')).toHaveCount(1);
  const initial = await annotations(page);

  const handle = await page.getByTestId('drawing-handle-1').boundingBox();
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(end.x + 35, end.y - 25, { steps: 5 });
  await page.mouse.up();
  const edited = await annotations(page);
  expect(edited[0].points[0]).toEqual(initial[0].points[0]);
  expect(edited[0].points[1]).not.toEqual(initial[0].points[1]);
  await page.getByRole('button', { name: 'Undo drawing', exact: true }).click();
  expect(await annotations(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Redo drawing', exact: true }).click();
  expect(await annotations(page)).toEqual(edited);

  const middle = {
    x: (start.x + end.x + 35) / 2,
    y: (start.y + end.y - 25) / 2,
  };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 25, middle.y + 20, { steps: 5 });
  await page.mouse.up();
  const moved = await annotations(page);
  expect(moved[0].points[0]).not.toEqual(edited[0].points[0]);
  expect(moved[0].points[1]).not.toEqual(edited[0].points[1]);
  expect(moved[0].points[1].price - moved[0].points[0].price).toBeCloseTo(
    edited[0].points[1].price - edited[0].points[0].price,
    7,
  );
  await page.getByRole('button', { name: 'Undo drawing', exact: true }).click();
  expect(await annotations(page)).toEqual(edited);
});

test('annotations follow chart pan and zoom and restore their anchors after reload', async ({
  page,
}) => {
  await draw(page, 'Trend line');
  const before = await annotations(page);
  const line = page.locator('[data-drawing-tool="trendline"] line').first();
  const originalX = await line.getAttribute('x1');
  const position = await point(page, 0.65, 0.8);
  await page.mouse.move(position.x, position.y);
  await page.mouse.down();
  await page.mouse.move(position.x + 70, position.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => line.getAttribute('x1')).not.toBe(originalX);
  const pannedX = await line.getAttribute('x1');
  await page.mouse.wheel(0, -300);
  await expect.poll(() => line.getAttribute('x1')).not.toBe(pannedX);
  expect(await annotations(page)).toEqual(before);

  await page.reload();
  await expect(page.locator('[data-drawing-tool="trendline"]')).toHaveCount(1);
  expect(await annotations(page)).toEqual(before);
});

test('color changes, undo, redo, keyboard deletion, and clearing control the saved drawings', async ({
  page,
}) => {
  await draw(page, 'Horizontal line', 1);
  await page.getByLabel('Drawing color', { exact: true }).fill('#ff8844');
  await expect(
    page.locator('[data-drawing-tool="horizontal"] g').first(),
  ).toHaveAttribute('stroke', '#ff8844');
  const colored = await annotations(page);
  expect(colored[0].color).toBe('#ff8844');
  await page
    .getByRole('button', { name: 'Delete selected drawing', exact: true })
    .click();
  await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo drawing', exact: true }).click();
  await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  expect(await annotations(page)).toEqual(colored);
  await page.getByRole('button', { name: 'Redo drawing', exact: true }).click();
  await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo drawing', exact: true }).click();
  await page
    .getByRole('button', { name: 'Horizontal line drawing', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo drawing', exact: true }).click();
  await page
    .getByRole('button', { name: 'Clear drawings', exact: true })
    .click();
  await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  expect(await annotations(page)).toEqual([]);
});

test('Escape cancels an unfinished drawing and text entry without saving either', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Trend line', exact: true }).click();
  await clickPoint(page, 0.3, 0.3);
  const end = await point(page, 0.6, 0.6);
  await page.mouse.move(end.x, end.y);
  await expect(page.getByTestId('drawing-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drawing-preview')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Cursor', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await draw(page, 'Text', 1);
  await page
    .getByRole('textbox', { name: 'Text annotation' })
    .fill('Do not save');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('textbox', { name: 'Text annotation' }),
  ).toHaveCount(0);
  expect(await annotations(page)).toEqual([]);
});

test('rewinding hides annotations anchored in unrevealed history and reveals them again later', async ({
  page,
}) => {
  await draw(page, 'Rectangle');
  const before = await annotations(page);
  await page
    .getByRole('slider', { name: 'Replay timeline', exact: true })
    .focus();
  await page.keyboard.press('Home');
  await page
    .getByRole('button', { name: 'Reset account & replay', exact: true })
    .click();
  await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  expect(await annotations(page)).toEqual(before);
  await page
    .getByRole('slider', { name: 'Replay timeline', exact: true })
    .focus();
  await page.keyboard.press('End');
  await expect(page.locator('[data-drawing-tool="rectangle"]')).toHaveCount(1);
  expect(await annotations(page)).toEqual(before);
});

test('a narrow workspace keeps drawing tools usable and saves a placed shape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await draw(page, 'Rectangle');
  await expect(page.locator('[data-drawing-tool="rectangle"]')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  expect((await annotations(page))[0].points).toHaveLength(2);
});

test('adding and removing an oscillator keeps drawings aligned and editable on the price pane', async ({
  page,
}) => {
  await draw(page, 'Trend line');
  const saved = await annotations(page);
  await page.getByRole('button', { name: 'Indicators', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add Relative Strength Index', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await expect(
    page.getByRole('group', { name: 'Chart workspace', exact: true }),
  ).toHaveAttribute('data-indicator-panes', '1');
  await expect(page.locator('[data-drawing-tool="trendline"]')).toHaveCount(1);
  expect(await annotations(page)).toEqual(saved);
  const surface = await page.getByTestId('drawing-surface').boundingBox();
  const lowerPane = await page.locator('[data-pane="1"]').boundingBox();
  expect(lowerPane!.y).toBeGreaterThanOrEqual(surface!.y + surface!.height);
  for (const index of [0, 1]) {
    const handle = await page
      .getByTestId(`drawing-handle-${index}`)
      .boundingBox();
    expect(handle!.y + handle!.height / 2).toBeGreaterThan(surface!.y);
    expect(handle!.y + handle!.height / 2).toBeLessThan(
      surface!.y + surface!.height,
    );
  }

  await page
    .getByRole('button', {
      name: 'Remove Relative Strength Index (14)',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('group', { name: 'Chart workspace', exact: true }),
  ).toHaveAttribute('data-indicator-panes', '0');
  expect(await annotations(page)).toEqual(saved);
  const handle = await page.getByTestId('drawing-handle-1').boundingBox();
  const center = {
    x: handle!.x + handle!.width / 2,
    y: handle!.y + handle!.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 20, center.y - 15, { steps: 5 });
  await page.mouse.up();
  const edited = await annotations(page);
  expect(edited[0].points[0]).toEqual(saved[0].points[0]);
  expect(edited[0].points[1]).not.toEqual(saved[0].points[1]);
  await expect(page.locator('[data-drawing-tool="trendline"]')).toHaveCount(1);
});

test('drawings are isolated by market and return when the sample market is restored', async ({
  page,
}) => {
  await draw(page, 'Rectangle');
  const saved = await annotations(page);
  await page.route('**/api/market-data?**', (route) =>
    route.fulfill({ json: yahooFixture() }),
  );
  await openData(page);
  await page
    .getByRole('textbox', { name: 'Ticker symbol', exact: true })
    .fill('MSFT');
  await page
    .getByRole('combobox', { name: 'Candle interval', exact: true })
    .selectOption('15m');
  await page
    .getByRole('button', { name: 'Load & start replay', exact: true })
    .click();
  await expect(page.getByText('YAHOO FINANCE', { exact: true })).toBeVisible();
  await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  expect(await annotations(page)).toEqual(saved);
  await draw(page, 'Horizontal line', 1);
  const microsoft = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('replay-chart-workspace:v1') || '{}')
        .drawings['yfinance:MSFT:15m'],
  );
  expect(microsoft).toHaveLength(1);

  await openData(page);
  await page
    .getByRole('button', { name: 'Explore with synthetic sample data' })
    .click();
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  await expect(page.locator('[data-drawing-tool="rectangle"]')).toHaveCount(1);
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(0);
  expect(await annotations(page)).toEqual(saved);
  const restoredMicrosoft = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('replay-chart-workspace:v1') || '{}')
        .drawings['yfinance:MSFT:15m'],
  );
  expect(restoredMicrosoft).toEqual(microsoft);
});

test('resetting replay cancels an unfinished drawing before accepting an anchor at the new candle', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Trend line', exact: true }).click();
  await clickPoint(page, 0.4, 0.4);
  const target = await point(page, 0.6, 0.6);
  await page.mouse.move(target.x, target.y);
  await expect(page.getByTestId('drawing-preview')).toBeVisible();
  await page
    .getByRole('button', { name: 'Restart replay', exact: true })
    .click();
  await page
    .getByRole('slider', { name: 'Replay starting candle', exact: true })
    .focus();
  await page.keyboard.press('Home');
  await page
    .getByRole('button', { name: 'Reset account & replay', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Cursor', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('drawing-preview')).toHaveCount(0);
  expect(await annotations(page)).toEqual([]);
  await draw(page, 'Horizontal line', 1);
  const session = await savedSession(page);
  const [drawing] = await annotations(page);
  expect(session.cursor).toBe(0);
  expect(drawing.points[0].time).toBe(session.market.bars[0].time);
  await expect(page.locator('[data-drawing-tool="horizontal"]')).toHaveCount(1);
});

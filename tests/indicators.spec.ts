import type { Page } from '@playwright/test';
import {
  computeIndicator,
  INDICATORS,
  type IndicatorId,
  type IndicatorInstance,
} from '../src/lib/indicators';
import type { Candle } from '../src/lib/engine';
import {
  buy,
  expect,
  openData,
  savedSession,
  test,
  yahooFixture,
} from './helpers/workspace';

const WORKSPACE_KEY = 'replay-chart-workspace:v1';

async function activeIndicators(page: Page): Promise<IndicatorInstance[]> {
  return page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key) || '{"indicators":[]}').indicators,
    WORKSPACE_KEY,
  );
}

async function openIndicators(page: Page) {
  await page.getByRole('button', { name: 'Indicators', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Indicators', exact: true }),
  ).toBeVisible();
}

async function addIndicator(page: Page, id: IndicatorId) {
  const definition = INDICATORS.find((item) => item.id === id)!;
  await page
    .getByRole('button', { name: `Add ${definition.name}`, exact: true })
    .click();
}

async function closeMenu(page: Page) {
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

async function assertRenderedValues(
  page: Page,
  instance: IndicatorInstance,
  revealed: Candle[],
) {
  const definition = INDICATORS.find(
    (item) => item.id === instance.indicatorId,
  )!;
  const group = page.locator(
    `.chart-indicator-values [data-indicator-id="${instance.id}"]`,
  );
  await expect(group).toBeVisible();
  await expect(group).toContainText(definition.shortName);
  const expected = computeIndicator(instance, revealed);
  const allWarming = expected.every((plot) => plot.data.length === 0);
  if (allWarming) {
    await expect(group).toContainText('Warming up');
    await expect(group.locator('[data-value]')).toHaveCount(0);
    return;
  }
  // Numeric readings come from the same series values rendered on the chart,
  // while unit tests independently verify each indicator's formulas.
  await expect(group.locator('[data-plot-key]')).toHaveCount(expected.length);
  for (const plot of expected) {
    const reading = group.locator(`[data-plot-key="${plot.key}"]`);
    const last = plot.data.at(-1);
    if (!last) {
      await expect(reading).toHaveText('—');
      continue;
    }
    await expect(reading).toHaveAttribute('data-value', String(last.value));
    await expect(reading).toHaveAttribute('data-time', String(last.time));
    expect(last.time).toBeLessThanOrEqual(revealed.at(-1)!.time);
    await expect(reading).not.toContainText(/NaN|Infinity/);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('SAMPLE DATA', { exact: true })).toBeVisible();
  await expect.poll(async () => (await savedSession(page))?.cursor).toBe(90);
});

test('the catalog exposes all 50 studies, category filters, and name search', async ({
  page,
}) => {
  await openIndicators(page);
  const catalog = page.locator('.indicator-catalog');
  await expect(page.locator('.indicator-result-count')).toHaveText(
    '50 indicators',
  );
  await expect(catalog.getByRole('button')).toHaveCount(50);
  for (const category of [
    'Trend',
    'Momentum',
    'Volatility',
    'Volume',
  ] as const) {
    await page.getByRole('button', { name: category, exact: true }).click();
    await expect(catalog.getByRole('button')).toHaveCount(
      INDICATORS.filter((item) => item.category === category).length,
    );
  }
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search indicators', exact: true })
    .fill('rsi');
  await expect(
    page.getByRole('button', {
      name: 'Add Relative Strength Index',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add Stochastic RSI', exact: true }),
  ).toBeVisible();
  await expect(catalog.getByRole('button')).toHaveCount(2);
  await page
    .getByRole('textbox', { name: 'Search indicators', exact: true })
    .fill('no-such-study');
  await expect(
    page.getByText('No matching indicators. Try another name.', {
      exact: true,
    }),
  ).toBeVisible();
});

for (const definition of INDICATORS) {
  test(`${definition.name} renders only revealed values, advances, and safely rewinds`, async ({
    page,
  }) => {
    await openIndicators(page);
    await addIndicator(page, definition.id);
    await closeMenu(page);
    const [instance] = await activeIndicators(page);
    expect(instance.indicatorId).toBe(definition.id);
    const initial = await savedSession(page);
    await expect(page.locator('.market-chart')).toHaveAttribute(
      'data-indicator-panes',
      definition.pane === 'oscillator' ? '1' : '0',
    );
    await assertRenderedValues(
      page,
      instance,
      initial.market.bars.slice(0, initial.cursor + 1),
    );

    await page
      .getByRole('button', { name: 'Next candle', exact: true })
      .click();
    await expect(
      page.getByRole('slider', { name: 'Replay timeline', exact: true }),
    ).toHaveValue('91');
    await assertRenderedValues(
      page,
      instance,
      initial.market.bars.slice(0, 92),
    );

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
      page.getByRole('slider', { name: 'Replay timeline', exact: true }),
    ).toHaveValue('0');
    await assertRenderedValues(page, instance, initial.market.bars.slice(0, 1));
    expect((await activeIndicators(page))[0]).toEqual(instance);
  });
}

test('duplicate studies have independent periods and colors, persist, and remove independently', async ({
  page,
}) => {
  await openIndicators(page);
  await addIndicator(page, 'sma');
  await addIndicator(page, 'sma');
  await addIndicator(page, 'rsi');
  const first = page.getByRole('form', {
    name: 'Active indicator 1',
    exact: true,
  });
  const second = page.getByRole('form', {
    name: 'Active indicator 2',
    exact: true,
  });
  await first
    .getByRole('spinbutton', {
      name: 'Period for Simple Moving Average',
      exact: true,
    })
    .fill('7');
  await first.getByRole('button', { name: 'Apply', exact: true }).click();
  await second
    .getByRole('spinbutton', {
      name: 'Period for Simple Moving Average',
      exact: true,
    })
    .fill('34');
  await second.getByRole('button', { name: 'Apply', exact: true }).click();
  await first
    .getByLabel('Color for Simple Moving Average', { exact: true })
    .evaluate((element: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(element, '#22cc88');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await expect
    .poll(async () => (await activeIndicators(page))[0].color)
    .toBe('#22cc88');
  await first
    .getByRole('spinbutton', {
      name: 'Period for Simple Moving Average',
      exact: true,
    })
    .fill('0');
  await first.getByRole('button', { name: 'Apply', exact: true }).click();
  expect((await activeIndicators(page))[0].period).toBe(7);
  await closeMenu(page);
  const configured = await activeIndicators(page);
  expect(configured.map((item) => item.period)).toEqual([7, 34, 14]);
  expect(new Set(configured.map((item) => item.id)).size).toBe(3);
  const session = await savedSession(page);
  for (const instance of configured)
    await assertRenderedValues(
      page,
      instance,
      session.market.bars.slice(0, session.cursor + 1),
    );
  const firstLabel = page.locator(
    `.chart-indicator-values [data-indicator-id="${configured[0].id}"]`,
  );
  await expect(firstLabel.locator('[data-value]')).toHaveCSS(
    'color',
    'rgb(34, 204, 136)',
  );

  await page.reload();
  await expect(page.locator('.indicator-chip')).toHaveCount(3);
  expect(await activeIndicators(page)).toEqual(configured);
  await expect(page.locator('.market-chart')).toHaveAttribute(
    'data-indicator-panes',
    '1',
  );
  await page
    .getByRole('button', {
      name: 'Remove Simple Moving Average (7)',
      exact: true,
    })
    .click();
  await expect(page.locator('.indicator-chip')).toHaveCount(2);
  expect((await activeIndicators(page)).map((item) => item.id)).toEqual([
    configured[1].id,
    configured[2].id,
  ]);
  await expect(
    page.locator(
      `.chart-indicator-values [data-indicator-id="${configured[0].id}"]`,
    ),
  ).toHaveCount(0);
  await assertRenderedValues(
    page,
    configured[1],
    session.market.bars.slice(0, session.cursor + 1),
  );
});

test('removing a middle oscillator retains the remaining panes, readings, and paper trades', async ({
  page,
}) => {
  await buy(page, 10);
  const before = await savedSession(page);
  await openIndicators(page);
  for (const id of ['rsi', 'macd', 'adx', 'sma'] as const)
    await addIndicator(page, id);
  await closeMenu(page);
  await expect(page.locator('.market-chart')).toHaveAttribute(
    'data-indicator-panes',
    '3',
  );
  const indicators = await activeIndicators(page);
  for (let index = 0; index < 3; index++) {
    await expect(
      page.locator(
        `.chart-indicator-values [data-indicator-id="${indicators[index].id}"]`,
      ),
    ).toHaveAttribute('data-pane', String(index + 1));
  }

  await page
    .getByRole('button', {
      name: 'Remove Moving Average Convergence Divergence (12)',
      exact: true,
    })
    .click();
  await expect(page.locator('.market-chart')).toHaveAttribute(
    'data-indicator-panes',
    '2',
  );
  await expect(
    page.locator(
      `.chart-indicator-values [data-indicator-id="${indicators[2].id}"]`,
    ),
  ).toHaveAttribute('data-pane', '2');
  expect(await savedSession(page)).toEqual(before);
  for (const instance of [indicators[0], indicators[2], indicators[3]]) {
    await assertRenderedValues(
      page,
      instance,
      before.market.bars.slice(0, before.cursor + 1),
    );
  }
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  const stepped = await savedSession(page);
  expect(stepped.account.position.quantity).toBe(10);
  expect(stepped.account.orders).toEqual(before.account.orders);
  for (const instance of [indicators[0], indicators[2]]) {
    await assertRenderedValues(
      page,
      instance,
      stepped.market.bars.slice(0, stepped.cursor + 1),
    );
  }
  await openIndicators(page);
  await page.getByRole('button', { name: 'Remove all', exact: true }).click();
  await closeMenu(page);
  await expect(page.locator('.market-chart')).toHaveAttribute(
    'data-indicator-panes',
    '0',
  );
  await expect(page.locator('.chart-indicator-values')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Close position', exact: true }),
  ).toBeVisible();
});

test('short history displays warm-up states without carrying old indicator values forward', async ({
  page,
}) => {
  await openIndicators(page);
  for (const id of ['sma', 'rsi', 'macd'] as const)
    await addIndicator(page, id);
  await closeMenu(page);
  const fixture = yahooFixture();
  fixture.bars = fixture.bars.slice(0, 2);
  await page.route('**/api/market-data?**', (route) =>
    route.fulfill({ json: fixture }),
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
  await expect(
    page
      .locator('.chart-indicator-values')
      .getByText('Warming up', { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.locator('.chart-indicator-values [data-value]'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Next candle', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Next candle', exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .locator('.chart-indicator-values')
      .getByText('Warming up', { exact: true }),
  ).toHaveCount(3);
  await expect(page.locator('.market-chart')).toHaveAttribute(
    'data-indicator-panes',
    '2',
  );
});

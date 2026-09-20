import { expect, it, vi } from 'vitest';
import type { ISeriesApi, SeriesAttachedParameter } from 'lightweight-charts';
import { ComparisonAxisLabel } from './ComparisonAxisLabel';

it('renders normalized benchmark text at its rebased coordinate and follows scale changes', () => {
  const priceToCoordinate = vi.fn((value: number) => value * 2);
  const label = new ComparisonAxisLabel({
    priceToCoordinate,
  } as unknown as ISeriesApi<'Line'>);
  const requestUpdate = vi.fn();
  label.attached({ requestUpdate } as unknown as SeriesAttachedParameter);
  const [view] = label.priceAxisViews();
  expect(view.visible()).toBe(false);
  label.update(235.69, 'SPY +6.00%', '#ffcc00');
  expect(view.text()).toBe('SPY +6.00%');
  expect(view.coordinate()).toBeCloseTo(471.38);
  expect(view.backColor()).toBe('#ffcc00');
  expect(view.visible()).toBe(true);
  expect(requestUpdate).toHaveBeenCalledOnce();
  priceToCoordinate.mockImplementation((value) => value * 3);
  expect(view.coordinate()).toBeCloseTo(707.07);
  label.update(null, '', '#ffcc00');
  expect(view.visible()).toBe(false);
  label.detached();
  requestUpdate.mockClear();
  label.update(200, 'QQQ +2.00%', '#ffffff');
  expect(requestUpdate).not.toHaveBeenCalled();
});

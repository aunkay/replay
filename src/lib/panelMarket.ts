import { defaultPeriod, type MarketData } from './data';

/** Match the API's retention limits without copying an incompatible daily range. */
export function panelMarketRequest(
  market: MarketData,
  ticker: string,
  interval: string,
  now = Date.now(),
): Record<string, string> {
  const extended: Record<string, string> = market.extendedHours
    ? { extendedHours: 'true' }
    : {};
  // Rolling base requests still have a concrete loaded snapshot. Use that
  // span, not an unrelated "last month" window that can miss the replay clock.
  const request = market.request?.start
    ? market.request
    : market.source === 'yfinance' && market.bars.length
      ? {
          start: new Date(market.bars[0].time * 1000)
            .toISOString()
            .slice(0, 10),
          end: new Date((market.bars.at(-1)!.time + 86400) * 1000)
            .toISOString()
            .slice(0, 10),
        }
      : market.request;
  if (!request?.start || !request.end)
    return { ...extended, ticker, interval, period: defaultPeriod(interval) };
  const intraday = [
    '1m',
    '2m',
    '5m',
    '15m',
    '30m',
    '60m',
    '1h',
    '90m',
  ].includes(interval);
  if (!intraday)
    return {
      ...extended,
      ticker,
      interval,
      start: request.start,
      end: request.end,
    };
  const day = 86400000;
  const today = Math.floor(now / day) * day;
  const retention =
    interval === '1m' ? 30 : ['60m', '1h'].includes(interval) ? 730 : 60;
  const end = Math.min(Date.parse(request.end), today + day);
  // Stay inside the rolling provider cutoff rather than requesting midnight
  // on its oldest day (which can be older than the exact retention timestamp).
  const start = Math.max(
    Date.parse(request.start),
    today - (retention - 1) * day,
    interval === '1m' ? end - 7 * day : -Infinity,
  );
  if (start >= end)
    throw new Error(
      `Different chart intervals are supported, but Yahoo only provides ${interval} history for the last ${retention} days. Load a more recent base-chart date range to replay these intervals together.`,
    );
  return {
    ...extended,
    ticker,
    interval,
    start: new Date(start).toISOString().slice(0, 10),
    end: new Date(end).toISOString().slice(0, 10),
  };
}

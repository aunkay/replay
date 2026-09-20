import type { EquityPoint } from './engine';

/** UTC end-of-day marks include idle cash and costs; weekly/monthly data keep their native marks. */
export function strategyPerformance(points: EquityPoint[], tradingDays = 252) {
  const daily = new Map<number, number>();
  for (const point of points)
    daily.set(Math.floor(point.time / 86400), point.equity);
  const marks = [...daily.entries()].sort((a, b) => a[0] - b[0]);
  const gaps = marks
    .slice(1)
    .map((p, i) => p[0] - marks[i][0])
    .sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)] ?? 1;
  const periodsPerYear = gap >= 25 ? 12 : gap >= 5 ? 52 : tradingDays;
  const sampling = gap >= 25 ? 'monthly' : gap >= 5 ? 'weekly' : 'UTC daily';
  // Preserve the initial capital mark when the run starts intraday. Otherwise
  // resampling would discard the first partial day's P&L and transaction costs.
  if (
    points.length > 1 &&
    Math.floor(points[1].time / 86400) === Math.floor(points[0].time / 86400)
  )
    marks.unshift([marks[0][0] - 1, points[0].equity]);
  const returns = marks.slice(1).map((p, i) => p[1] / marks[i][1] - 1);
  const valid = marks.every((p) => Number.isFinite(p[1]) && p[1] > 0);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const sharpe =
    valid && returns.length >= 2 && variance > 1e-20
      ? (mean / Math.sqrt(variance)) * Math.sqrt(periodsPerYear)
      : null;
  return {
    sharpe,
    periodsPerYear,
    sampling,
    observations: returns.length,
    riskFreeRate: 0,
    note: 'Annualized sample Sharpe; zero cash/risk-free return. UTC daily marks including the first partial day (native weekly/monthly for coarse data). Square-root scaling assumes uncorrelated returns. N/A for insufficient data, nonpositive equity or zero variance.',
  };
}

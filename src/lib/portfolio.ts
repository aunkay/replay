import {
  advanceBar,
  cancelOrder,
  closePosition,
  createAccount,
  submitOrder,
  type Candle,
  type EngineConfig,
  type EquityPoint,
  type OrderRequest,
  type TradingState,
} from './engine';

export type PortfolioAsset = {
  ticker: string;
  currency: string;
  bar: Candle;
  account: TradingState;
};
export type Portfolio = {
  config: EngineConfig;
  currency: string;
  cash: number;
  assets: PortfolioAsset[];
  equityHistory: EquityPoint[];
};

/** One cash ledger; instrument accounts hold positions and execution histories. */
function assertBar(bar: Candle) {
  const observed = advanceBar(
    createAccount({ initialCapital: 1, commissionBps: 0, slippageBps: 0 }),
    bar,
  );
  if (!observed.equityHistory.length)
    throw new Error('Invalid portfolio candle.');
}

export function createPortfolio(
  ticker: string,
  currency: string,
  bar: Candle,
  account: TradingState,
): Portfolio {
  assertBar(bar);
  return markPortfolio({
    config: account.config,
    currency,
    cash: account.cash,
    assets: [{ ticker, currency, bar, account }],
    equityHistory: [...account.equityHistory],
  });
}

export function portfolioMetrics(portfolio: Portfolio) {
  let marketValue = 0,
    exposure = 0,
    unrealizedPnl = 0,
    realizedPnl = 0,
    feesPaid = 0,
    borrowingPaid = 0;
  for (const asset of portfolio.assets) {
    const { quantity, averagePrice } = asset.account.position;
    marketValue += quantity * asset.bar.close;
    exposure += Math.abs(quantity) * asset.bar.close;
    unrealizedPnl += quantity * (asset.bar.close - averagePrice);
    realizedPnl += asset.account.realizedPnl;
    feesPaid += asset.account.feesPaid;
    borrowingPaid += asset.account.borrowingPaid ?? 0;
  }
  const equity = portfolio.cash + marketValue;
  let peak = portfolio.config.initialCapital,
    maxDrawdown = 0;
  for (const point of [...portfolio.equityHistory, { equity }]) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.max(maxDrawdown, (100 * (peak - point.equity)) / peak);
  }
  return {
    cash: portfolio.cash,
    equity,
    marketValue,
    exposure,
    unrealizedPnl,
    realizedPnl,
    feesPaid,
    borrowingPaid,
    buyingPower: Math.max(0, equity - exposure),
    totalPnl: equity - portfolio.config.initialCapital,
    returnPct: 100 * (equity / portfolio.config.initialCapital - 1),
    maxDrawdown,
  };
}

function markPortfolio(portfolio: Portfolio): Portfolio {
  const time = Math.max(...portfolio.assets.map((a) => a.bar.time));
  const point = { time, equity: portfolioMetrics(portfolio).equity };
  const history = portfolio.equityHistory;
  return {
    ...portfolio,
    equityHistory:
      history.at(-1)?.time === time
        ? [...history.slice(0, -1), point]
        : [...history, point],
  };
}

export function addPortfolioAsset(
  portfolio: Portfolio,
  ticker: string,
  currency: string,
  bar: Candle,
): Portfolio {
  assertBar(bar);
  if (portfolio.assets.some((a) => a.ticker === ticker)) return portfolio;
  if (portfolio.assets.length >= 6)
    throw new Error('A portfolio supports six tickers.');
  if (currency !== portfolio.currency)
    throw new Error(
      'Portfolio tickers must use the same currency; currency conversion is not available.',
    );
  if (!ticker.trim()) throw new Error('Ticker is required.');
  if (bar.time > Math.max(...portfolio.assets.map((a) => a.bar.time)))
    throw new Error('Cannot add a ticker from the future.');
  const account = advanceBar(createAccount(portfolio.config), bar);
  return markPortfolio({
    ...portfolio,
    assets: [...portfolio.assets, { ticker, currency, bar, account }],
  });
}

function applyToAsset(
  portfolio: Portfolio,
  ticker: string,
  operation: (account: TradingState, bar: Candle) => TradingState,
): Portfolio {
  const asset = portfolio.assets.find((a) => a.ticker === ticker);
  if (!asset) throw new Error('Ticker is not in this portfolio.');
  let marketValue = 0,
    exposure = 0;
  for (const other of portfolio.assets)
    if (other.ticker !== ticker) {
      marketValue += other.account.position.quantity * other.bar.close;
      exposure += Math.abs(other.account.position.quantity) * other.bar.close;
    }
  const result = operation(
    {
      ...asset.account,
      cash: portfolio.cash,
      capitalContext: { marketValue, exposure },
    },
    asset.bar,
  );
  // Instrument ledgers retain their own P&L history using a virtual starting
  // capital. Only portfolio.cash is spendable; these ledgers are never summed.
  // Remove the transient context and undo the shared-cash substitution in any
  // equity points changed by the execution engine.
  const offset = asset.account.cash - portfolio.cash;
  const oldPoints = new Set(asset.account.equityHistory);
  const { capitalContext: _context, ...account } = result;
  return {
    ...portfolio,
    cash: result.cash,
    assets: portfolio.assets.map((a) =>
      a.ticker === ticker
        ? {
            ...a,
            account: {
              ...account,
              cash: result.cash + offset,
              equityHistory: result.equityHistory.map((point) =>
                oldPoints.has(point)
                  ? point
                  : { ...point, equity: point.equity + offset },
              ),
            },
          }
        : a,
    ),
  };
}

function assertCurrentQuote(portfolio: Portfolio, ticker: string) {
  const asset = portfolio.assets.find((a) => a.ticker === ticker);
  if (!asset) throw new Error('Ticker is not in this portfolio.');
  if (asset.bar.time < Math.max(...portfolio.assets.map((a) => a.bar.time)))
    throw new Error(
      'This ticker has no candle at the current replay time. Advance to a fresh quote before trading.',
    );
}

export function submitPortfolioOrder(
  portfolio: Portfolio,
  ticker: string,
  request: OrderRequest,
): Portfolio {
  assertCurrentQuote(portfolio, ticker);
  return markPortfolio(
    applyToAsset(portfolio, ticker, (account, bar) =>
      submitOrder(account, request, bar),
    ),
  );
}

export function closePortfolioPosition(
  portfolio: Portfolio,
  ticker: string,
): Portfolio {
  assertCurrentQuote(portfolio, ticker);
  return markPortfolio(applyToAsset(portfolio, ticker, closePosition));
}

export function cancelPortfolioOrder(
  portfolio: Portfolio,
  ticker: string,
  id: string,
): Portfolio {
  return applyToAsset(portfolio, ticker, (account) => cancelOrder(account, id));
}

/** Process candles chronologically. Simultaneous fills compete in ticker order.
 * Other tickers are marked at their previous observed close during execution;
 * a future close is never used to grant buying power to an earlier fill.
 */
export function advancePortfolio(
  portfolio: Portfolio,
  updates: { ticker: string; bar: Candle }[],
): Portfolio {
  let next = portfolio;
  const sorted = [...updates].sort(
    (a, b) => a.bar.time - b.bar.time || a.ticker.localeCompare(b.ticker),
  );
  const clock = Math.max(...portfolio.assets.map((a) => a.bar.time));
  for (const update of sorted) {
    assertBar(update.bar);
    const asset = next.assets.find((a) => a.ticker === update.ticker);
    if (!asset) throw new Error('Ticker is not in this portfolio.');
    if (update.bar.time <= asset.bar.time || update.bar.time < clock) continue;
    next = applyToAsset(next, update.ticker, (account) =>
      advanceBar(account, update.bar),
    );
    next = {
      ...next,
      assets: next.assets.map((a) =>
        a.ticker === update.ticker ? { ...a, bar: update.bar } : a,
      ),
    };
    next = markPortfolio(next);
  }
  return next;
}

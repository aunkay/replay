/**
 * Deterministic, single-instrument paper trading.
 *
 * Market orders execute at the currently revealed candle's close. Pending limit
 * and stop orders may execute only on a later candle. Gaps execute at the open
 * when that is the first available price. Market and stop fills include adverse
 * slippage; limit fills never exceed the submitted limit. This is an OHLC model:
 * a candle cannot tell us the sequence of its intrabar trades.
 */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type EngineConfig = {
  initialCapital: number;
  commissionBps: number;
  slippageBps: number;
};
export type Order = {
  id: string;
  side: Side;
  type: OrderType;
  quantity: number;
  price?: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  createdAt: number;
  filledAt?: number;
  fillPrice?: number;
  fee?: number;
  /** Set only for fills that close shares; net of this fill's commission. */
  realizedPnl?: number;
  reason?: string;
};
export type Position = { quantity: number; averagePrice: number };
export type EquityPoint = { time: number; equity: number };
export type TradingState = {
  config: EngineConfig;
  cash: number;
  position: Position;
  orders: Order[];
  equityHistory: EquityPoint[];
  realizedPnl: number;
  feesPaid: number;
};
export type OrderRequest = Pick<Order, 'side' | 'type' | 'quantity' | 'price'>;
export type TradingMetrics = {
  equity: number;
  cash: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  /** Percentage points, e.g. 5 means +5%. */
  returnPct: number;
  exposure: number;
  buyingPower: number;
  feesPaid: number;
  /** Percentage of profitable closing fills, e.g. 50 means 50%. */
  winRate: number;
  closedTrades: number;
  /** Peak-to-trough equity drawdown, expressed as a positive percentage. */
  maxDrawdown: number;
};

const finitePositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

function validBar(bar: Candle): boolean {
  return (
    Number.isFinite(bar.time) &&
    finitePositive(bar.open) &&
    finitePositive(bar.high) &&
    finitePositive(bar.low) &&
    finitePositive(bar.close) &&
    bar.low <= Math.min(bar.open, bar.close) &&
    bar.high >= Math.max(bar.open, bar.close) &&
    bar.low <= bar.high &&
    Number.isFinite(bar.volume) &&
    bar.volume >= 0
  );
}

function latestTime(state: TradingState): number | undefined {
  return state.equityHistory.at(-1)?.time;
}

function withEquity(state: TradingState, bar: Candle): TradingState {
  const equity = state.cash + state.position.quantity * bar.close;
  if (!Number.isFinite(equity)) return state;
  const point = { time: bar.time, equity };
  const last = state.equityHistory.at(-1);
  if (last && last.time > bar.time) return state;
  const equityHistory =
    last?.time === bar.time
      ? [...state.equityHistory.slice(0, -1), point]
      : [...state.equityHistory, point];
  return { ...state, equityHistory };
}

export function createAccount(config: EngineConfig): TradingState {
  if (!finitePositive(config.initialCapital)) {
    throw new Error(
      'Initial capital must be a finite number greater than zero.',
    );
  }
  if (
    !Number.isFinite(config.commissionBps) ||
    config.commissionBps < 0 ||
    config.commissionBps > 10_000
  ) {
    throw new Error('Commission must be between 0 and 10,000 basis points.');
  }
  if (
    !Number.isFinite(config.slippageBps) ||
    config.slippageBps < 0 ||
    config.slippageBps >= 10_000
  ) {
    throw new Error(
      'Slippage must be at least 0 and less than 10,000 basis points.',
    );
  }
  return {
    config: { ...config },
    cash: config.initialCapital,
    position: { quantity: 0, averagePrice: 0 },
    orders: [],
    equityHistory: [],
    realizedPnl: 0,
    feesPaid: 0,
  };
}

function replaceOrder(state: TradingState, updated: Order): TradingState {
  return {
    ...state,
    orders: state.orders.map((order) =>
      order.id === updated.id ? updated : order,
    ),
  };
}

function rejectOrder(
  state: TradingState,
  order: Order,
  reason: string,
): TradingState {
  return replaceOrder(state, { ...order, status: 'rejected', reason });
}

function executeOrder(
  state: TradingState,
  order: Order,
  basePrice: number,
  time: number,
): TradingState {
  const direction = order.side === 'buy' ? 1 : -1;
  const slippage =
    order.type === 'limit' ? 0 : state.config.slippageBps / 10_000;
  const fillPrice = basePrice * (1 + direction * slippage);
  const notional = order.quantity * fillPrice;
  const fee = notional * (state.config.commissionBps / 10_000);
  const oldQuantity = state.position.quantity;
  const signedQuantity = direction * order.quantity;
  const rawQuantity = oldQuantity + signedQuantity;
  const roundingTolerance =
    Number.EPSILON * Math.max(Math.abs(oldQuantity), order.quantity) * 8;
  const quantity = Math.abs(rawQuantity) <= roundingTolerance ? 0 : rawQuantity;
  const cash = state.cash - signedQuantity * fillPrice - fee;
  // Mark at the execution price for the 1x exposure check. Short proceeds do
  // not grant extra buying power: equity remains cash + signed market value.
  const equityAtFill = cash + quantity * fillPrice;
  const exposureAtFill = Math.abs(quantity) * fillPrice;
  if (
    ![
      fillPrice,
      notional,
      fee,
      quantity,
      cash,
      equityAtFill,
      exposureAtFill,
    ].every(Number.isFinite)
  ) {
    return rejectOrder(
      state,
      order,
      'Order value exceeds the supported numeric range.',
    );
  }
  const reducing =
    oldQuantity !== 0 &&
    Math.sign(oldQuantity) !== direction &&
    (quantity === 0 ||
      (Math.sign(quantity) === Math.sign(oldQuantity) &&
        Math.abs(quantity) < Math.abs(oldQuantity)));
  const capitalTolerance = Math.max(1, Math.abs(equityAtFill)) * 1e-10;
  if (!reducing && exposureAtFill > equityAtFill + capitalTolerance) {
    return rejectOrder(
      state,
      order,
      'Insufficient buying power: this account is limited to 1× exposure.',
    );
  }

  const closesShares =
    oldQuantity !== 0 && Math.sign(oldQuantity) !== direction;
  const closedQuantity = closesShares
    ? Math.min(Math.abs(oldQuantity), order.quantity)
    : 0;
  const grossRealized =
    closedQuantity *
    (fillPrice - state.position.averagePrice) *
    Math.sign(oldQuantity);
  let averagePrice: number;
  if (quantity === 0) {
    averagePrice = 0;
  } else if (
    oldQuantity === 0 ||
    Math.sign(quantity) !== Math.sign(oldQuantity)
  ) {
    averagePrice = fillPrice;
  } else if (Math.sign(oldQuantity) === direction) {
    const addedWeight = order.quantity / Math.abs(quantity);
    averagePrice =
      state.position.averagePrice * (1 - addedWeight) + fillPrice * addedWeight;
  } else {
    averagePrice = state.position.averagePrice;
  }
  const realizedPnl = state.realizedPnl + grossRealized - fee;
  const feesPaid = state.feesPaid + fee;
  if (
    ![averagePrice, grossRealized, realizedPnl, feesPaid].every(Number.isFinite)
  ) {
    return rejectOrder(
      state,
      order,
      'Order value exceeds the supported numeric range.',
    );
  }

  const filled: Order = {
    ...order,
    status: 'filled',
    filledAt: time,
    fillPrice,
    fee,
    ...(closedQuantity > 0 ? { realizedPnl: grossRealized - fee } : {}),
  };
  return replaceOrder(
    {
      ...state,
      cash,
      position: { quantity, averagePrice },
      realizedPnl,
      feesPaid,
    },
    filled,
  );
}

/** Returns a new state; the submitted order is the final entry in `orders`. */
export function submitOrder(
  state: TradingState,
  request: OrderRequest,
  bar: Candle,
): TradingState {
  const barIsValid = validBar(bar);
  const previousTime = latestTime(state);
  let reason: string | undefined;
  if (request.side !== 'buy' && request.side !== 'sell')
    reason = 'Order side must be buy or sell.';
  else if (!['market', 'limit', 'stop'].includes(request.type))
    reason = 'Unsupported order type.';
  else if (!finitePositive(request.quantity))
    reason = 'Quantity must be a finite number greater than zero.';
  else if (request.type !== 'market' && !finitePositive(request.price ?? NaN))
    reason = 'Limit and stop orders require a price greater than zero.';
  else if (!barIsValid)
    reason = 'The current candle contains invalid market data.';
  else if (previousTime !== undefined && bar.time < previousTime)
    reason =
      'Cannot submit orders on an earlier candle; reset the account to rewind.';

  const order: Order = {
    id: `order-${state.orders.length + 1}`,
    side: request.side,
    type: request.type,
    quantity: Number.isFinite(request.quantity) ? request.quantity : 0,
    ...(request.type !== 'market' && Number.isFinite(request.price)
      ? { price: request.price }
      : {}),
    status: reason ? 'rejected' : 'pending',
    createdAt: barIsValid ? bar.time : (previousTime ?? 0),
    ...(reason ? { reason } : {}),
  };
  let next = { ...state, orders: [...state.orders, order] };
  if (!reason && request.type === 'market')
    next = executeOrder(next, order, bar.close, bar.time);
  if (barIsValid && (previousTime === undefined || bar.time >= previousTime))
    next = withEquity(next, bar);
  return next;
}

/**
 * Reveal one candle and process eligible pending orders in submission order.
 * Earlier/invalid candles are ignored, so state cannot silently trade backward.
 */
export function advanceBar(state: TradingState, bar: Candle): TradingState {
  const previousTime = latestTime(state);
  if (!validBar(bar) || (previousTime !== undefined && bar.time < previousTime))
    return state;
  let next = state;
  for (const order of state.orders) {
    if (order.status !== 'pending' || order.createdAt >= bar.time) continue;
    let basePrice: number | undefined;
    const target = order.price;
    if (target === undefined) continue;
    if (order.type === 'limit') {
      if (order.side === 'buy' && bar.low <= target)
        basePrice = Math.min(bar.open, target);
      if (order.side === 'sell' && bar.high >= target)
        basePrice = Math.max(bar.open, target);
    } else if (order.type === 'stop') {
      if (order.side === 'buy' && bar.high >= target)
        basePrice = Math.max(bar.open, target);
      if (order.side === 'sell' && bar.low <= target)
        basePrice = Math.min(bar.open, target);
    }
    if (basePrice !== undefined)
      next = executeOrder(next, order, basePrice, bar.time);
  }
  return withEquity(next, bar);
}

export function cancelOrder(state: TradingState, id: string): TradingState {
  const order = state.orders.find((candidate) => candidate.id === id);
  return order?.status === 'pending'
    ? replaceOrder(state, { ...order, status: 'cancelled' })
    : state;
}

export function closePosition(state: TradingState, bar: Candle): TradingState {
  const quantity = state.position.quantity;
  if (quantity === 0) return state;
  return submitOrder(
    state,
    {
      side: quantity > 0 ? 'sell' : 'buy',
      type: 'market',
      quantity: Math.abs(quantity),
    },
    bar,
  );
}

export function getMetrics(
  state: TradingState,
  currentPrice: number,
): TradingMetrics {
  const { quantity, averagePrice } = state.position;
  const lastEquity = state.equityHistory.at(-1)?.equity;
  const lastPrice =
    quantity !== 0 && lastEquity !== undefined
      ? (lastEquity - state.cash) / quantity
      : averagePrice;
  const price =
    finitePositive(currentPrice) && Number.isFinite(quantity * currentPrice)
      ? currentPrice
      : finitePositive(lastPrice)
        ? lastPrice
        : averagePrice;
  const equity = state.cash + quantity * price;
  const unrealizedPnl = quantity * (price - averagePrice);
  const totalPnl = equity - state.config.initialCapital;
  const exposure = Math.abs(quantity) * price;
  const closingOrders = state.orders.filter(
    (order) => order.status === 'filled' && order.realizedPnl !== undefined,
  );
  const winningOrders = closingOrders.filter(
    (order) => (order.realizedPnl ?? 0) > 0,
  ).length;
  let peak = state.config.initialCapital;
  let maxDrawdown = 0;
  for (const value of [
    ...state.equityHistory.map((point) => point.equity),
    equity,
  ]) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, ((peak - value) / peak) * 100);
  }
  return {
    equity,
    cash: state.cash,
    unrealizedPnl,
    realizedPnl: state.realizedPnl,
    totalPnl,
    returnPct: (totalPnl / state.config.initialCapital) * 100,
    exposure,
    buyingPower: Math.max(0, equity - exposure),
    feesPaid: state.feesPaid,
    winRate: closingOrders.length
      ? (winningOrders / closingOrders.length) * 100
      : 0,
    closedTrades: closingOrders.length,
    maxDrawdown,
  };
}

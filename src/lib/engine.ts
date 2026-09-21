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
  endTime?: number;
  complete?: boolean;
  session?: 'premarket' | 'regular' | 'afterhours' | null;
};

export type DynamicProtection = {
  trailing?: { mode: 'price' | 'percent' | 'atr'; distance: number };
  breakEvenPct?: number;
};
export type ProfitTarget = { price: number; percent: number };

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type EngineConfig = {
  initialCapital: number;
  commissionBps: number;
  slippageBps: number;
  spreadBps?: number;
  borrowAprPct?: number;
  volumeParticipationPct?: number;
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
  executionTime?: number;
  fillPrice?: number;
  fee?: number;
  /** Set only for fills that close shares; net of this fill's commission. */
  realizedPnl?: number;
  reason?: string;
  stopLoss?: number;
  takeProfit?: number;
  takeProfits?: ProfitTarget[];
  dynamicProtection?: DynamicProtection;
  parentId?: string;
  role?: 'stopLoss' | 'takeProfit';
  reduceOnly?: boolean;
  ambiguous?: boolean;
  plannedRisk?: number;
  continuationOf?: string;
  queuedMarket?: boolean;
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
  recentBars?: Candle[];
  liquidity?: { time: number; remaining: number };
  borrowingPaid?: number;
  financing?: { time: number; amount: number; tradeId: string }[];
  positionTradeId?: string;
  lastBorrowTime?: number;
  executionClock?: { base: number; end: number };
  executionCoverage?: { fine: number; fallback: number };
  dynamicProtection?: DynamicProtection;
};
export type OrderRequest = Pick<
  Order,
  | 'side'
  | 'type'
  | 'quantity'
  | 'price'
  | 'stopLoss'
  | 'takeProfit'
  | 'takeProfits'
  | 'dynamicProtection'
  | 'plannedRisk'
>;
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

export function withEquity(state: TradingState, bar: Candle): TradingState {
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
  for (const [key, max] of [
    ['spreadBps', 10000],
    ['borrowAprPct', 1000],
    ['volumeParticipationPct', 100],
  ] as const) {
    const value = config[key];
    if (
      value !== undefined &&
      (!Number.isFinite(value) ||
        value < 0 ||
        (value >= max && key === 'spreadBps') ||
        value > max)
    )
      throw new Error(`${key} must be between 0 and ${max}.`);
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

function executeFill(
  state: TradingState,
  order: Order,
  basePrice: number,
  time: number,
): TradingState {
  const direction = order.side === 'buy' ? 1 : -1;
  const slippage =
    order.type === 'limit' ? 0 : state.config.slippageBps / 10_000;
  const spread = (state.config.spreadBps ?? 0) / 20000;
  const rawPrice = basePrice * (1 + direction * (slippage + spread));
  const fillPrice =
    order.type === 'limit'
      ? order.side === 'buy'
        ? Math.min(order.price!, rawPrice)
        : Math.max(order.price!, rawPrice)
      : rawPrice;
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
      positionTradeId:
        quantity === 0
          ? undefined
          : oldQuantity === 0 || Math.sign(oldQuantity) !== Math.sign(quantity)
            ? order.id
            : state.positionTradeId,
      realizedPnl,
      feesPaid,
    },
    filled,
  );
}

function currentTradeId(state: TradingState) {
  let quantity = 0,
    id = '';
  for (const o of state.orders
    .filter((o) => o.status === 'filled')
    .sort(
      (a, b) =>
        (a.executionTime ?? a.filledAt!) - (b.executionTime ?? b.filledAt!),
    )) {
    const next = quantity + (o.side === 'buy' ? o.quantity : -o.quantity);
    if (quantity === 0 || Math.sign(next) !== Math.sign(quantity)) id = o.id;
    quantity = next;
  }
  return id;
}

function prepareLiquidity(state: TradingState, bar: Candle): TradingState {
  const participation = state.config.volumeParticipationPct;
  if (participation === undefined || participation === 0) return state;
  if (state.liquidity?.time === bar.time) return state;
  return {
    ...state,
    liquidity: {
      time: bar.time,
      remaining: (bar.volume * participation) / 100,
    },
  };
}
function executeOrder(
  state: TradingState,
  order: Order,
  price: number,
  time: number,
): TradingState {
  if (!state.config.volumeParticipationPct)
    return executeFullOrder(state, order, price, time);
  const available =
    state.liquidity?.time === time ? state.liquidity.remaining : 0;
  if (available <= 1e-10)
    return order.type === 'market' || order.type === 'stop'
      ? replaceOrder(state, { ...order, type: 'market', queuedMarket: true })
      : state;
  const quantity = Math.min(order.quantity, available);
  let next = executeFullOrder(state, { ...order, quantity }, price, time);
  const fill = next.orders.find((o) => o.id === order.id);
  if (fill?.status !== 'filled') return next;
  next = {
    ...next,
    liquidity: { time, remaining: Math.max(0, available - fill.quantity) },
  };
  const remaining = order.reduceOnly
    ? Math.min(order.quantity - fill.quantity, Math.abs(next.position.quantity))
    : order.quantity - fill.quantity;
  if (remaining > 1e-10) {
    const continuation: Order = {
      ...order,
      id: `order-${next.orders.length + 1}`,
      quantity: remaining,
      status: 'pending',
      createdAt: time,
      continuationOf: order.continuationOf ?? order.id,
    };
    if (order.type === 'stop' || order.type === 'market') {
      continuation.type = 'market';
      continuation.queuedMarket = true;
    }
    next = { ...next, orders: [...next.orders, continuation] };
  }
  return next;
}

function executeFullOrder(
  state: TradingState,
  order: Order,
  price: number,
  time: number,
): TradingState {
  if (order.reduceOnly) {
    if (
      !state.position.quantity ||
      Math.sign(state.position.quantity) === (order.side === 'buy' ? 1 : -1)
    )
      return cancelOrder(state, order.id);
    order = {
      ...order,
      quantity: Math.min(order.quantity, Math.abs(state.position.quantity)),
    };
  }
  let next = executeFill(state, order, price, time);
  if (next.orders.find((o) => o.id === order.id)?.status !== 'filled')
    return next;
  const replaced =
    order.stopLoss !== undefined ||
    order.takeProfit !== undefined ||
    Boolean(order.takeProfits?.length);
  if (
    !next.position.quantity ||
    (state.position.quantity &&
      Math.sign(state.position.quantity) !== Math.sign(next.position.quantity))
  )
    next = { ...next, dynamicProtection: undefined };
  if (order.dynamicProtection && !order.reduceOnly)
    next = {
      ...next,
      dynamicProtection: structuredClone(order.dynamicProtection),
    };
  const reversed =
    Math.sign(state.position.quantity) !== Math.sign(next.position.quantity);
  next = {
    ...next,
    orders: next.orders.map((o) =>
      o.status === 'pending' && o.reduceOnly
        ? !next.position.quantity ||
          (order.reduceOnly && order.role !== 'takeProfit') ||
          replaced ||
          reversed
          ? { ...o, status: 'cancelled' as const }
          : {
              ...o,
              quantity:
                o.role === 'takeProfit'
                  ? Math.min(o.quantity, Math.abs(next.position.quantity))
                  : Math.abs(next.position.quantity),
            }
        : o,
    ),
  };
  if (next.position.quantity && replaced && !order.reduceOnly) {
    const children: Order[] = [];
    for (const role of ['stopLoss', 'takeProfit'] as const) {
      if (order[role] === undefined) continue;
      children.push({
        id: `order-${next.orders.length + children.length + 1}`,
        side: next.position.quantity > 0 ? 'sell' : 'buy',
        type: role === 'stopLoss' ? 'stop' : 'limit',
        quantity: Math.abs(next.position.quantity),
        price: order[role],
        status: 'pending',
        createdAt: time,
        parentId: order.id,
        role,
        reduceOnly: true,
      });
    }
    for (const target of order.takeProfits ?? []) {
      children.push({
        id: `order-${next.orders.length + children.length + 1}`,
        side: next.position.quantity > 0 ? 'sell' : 'buy',
        type: 'limit',
        quantity: (Math.abs(next.position.quantity) * target.percent) / 100,
        price: target.price,
        status: 'pending',
        createdAt: time,
        parentId: order.id,
        role: 'takeProfit',
        reduceOnly: true,
      });
    }
    next = { ...next, orders: [...next.orders, ...children] };
  }
  return next;
}

/** Replace protection prospectively without changing the position. */
export function editBracket(
  state: TradingState,
  stopLoss: number | undefined,
  takeProfit: number | undefined,
  bar: Candle,
): TradingState {
  if (!state.position.quantity)
    throw new Error('Open a position before editing protection.');
  validateProtection(
    state.position.quantity > 0 ? 'buy' : 'sell',
    bar.close,
    stopLoss,
    takeProfit,
  );
  let next = {
    ...state,
    orders: state.orders.map((o) =>
      o.reduceOnly && o.status === 'pending'
        ? { ...o, status: 'cancelled' as const }
        : o,
    ),
  };
  for (const role of ['stopLoss', 'takeProfit'] as const) {
    const price = role === 'stopLoss' ? stopLoss : takeProfit;
    if (price !== undefined)
      next = {
        ...next,
        orders: [
          ...next.orders,
          {
            id: `order-${next.orders.length + 1}`,
            side: state.position.quantity > 0 ? 'sell' : 'buy',
            type: role === 'stopLoss' ? 'stop' : 'limit',
            quantity: Math.abs(state.position.quantity),
            price,
            createdAt: bar.time,
            status: 'pending',
            role,
            reduceOnly: true,
          },
        ],
      };
  }
  return next;
}

function validateProtection(
  side: Side,
  entry: number,
  stop?: number,
  target?: number,
) {
  const direction = side === 'buy' ? 1 : -1;
  if (
    stop !== undefined &&
    (!finitePositive(stop) || (entry - stop) * direction <= 0)
  )
    throw new Error('Stop-loss must be beyond the entry on the loss side.');
  if (
    target !== undefined &&
    (!finitePositive(target) || (target - entry) * direction <= 0)
  )
    throw new Error('Take-profit must be beyond the entry on the profit side.');
}

function processProtection(
  state: TradingState,
  bar: Candle,
  parentId?: string,
  allowTarget = true,
  includeCurrent = false,
): TradingState {
  const candidates = state.orders.filter(
    (o) =>
      o.status === 'pending' &&
      o.reduceOnly &&
      (parentId
        ? o.parentId === parentId
        : o.createdAt < bar.time ||
          (includeCurrent && o.createdAt === bar.time)),
  );
  const touched = candidates.filter((o) =>
    o.type === 'market'
      ? true
      : o.type === 'stop'
        ? o.side === 'sell'
          ? bar.low <= o.price!
          : bar.high >= o.price!
        : allowTarget &&
          (o.side === 'sell'
            ? bar.high * (1 - (state.config.spreadBps ?? 0) / 20000) >= o.price!
            : bar.low * (1 + (state.config.spreadBps ?? 0) / 20000) <=
              o.price!),
  );
  const chosen = touched.find((o) => o.role === 'stopLoss') ?? touched[0];
  if (!chosen) return state;
  const price =
    chosen.type === 'market'
      ? bar.open
      : chosen.type === 'stop'
        ? chosen.side === 'sell'
          ? Math.min(bar.open, chosen.price!)
          : Math.max(bar.open, chosen.price!)
        : chosen.side === 'sell'
          ? Math.max(bar.open, chosen.price!)
          : Math.min(bar.open, chosen.price!);
  const next = executeOrder(
    state,
    {
      ...chosen,
      ambiguous:
        (touched.some((o) => o.type === 'stop') &&
          touched.some((o) => o.type === 'limit')) ||
        Boolean(parentId && !allowTarget),
    },
    price,
    bar.time,
  );
  // A stopped position never also takes profits on the same ambiguous candle.
  return next !== state && chosen.type === 'limit' && next.position.quantity
    ? processProtection(next, bar, parentId, allowTarget, includeCurrent)
    : next;
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

  if (!reason) {
    try {
      if (request.dynamicProtection) {
        const { trailing, breakEvenPct } = request.dynamicProtection;
        if (breakEvenPct !== undefined && !finitePositive(breakEvenPct))
          throw new Error('Break-even activation must be positive.');
        if (
          trailing &&
          (!['price', 'percent', 'atr'].includes(trailing.mode) ||
            !finitePositive(trailing.distance) ||
            (trailing.mode === 'percent' && trailing.distance >= 100))
        )
          throw new Error(
            'Choose a valid positive trailing distance (percentage below 100).',
          );
      }
      if (request.takeProfits !== undefined) {
        if (
          !Array.isArray(request.takeProfits) ||
          request.takeProfits.length > 3 ||
          (request.takeProfits.length && request.takeProfit !== undefined)
        )
          throw new Error(
            'Use either one take-profit or up to three target levels.',
          );
        let total = 0;
        const prices = new Set<number>();
        for (const target of request.takeProfits) {
          if (
            !target ||
            !finitePositive(target.percent) ||
            target.percent > 100 ||
            prices.has(target.price)
          )
            throw new Error(
              'Targets require distinct prices and positive allocations.',
            );
          validateProtection(
            request.side,
            request.type === 'market' ? bar.close : request.price!,
            undefined,
            target.price,
          );
          prices.add(target.price);
          total += target.percent;
        }
        if (total > 100 + 1e-8)
          throw new Error('Target allocations cannot exceed 100%.');
      }
      validateProtection(
        request.side,
        request.type === 'market' ? bar.close : request.price!,
        request.stopLoss,
        request.takeProfit,
      );
    } catch (error) {
      reason = (error as Error).message;
    }
    if (
      state.position.quantity &&
      Math.sign(state.position.quantity) ===
        (request.side === 'buy' ? 1 : -1) &&
      state.orders.some((o) => o.reduceOnly && o.status === 'pending') &&
      request.stopLoss === undefined &&
      request.takeProfit === undefined &&
      !request.takeProfits?.length
    )
      reason =
        'Provide replacement protection levels when scaling into a protected position.';
  }
  const order: Order = {
    ...(!reason && request.dynamicProtection
      ? { dynamicProtection: structuredClone(request.dynamicProtection) }
      : {}),
    ...(!reason && request.takeProfits?.length
      ? { takeProfits: request.takeProfits.map((t) => ({ ...t })) }
      : {}),
    ...(request.stopLoss !== undefined ? { stopLoss: request.stopLoss } : {}),
    ...(request.takeProfit !== undefined
      ? { takeProfit: request.takeProfit }
      : {}),
    ...(request.plannedRisk !== undefined
      ? { plannedRisk: request.plannedRisk }
      : {}),
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
  let next = prepareLiquidity(
    { ...state, orders: [...state.orders, order] },
    bar,
  );
  if (!reason && request.type === 'market')
    next = executeOrder(next, order, bar.close, bar.time);
  if (barIsValid && (previousTime === undefined || bar.time >= previousTime)) {
    if (!reason && request.type === 'market') {
      next = updateDynamicProtection(next, bar);
      if (state.executionClock?.base === bar.time)
        next = {
          ...next,
          orders: next.orders.map((o) =>
            o.status === 'filled' &&
            !state.orders.some((old) => old.id === o.id)
              ? { ...o, executionTime: state.executionClock!.end }
              : o,
          ),
        };
    }
    next = withEquity(next, bar);
  }
  return next;
}

/**
 * Reveal one candle and process eligible pending orders in submission order.
 * Earlier/invalid candles are ignored, so state cannot silently trade backward.
 */
export function advanceBar(
  state: TradingState,
  bar: Candle,
  protectionAtOpen = false,
  deferDynamic = false,
): TradingState {
  const previousTime = latestTime(state);
  if (!validBar(bar) || (previousTime !== undefined && bar.time < previousTime))
    return state;
  let prepared = prepareLiquidity(state, bar);
  if (
    state.position.quantity < 0 &&
    previousTime !== undefined &&
    bar.time > (state.lastBorrowTime ?? previousTime) &&
    state.config.borrowAprPct
  ) {
    const mark = state.recentBars?.at(-1)?.close ?? state.position.averagePrice;
    const cost =
      (((Math.abs(state.position.quantity) * mark * state.config.borrowAprPct) /
        100) *
        (bar.time - (state.lastBorrowTime ?? previousTime))) /
      (365 * 86400);
    prepared = {
      ...prepared,
      cash: prepared.cash - cost,
      realizedPnl: prepared.realizedPnl - cost,
      borrowingPaid: (prepared.borrowingPaid ?? 0) + cost,
      financing: [
        ...(prepared.financing ?? []),
        {
          time: bar.time,
          amount: cost,
          tradeId: state.positionTradeId ?? currentTradeId(state),
        },
      ],
    };
  }
  let next = processProtection(
    prepared,
    bar,
    undefined,
    true,
    protectionAtOpen,
  );
  for (const original of state.orders) {
    const order = next.orders.find((o) => o.id === original.id)!;
    if (order.reduceOnly) continue;
    if (order.status !== 'pending' || order.createdAt >= bar.time) continue;
    let basePrice: number | undefined;
    const target = order.price;
    if (order.type === 'market' && order.queuedMarket) {
      next = executeOrder(next, order, bar.open, bar.time);
      next = processProtection(next, bar, order.id, true);
      continue;
    }
    if (target === undefined) continue;
    if (order.type === 'limit') {
      if (
        order.side === 'buy' &&
        bar.low * (1 + (state.config.spreadBps ?? 0) / 20000) <= target
      )
        basePrice = Math.min(bar.open, target);
      if (
        order.side === 'sell' &&
        bar.high * (1 - (state.config.spreadBps ?? 0) / 20000) >= target
      )
        basePrice = Math.max(bar.open, target);
    } else if (order.type === 'stop') {
      if (order.side === 'buy' && bar.high >= target)
        basePrice = Math.max(bar.open, target);
      if (order.side === 'sell' && bar.low <= target)
        basePrice = Math.min(bar.open, target);
    }
    if (basePrice !== undefined) {
      next = executeOrder(next, order, basePrice, bar.time);
      next = processProtection(next, bar, order.id, basePrice === bar.open);
    }
  }
  // Update stops only after executing this candle: new levels cannot act on
  // a high/low that occurred before the completed-candle observation.
  if (!deferDynamic) next = updateDynamicProtection(next, bar);
  if (state.config.borrowAprPct) next = { ...next, lastBorrowTime: bar.time };
  return withEquity(next, bar);
}

/** Execute a reconciled finer path, retaining base-candle ledger timestamps. */
export function advanceWithSubBars(
  state: TradingState,
  bar: Candle,
  bars: Candle[],
): TradingState {
  let next = state;
  for (let i = 0; i < bars.length; i++)
    next = advanceBar(next, bars[i], i === 0, true);
  const remainingLiquidity = next.liquidity?.remaining ?? 0;
  next = {
    ...next,
    orders: next.orders.map((o) => ({
      ...o,
      createdAt: o.createdAt >= bar.time ? bar.time : o.createdAt,
      ...(o.filledAt !== undefined && o.filledAt >= bar.time
        ? { executionTime: o.filledAt, filledAt: bar.time }
        : {}),
    })),
    equityHistory: state.equityHistory,
    recentBars: state.recentBars,
    liquidity: undefined,
    executionClock: {
      base: bar.time,
      end: bar.endTime ?? bars.at(-1)!.endTime ?? bars.at(-1)!.time,
    },
  };
  // Manual orders at the revealed parent close share the last subcandle's budget.
  if (next.config.volumeParticipationPct)
    next.liquidity = { time: bar.time, remaining: remainingLiquidity };
  next = updateDynamicProtection(next, bar);
  return withEquity(next, bar);
}

function updateDynamicProtection(
  state: TradingState,
  bar: Candle,
): TradingState {
  const recentBars = [
    ...(state.recentBars ?? []).filter((b) => b.time < bar.time),
    bar,
  ].slice(-15);
  let next = { ...state, recentBars };
  if (!state.position.quantity || !state.dynamicProtection) return next;
  const direction = Math.sign(state.position.quantity);
  const { trailing, breakEvenPct } = state.dynamicProtection;
  let level: number | undefined;
  if (trailing) {
    let distance: number | undefined;
    if (trailing.mode === 'price') distance = trailing.distance;
    if (trailing.mode === 'percent')
      distance = (bar.close * trailing.distance) / 100;
    if (trailing.mode === 'atr' && recentBars.length === 15) {
      distance =
        (recentBars
          .slice(1)
          .reduce(
            (sum, b, i) =>
              sum +
              Math.max(
                b.high - b.low,
                Math.abs(b.high - recentBars[i].close),
                Math.abs(b.low - recentBars[i].close),
              ),
            0,
          ) /
          14) *
        trailing.distance;
    }
    if (distance !== undefined) level = bar.close - direction * distance;
  }
  const entry = state.position.averagePrice;
  if (
    breakEvenPct !== undefined &&
    (((bar.close - entry) * direction) / entry) * 100 >= breakEvenPct
  ) {
    level =
      level === undefined
        ? entry
        : direction > 0
          ? Math.max(level, entry)
          : Math.min(level, entry);
  }
  if (level === undefined || !finitePositive(level)) return next;
  const existing = state.orders.find(
    (o) => o.role === 'stopLoss' && o.status === 'pending',
  );
  if (existing) {
    const improved =
      direction > 0
        ? Math.max(existing.price!, level)
        : Math.min(existing.price!, level);
    next = {
      ...next,
      orders: next.orders.map((o) =>
        o.id === existing.id ? { ...o, price: improved } : o,
      ),
    };
  } else {
    next = {
      ...next,
      orders: [
        ...next.orders,
        {
          id: `order-${next.orders.length + 1}`,
          side: direction > 0 ? 'sell' : 'buy',
          type: 'stop',
          quantity: Math.abs(state.position.quantity),
          price: level,
          status: 'pending',
          createdAt: bar.time,
          role: 'stopLoss',
          reduceOnly: true,
        },
      ],
    };
  }
  return next;
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

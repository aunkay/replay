import { isValidMarketData, type MarketData } from './data';
import {
  cancelOrder,
  closePosition,
  editBracket,
  submitOrder,
  type OrderRequest,
} from './engine';
import {
  addPortfolioAsset,
  advancePortfolio,
  cancelPortfolioOrder,
  closePortfolioPosition,
  createPortfolio,
  editPortfolioBracket,
  submitPortfolioOrder,
  type Portfolio,
} from './portfolio';
import type { StoredSession } from './session';

export type SessionPortfolio = { book: Portfolio; markets: MarketData[] };
export type TradingCommand = {
  type: string;
  ticker?: string;
  order?: OrderRequest;
  id?: string;
  stopLoss?: number;
  takeProfit?: number;
};

function sync(session: StoredSession, book: Portfolio): StoredSession {
  return {
    ...session,
    account: book.assets.find((a) => a.ticker === session.market.ticker)!
      .account,
    portfolio: { ...session.portfolio!, book },
  };
}

export function attachPortfolioMarket(
  session: StoredSession,
  market: MarketData,
): StoredSession {
  if (
    !isValidMarketData(market) ||
    market.interval !== session.market.interval ||
    market.adjusted !== session.market.adjusted
  )
    throw new Error(
      'Choose comparison data with the same interval and price adjustment as the base ticker.',
    );
  if (session.blind)
    throw new Error('Portfolio trading is unavailable in blind challenges.');
  if (!session.market.currency || !market.currency)
    throw new Error(
      'Portfolio trading requires known currencies for both tickers.',
    );
  const time = session.market.bars[session.cursor].time;
  const bar = market.bars
    .filter((b) => b.time <= time && b.complete !== false)
    .at(-1);
  if (!bar)
    throw new Error(
      'This ticker has no revealed candles at the current replay time.',
    );
  let book =
    session.portfolio?.book ??
    createPortfolio(
      session.market.ticker,
      session.market.currency,
      session.market.bars[session.cursor],
      session.account,
    );
  if (book.assets.some((a) => a.ticker === market.ticker)) return session;
  book = addPortfolioAsset(book, market.ticker, market.currency, bar);
  return {
    ...session,
    portfolio: {
      book,
      markets: [...(session.portfolio?.markets ?? []), market],
    },
  };
}

export function applyTradingCommand(
  session: StoredSession,
  command: TradingCommand,
): StoredSession {
  const ticker = command.ticker ?? session.market.ticker;
  if (session.portfolio) {
    let book = session.portfolio.book;
    if (command.type === 'order')
      book = submitPortfolioOrder(book, ticker, command.order!);
    else if (command.type === 'close')
      book = closePortfolioPosition(book, ticker);
    else if (command.type === 'cancel')
      book = cancelPortfolioOrder(book, ticker, command.id!);
    else if (command.type === 'bracket')
      book = editPortfolioBracket(
        book,
        ticker,
        command.stopLoss,
        command.takeProfit,
      );
    else throw new Error('Unknown trading command.');
    return sync(session, book);
  }
  if (ticker !== session.market.ticker)
    throw new Error('Add the ticker to the portfolio before trading.');
  const bar = session.market.bars[session.cursor];
  const account =
    command.type === 'order'
      ? submitOrder(session.account, command.order!, bar)
      : command.type === 'close'
        ? closePosition(session.account, bar)
        : command.type === 'cancel'
          ? cancelOrder(session.account, command.id!)
          : command.type === 'bracket'
            ? editBracket(
                session.account,
                command.stopLoss,
                command.takeProfit,
                bar,
              )
            : undefined;
  if (!account) throw new Error('Unknown trading command.');
  return { ...session, account };
}

export function advancePortfolioSession(
  session: StoredSession,
  cursor: number,
  markOnly = false,
): StoredSession {
  if (!session.portfolio) throw new Error('No portfolio attached.');
  const time = session.market.bars[cursor].time;
  const updates = [session.market, ...session.portfolio.markets].flatMap(
    (market) => {
      const asset = session.portfolio!.book.assets.find(
        (a) => a.ticker === market.ticker,
      )!;
      return market.bars
        .filter(
          (b) =>
            b.time > asset.bar.time && b.time <= time && b.complete !== false,
        )
        .map((bar) => ({
          markOnly,
          ticker: market.ticker,
          bar,
          nextTime: market.bars[market.bars.indexOf(bar) + 1]?.time,
          finer:
            market.ticker === session.market.ticker
              ? session.finerMarket
              : undefined,
        }));
    },
  );
  return sync(
    { ...session, cursor },
    advancePortfolio(session.portfolio.book, updates),
  );
}

export function sessionInstruments(session: StoredSession) {
  return session.portfolio
    ? session.portfolio.book.assets.map((asset) => ({
        ticker: asset.ticker,
        account: asset.account,
        bars: (asset.ticker === session.market.ticker
          ? session.market
          : session.portfolio!.markets.find((m) => m.ticker === asset.ticker)!
        ).bars.filter((b) => b.time <= asset.bar.time),
      }))
    : [
        {
          ticker: session.market.ticker,
          account: session.account,
          bars: session.market.bars.slice(0, session.cursor + 1),
        },
      ];
}

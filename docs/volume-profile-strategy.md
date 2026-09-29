# Volume profile sweep & reclaim: research specification

Status: experimental, not a proven strategy. The code identifies a failed excursion and subsequent price acceptance; it cannot determine whether market manipulation occurred or has ended.

## Research basis

- [TradingView: volume profile concepts](https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/) defines POC, value areas and historical support/resistance context. It does not establish that touching a level predicts a profitable trade.
- [Sierra Chart: Volume by Price](https://www.sierrachart.com/index.php?page=doc/StudiesReference.php&ID=141) describes volume profiles and the importance of source-data granularity. Replay distributes candle volume uniformly across high–low ranges, so its levels are estimates rather than tick-volume measurements.
- [Rift Volume Profile Engine, by Mr_Davidd7](https://www.tradingview.com/script/aX0QgDb2-Rift-Volume-Profile-Engine/) is a primary community-author example of value-area sweeps and reclaims. It is an idea source, not verified evidence of profitability. No source code was copied.
- [CME: proper position size](https://www.cmegroup.com/education/courses/trade-and-risk-management/proper-position-size) connects stop placement and account risk to position size. The 0.5% risk default here is an implementation choice, not a promise that losses are capped at that amount.

The exact confirmation, entry-zone, timeout and target rules below are Replay's independently defined hypothesis, not a reproduction of a published profitable system.

## Frozen reference and timing

Use intraday candles; the initial study uses 5m. Default session boundary is midnight in America/New_York, configurable by IANA timezone and local start hour. The loaded dataset determines included market hours. A session is considered finished when a later session begins. Skip the first loaded session (it may be partial), and require at least 20 completed bars in the reference session. Missing bars can still bias a profile; this minimum is not a completeness guarantee.

Freeze the preceding session's 32-row, 70% value-area profile. Never build entry levels from the eventual full current session. ATR is a trailing simple average of 14 true ranges; completed signal candles are included. This is distinct from Wilder-smoothed ATR.

## Long entry, with mirrored short rules

1. Observe a low below prior VAL by more than 0.1 ATR. For a short, observe a high above VAH by that amount. A candle that sweeps both edges is ambiguous and does not start a setup.
2. Wait for a completed close strictly inside VAL–VAH. Track the sweep extreme until that reclaim.
3. On a **later** candle, require a retest within 0.25 ATR of the value edge, another close inside value, and a directional close beyond the reclaim close. Long confirmation must close above its own open and the reclaim close; short confirmation mirrors it.
4. Require the confirming close in the first 35% of value-area width measured inward from VAL (long) or VAH (short). Cancel on a close at or beyond either value boundary, a new sweep extreme, or when the setup exceeds six candles. At most one confirmed setup per side per session is considered, including setups later rejected by the opening-price filter.
5. Enter at the **next open**, only in the same session and still inside that entry zone. Require at least 1R of room to POC after a conservative allowance for entry slippage, half-spread, and two commissions. Reject gaps outside the zone or beyond a useful target. A sweep candle alone can never trigger an entry.

## SL, PT and sizing

- Stop-loss: beyond the sweep/retest extreme by 0.2 ATR, frozen at confirmation. Gaps can fill worse than the stop price.
- Default profit-taking: 50% at frozen POC, 50% at the opposite value edge. Alternatives: all at POC or all at the opposite edge. POC reward/risk screening applies in every target mode.
- Risk budget: 0.5% of current equity, capped by buying power; alternatively choose fixed quantity or allocation in the existing UI. No pyramiding, one position at a time.
- Exit remaining size at the next session's first available open or after 24 holding candles. This can expose a position to an overnight gap; it does **not** guarantee flattening at the exchange close.
- Backtest signals use completed candles; entries use next open. Existing conservative same-bar protective-order logic and optional finer execution data apply. End-of-evaluation positions liquidate at the final close.

## Quick test and limitations

`src/data/profile-strategy-research.json` records the exact strategy, data hashes, timestamps and results. `scripts/profile-strategy-research.ts` reproduces results from SPY/QQQ Yahoo 5m snapshots saved in `/tmp/replay-vp-research` (or `PROFILE_RESEARCH_CACHE`). Historical candles are not committed. Run `npm run research:volume-profile` with the Replay server on port 8080 (override with `RESEARCH_API_URL`). Missing cache files are fetched sequentially through Replay with three seconds between requests. Existing snapshots are reused; a fresh cache directory produces a new sample and will not reproduce the original numbers.

The initial snapshots each contain 1,560 completed candles over roughly one month. Split chronologically 70%/30%, retain earlier candles for warmup, and start a fresh $100,000 account per scenario. Test both 5 bps and 10 bps **each** of commission and slippage **per side**; no parameter search. Missing borrow/spread costs are not assumed realistic for all instruments.

At base costs, SPY's first slice produced one trade: **−$266.94**, **0.31%** maximum bar-close drawdown, **−4.24** annualized daily Sharpe. Its later slice and both QQQ slices produced no trades. At doubled costs, the entry reward/risk filter rejected all setups. A one-trade annualized Sharpe is not dependable evidence, and zero trades is not a successful strategy result.

The current result is therefore **insufficient evidence, with a losing observed trade**, not validation of an effective entry edge. Keep these defaults as a transparent baseline. Larger samples, alternative markets and resolutions, cost sensitivity, walk-forward tests, and forward paper trading are needed before drawing conclusions. Profile approximation, gaps, incomplete sessions, bar-close drawdown and OHLC intrabar ordering remain material limitations.

## Where to find it

Practice & research → Strategy lab → search **Volume profile sweep & reclaim**. Step 2 explains and configures entry/SL/PT rules; Step 3 configures sizing and costs. The catalog includes the quick-test table. This stateful multi-candle strategy is for backtesting; it is not exposed as a single-rule chart-alert template or automatically run as a Live trading bot.

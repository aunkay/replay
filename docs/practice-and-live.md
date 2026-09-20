# Practice, research and live workspaces

Open **Practice & research** above the chart to access Sessions, Journal, Analytics, Blind and Strategies. The existing replay ticket, indicators, comparisons and drawing tools remain available on the main workspace.

## Protected orders and position sizing

Expand **Protection & risk sizing** in the order ticket. Choose a stop-loss and/or take-profit, expressed as price or a percentage; targets can also use a risk multiple. Manual quantity remains available. Cash-risk and percentage-equity modes calculate quantity from entry-to-stop distance, estimated fees and slippage, round down to the selected quantity step and cap exposure at 1× equity. Percentage risk defaults to 1%.

Filled entries can create reduce-only stop and target children. They protect the aggregate position, resize after partial reductions, cancel when flat and cancel their sibling when one fills. Use the protection editor or drag the chart's stop/target handle to change a level. Touch handles support pointer dragging; keyboard users can focus a handle and use arrow keys.

Candle OHLC cannot reveal the path inside a candle. If both exits are touched, the simulator uses the stop first and flags ambiguity. Gap-through stops fill at the opening price with configured costs. An intrabar pending entry can hit its stop on the same candle; its target cannot fill on that candle unless the entry occurred at the open. Edits apply prospectively. Market orders in manual replay fill at the revealed close.

## Saved sessions and journal

Save a named session to place it in the server library. Saved accounts and chart preferences are automatically updated. Search, resume, rename, duplicate, archive, delete or export a session. ZIP export includes its snapshot, notes and attached chart images; import creates a separate session. **Import existing browser session** migrates the current local workspace, with duplicate-import protection.

One device controls a saved session at a time. Other devices can view it; **Take control** transfers control explicitly. Revision checks prevent stale writes, command IDs prevent duplicate trades, and server events update viewers. This is a trusted, shared deployment without individual user accounts.

The journal groups trades from flat to flat. Add setup names, tags, entry/exit rationale and notes. Capture the current chart manually or enable automatic captures for new fills while the saved replay workspace is open. Images include visible chart layers and a ticker/time/mode caption; ZIP exports retain them. Journal metadata and trade statistics export as CSV.

Analytics includes net P&L, expectancy, profit factor, win rate, win/loss streaks, holding time, drawdown and duration, R multiples, and MAE/MFE. Partial closes and reversals allocate fees to their trade episodes. MAE/MFE are candle-based price excursions, not tick-level execution measurements. Group results by direction, setup, tags, weekday or hour; market timezone is used where available.

## Blind exercises

Choose an exercise length (100 candles by default). Replay chooses a random eligible starting point, saves its seed and hides calendar dates and the surrounding dataset's progress. Ticker identity stays visible. The main chart and analysis panels reveal only information available at the replay clock. **Finish exercise** cancels pending orders, closes the position at the revealed close and ends the exercise. Browser-held datasets are not a tamper-proof examination system.

## Two, three or four charts

Select **Charts** above the workspace. Desktop layouts use two columns; three charts put the last panel across the bottom, and four form a 2×2 grid. Phone layouts stack panels vertically with at least 320px of chart height, panel jump controls and per-analysis-panel fullscreen.

The main panel owns the traded instrument and replay clock. Analysis panels have their own interval, indicator instances, drawings, chart type, scale and comparisons. There are at most six unique symbols across the workspace and 24 live symbol/interval streams. Add comparison symbols from the main panel, then choose them in analysis panels. Crosshair and visible-range synchronization have separate toggles.

Higher-interval candles appear only after their completion time. Known exchanges use trading calendars, including session closes; unknown calendars conservatively use the next candle's timestamp. This can delay the newest candle when a reliable completion time is unavailable.

## Live mode

**Live is off by default**, including after reload, session restore and server restart. Clicking Live starts a separate paper account; clicking it again returns to the previous replay account. Saved live accounts can be resumed from the library by explicitly enabling Live.

The server shares streams by symbol and interval. Poll cadence is half the interval: 1m every 30 seconds, 5m every 150 seconds, 1d every 12 hours. Monthly cadences use calendar-month duration. Provider jobs run serially with at least three seconds between starts, including historical cache misses. Six due symbols are therefore spread across roughly an 18-second polling cycle, plus provider latency. Clients receive events instead of independently polling Yahoo.

A provider 429/throttle response applies a shared cooldown: 30, 60, 120, 240, 480 and then 900 seconds, plus up to 20% jitter. A longer Retry-After is honored. Three successful provider requests reset the throttle streak. Cooldowns survive process restarts; refresh does not bypass them.

Provisional candles can appear on charts, but never execute orders. Live market commands execute at the next observed completed candle's close. Limit/stop orders submitted during a candle become eligible on subsequent candles, so earlier highs/lows cannot create retrospective fills. Existing pending orders can be cancelled immediately; bracket edits apply on a completed-candle boundary. Live order status exposes queued commands, including cancellation before they execute.

Visible clients renew a 60-second lease every 15 seconds. When every client disconnects or remains hidden long enough, monitoring pauses. Explicit resume acknowledges the gap and marks skipped history without retrospective fills. Recoverable provider outages process completed candles chronologically; missing history outside the provider's window requires gap acknowledgement. Substantial adjusted-history changes pause the account for a new baseline. Yahoo is a polling data source, not a guaranteed real-time exchange feed.

## Visual strategies and parameter searches

Start from SMA crossover, RSI mean-reversion or Donchian breakout. Define long/short entry and exit rules with AND/OR conditions, price fields, constants and outputs from the 50 indicators. Operators include above, below, cross above and cross below. **Bars ago** permits prior-candle comparisons. Configure quantity or percentage risk, protection, fees and slippage.

Signals use completed candles and fill at the next open. Strategies use the same order/protection engine as manual replay, with one net position and no pyramiding. Opposing signals and ambiguous brackets have deterministic handling.

Backtests run in a worker, separate from the API's trading engine requests. Inputs are limited to 100,000 candles and parameter searches to 500 combinations. Add parameter paths with minimum, maximum and step. The default chronological split is 70% training / 30% test. Candidates are ranked on training results only; the chosen strategy starts a fresh account on the test segment, retaining earlier candles for indicator warmup. Review progress, cancel work, inspect candidate results, compare saved runs and export trades/results. Run snapshots retain strategy inputs, dataset hash and engine version. An interrupted worker is reported explicitly rather than silently rerun.

## Operations

See [Docker deployment](docker.md) for the persistent volume, backup and startup behavior. The API, Node engine and frontend must all be available for server sessions, Live and strategies; the unsaved local replay remains usable without them. Native iOS packaging is still a starter project; automated mobile coverage uses iPhone 13 WebKit emulation.

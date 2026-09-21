# Practice, research and live workspaces

Open **Practice & research** above the chart to access Sessions, Trade journal, Performance, Blind practice and Strategy lab. On phones, all five sections stay visible in the navigation bar. The existing replay ticket, indicators, comparisons and drawing tools remain available on the main workspace.

Each tab starts with a visible explanation and a three-step quick start. Expand **Example & terms explained** for a worked example and definitions of the controls and statistics in that tab.

The workspace keeps navigation separate from the scrolling page. Each section explains its next step, and keyboard focus stays inside the dialog until you close it. Escape returns focus to the Practice & research button.

## Protected orders and position sizing

Expand **Protection & risk sizing** in the order ticket. Choose a stop-loss and/or take-profit, expressed as price or a percentage; targets can also use a risk multiple. Manual quantity remains available. Cash-risk and percentage-equity modes calculate quantity from entry-to-stop distance, estimated fees and slippage, round down to the selected quantity step and cap exposure at 1× equity. Percentage risk defaults to 1%.

Filled entries can create reduce-only stop and target children. They protect the aggregate position, resize after partial reductions, cancel when flat and cancel their sibling when one fills. Use the protection editor or drag the chart's stop/target handle to change a level. Touch handles support pointer dragging; keyboard users can focus a handle and use arrow keys.

Candle OHLC cannot reveal the path inside a candle. If both exits are touched, the simulator uses the stop first and flags ambiguity. Gap-through stops fill at the opening price with configured costs. An intrabar pending entry can hit its stop on the same candle; its target cannot fill on that candle unless the entry occurred at the open. Edits apply prospectively. Market orders in manual replay fill at the revealed close.

## Market alerts

Expand **Alerts** above the workspace. Enter a name and configure price, volume, indicator or constant operands, with above/below or crossover operators. Combine conditions with AND/OR, or load a strategy template's long-entry rule and customize it. Indicator conditions wait for their normal warm-up. Alerts use the base ticker and current interval.

Alerts evaluate completed revealed candles after creation, fire once, and record their name, time and price in the session's last 200 events. **Pause replay when triggered** stops both playback and a forward seek at the triggering candle. Notification-only alerts let replay continue. **Rearm alert** watches again from the current candle. The workspace shows an in-app notification; OS notifications are not required.

Definitions and history persist with browser and server sessions, exports and checkpoints. Live alerts evaluate completed candles, not provisional prices; acknowledged data gaps do not emit retrospective alerts. Pause applies to replay, while Live continues collecting data. Up to 30 alerts are supported per session.

## Replay bookmarks and checkpoints

In **Practice & research → Sessions**, enter a checkpoint name and choose **Save checkpoint** before trying a trade. A checkpoint stores the current replay candle and exact account state, including cash, positions, pending orders and protective rules. **Restore checkpoint** pauses playback and returns to that state. Checkpoints are bound to the session dataset; a new dataset starts a new set. Each session supports up to 20 checkpoints.

Browser checkpoints persist on reload and are included when saving the session to the server or exporting its ZIP. Restoring a server checkpoint creates a separate saved retry session, preserving the original attempt and journal. Journal notes are not copied into the retry. Checkpoints are unavailable in Live and blind exercises. Delete a checkpoint when it is no longer needed.

## Saved sessions and journal

Save a named session to place it in the server library. Saved accounts and chart preferences are automatically updated. Search active or archived sessions and use **Resume** to continue. Open the session’s **More actions** menu to rename, duplicate, archive, export or delete it. Renaming happens beside the selected session; deletion has an inline confirmation. Import controls are grouped under **Import & browser storage**. ZIP export includes its snapshot, notes and attached chart images; import creates a separate session. **Import existing browser session** migrates the current local workspace, with duplicate-import protection.

One device controls a saved session at a time. Other devices can view it; **Take control** transfers control explicitly. Revision checks prevent stale writes, command IDs prevent duplicate trades, and server events update viewers. This is a trusted, shared deployment without individual user accounts.

The journal groups trades from flat to flat. Expand a trade to add a setup name, tags, entry/exit reasoning and lessons. Saving notes displays confirmation; capturing a chart also saves your current draft. Capture the current chart manually or enable automatic captures for new fills while the saved replay workspace is open. Images include visible chart layers and a ticker/time/mode caption; ZIP exports retain them. Journal metadata and trade statistics export as CSV.

Performance highlights closed-trade count, net P&L, win rate and profit factor. Expand **More statistics & drawdown** for expectancy, win/loss streaks, holding time and drawdown duration; the trade table includes R multiples and MAE/MFE. Partial closes and reversals allocate fees to their trade episodes. MAE/MFE are candle-based price excursions, not tick-level execution measurements. Group results by direction, setup, tags, weekday or hour; market timezone is used where available.

## Blind exercises

Choose an exercise length (100 candles by default). Replay chooses a random eligible starting point, saves its seed and hides calendar dates and the surrounding dataset's progress. Ticker identity stays visible. The main chart and analysis panels reveal only information available at the replay clock. **Finish exercise** cancels pending orders, closes the position at the revealed close and ends the exercise. Browser-held datasets are not a tamper-proof examination system.

## Two, three or four charts

Select **Charts** above the workspace. Desktop layouts use two columns; three charts put the last panel across the bottom, and four form a 2×2 grid. Phone layouts stack panels vertically with at least 320px of chart height, panel jump controls and per-analysis-panel fullscreen.

Pressing Play (including the mobile toolbar or Space shortcut) returns every chart to the current replay candle and resumes following with a six-bar right margin. The **Follow latest** button on each chart does the same without starting playback or changing the account. Hovering leaves follow mode intact; panning into history lets you inspect older candles until you follow again.

The main panel owns the traded instrument and replay clock. Analysis panels have their own interval, indicator instances, drawings, chart type, scale and comparisons. There are at most six unique symbols across the workspace and 24 live symbol/interval streams. Add comparison symbols from the main panel, then choose them in analysis panels. Crosshair and visible-range synchronization have separate toggles.

Daily and intraday panels can run together (for example AAPL 1d/5m or 5m/2m). Each panel fetches its own supported interval range. Explicit long daily ranges are clipped to Yahoo’s available intraday history; entirely unavailable historical ranges show an explanation. If the replay clock is earlier than the intraday history, advance replay or load a recent base range—panels never substitute future candles. Changing interval clears stale data while loading. Linked zoom follows the chart you interact with and clips to the recipient’s available candles, preventing feedback between different candle grids. Linked ranges include the source candle’s closing time, so a daily chart does not hide the current day’s intraday candles. Finer-interval views retain the latest eligible candle and limit candle density to readable spacing; their left edge can differ from the daily view. A 5m panel driven by a 2m replay adds a candle only when its 5-minute interval has completed.

Higher-interval candles appear only after their completion time. Known exchanges use trading calendars, including session closes; unknown calendars conservatively use the next candle's timestamp. This can delay the newest candle when a reliable completion time is unavailable.

## Live mode

**Live is off by default** in the browser, including after reload and session restore. Server monitoring also stays off after restart unless you explicitly enabled background monitoring. Clicking Live starts a separate paper account; clicking it again returns to the previous replay account. Saved live accounts can be resumed from the library by explicitly enabling Live.

The server shares streams by symbol and interval. Poll cadence is half the interval: 1m every 30 seconds, 5m every 150 seconds, 1d every 12 hours. Monthly cadences use calendar-month duration. Provider jobs run serially with at least three seconds between starts, including historical cache misses. Six due symbols are therefore spread across roughly an 18-second polling cycle, plus provider latency. Clients receive events instead of independently polling Yahoo.

A provider 429/throttle response applies a shared cooldown: 30, 60, 120, 240, 480 and then 900 seconds, plus up to 20% jitter. A longer Retry-After is honored. Three successful provider requests reset the throttle streak. Cooldowns survive process restarts; refresh does not bypass them.

Provisional candles can appear on charts, but never execute orders. Live market commands execute at the next observed completed candle's close. Limit/stop orders submitted during a candle become eligible on subsequent candles, so earlier highs/lows cannot create retrospective fills. Existing pending orders can be cancelled immediately; bracket edits apply on a completed-candle boundary. Live order status exposes queued commands, including cancellation before they execute.

Visible clients renew a 60-second lease every 15 seconds. When every client disconnects or remains hidden long enough, monitoring pauses unless background monitoring is enabled. Explicit resume acknowledges the gap and marks skipped history without retrospective fills. Recoverable provider outages process completed candles chronologically; missing history outside the provider's window requires gap acknowledgement. Substantial adjusted-history changes pause the account for a new baseline. Yahoo is a polling data source, not a guaranteed real-time exchange feed.

## Background Live monitoring

Once Live has loaded, enable **Keep monitoring when browser closes** to opt this account into browser-independent monitoring. The server continues the same spaced provider polling, closed-candle paper execution and alert recording after the last browser disconnects. This choice is saved to disk. On server restart, opted-in active monitors recover their account and pending commands, then process missed completed candles only when provider history overlaps the last recorded candle. Missing coverage or substantially revised price history pauses the monitor for review.

The main workspace lists **Background live monitors** when you are outside Live. **Connect to monitor** takes control of that existing account and displays its alert history. It does not create a duplicate monitor. **Stop monitor**, or turning off Live while connected, disables monitoring and its automatic restart. You can also uncheck the background option to return to browser-lease behavior. Alerts are recorded on the server; these controls do not enable OS push notifications.

## Visual strategies and parameter searches

The Strategy lab separates setup into four expandable steps: starting point, entry/exit rules, position size/costs, and optional parameter search. Search 24 source-linked templates across trend, breakout, mean reversion, momentum and volume. Read each template’s rules and adaptation notes before loading it. Your draft stays in place when switching between practice sections. Define long/short entry and exit rules with AND/OR conditions, price fields, constants and outputs from the 50 indicators. Operators include above, below, cross above and cross below. **Bars ago** permits prior-candle comparisons. Configure fixed quantity, equity allocation or percentage risk, plus optional protection, fees and slippage. Equity allocation and risk sizing are mutually exclusive. Templates use 95% equity allocation and 5 bps commission plus 5 bps slippage per side by default.

Signals use completed candles and fill at the next open. Strategies use the same order/protection engine as manual replay, with one net position and no pyramiding. Opposing signals and ambiguous brackets have deterministic handling.

Backtests run in a worker, separate from the API's trading engine requests. Inputs are limited to 100,000 candles and parameter searches to 500 combinations. Add parameter paths with minimum, maximum and step. The default chronological split is 70% training / 30% test. Candidates are ranked on training results only; the chosen strategy starts a fresh account on the test segment, retaining earlier candles for indicator warmup. Review progress, cancel work, inspect candidate results, compare saved runs and export trades/results. Run snapshots retain strategy inputs, dataset hash and engine version. An interrupted worker is reported explicitly rather than silently rerun.

Results show net P&L, maximum drawdown and annualized Sharpe. Open the historical quick-test table to compare all templates against buy-and-hold on three ETFs. These reference results are separate from the loaded chart. See [research sources, methodology and reproducible results](strategy-research.md).

## Operations

See [Docker deployment](docker.md) for the persistent volume, backup and startup behavior. The API, Node engine and frontend must all be available for server sessions, Live and strategies; the unsaved local replay remains usable without them. Native iOS packaging is still a starter project; automated mobile coverage uses iPhone 13 WebKit emulation.

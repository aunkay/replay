# Replay · Market Lab

A local web application for replaying historical candles, placing manual paper orders, and tracking trading performance. It combines React, TypeScript, and [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/) with a FastAPI service that retrieves Yahoo Finance prices through [yfinance](https://ranaroussi.github.io/yfinance/).

## Run locally

Use Python 3.11 or newer and Node.js 22 or newer with npm. From the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm install
./scripts/dev.sh
```

Open [http://localhost:5173](http://localhost:5173). The launcher starts the frontend on port 5173 and the API on port 8000. Ctrl+C stops both servers and their child processes. If either server exits, the other is stopped as well. The launcher is for Bash on Linux/macOS.

You can also run the two services in separate terminals:

```bash
# Terminal 1, repository root
.venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2, repository root
npm run dev -- --port 5173 --strictPort
```

Vite proxies `/api` requests to `http://127.0.0.1:8000`. No Yahoo Finance account or API key is required.

## Use the workspace

1. Open the data selector, enter a Yahoo Finance ticker such as `AAPL`, `SPY`, `BTC-USD`, or `EURUSD=X`, and choose an interval and period or custom dates.
2. Load the data, then reveal candles with play/pause, speed controls, or a single step. Future candles stay hidden on the chart. Seeking forward processes every skipped candle so pending orders and equity remain consistent.
3. Set the order side, quantity, and market, limit, or stop type. Buy to enter a long position or close a short; sell to enter a short or close a long. You can cancel pending orders or close the entire position.
4. Inspect realized/unrealized P&L, equity, cash, exposure, fees, returns, drawdown, and order history. Export the session summary, orders, and equity history as CSV.
5. Configure starting capital, commission, and slippage in session settings. Rewinding or changing the dataset starts a fresh paper account so later trades cannot carry backward into earlier candles.

The initial workspace uses an explicitly labeled **synthetic demo** so you can explore immediately. Demo candles are generated data, not downloaded prices. Loading Yahoo Finance data replaces the demo; a provider error is displayed and never silently substituted with synthetic data.

Candlestick/line views, volume, technical indicators, drawing tools, order markers, and an equity chart support replay. Keyboard shortcuts are **Space** for play/pause, **Right Arrow** for one step, and **B/S** to select buy/sell when focus is outside a form or dialog.

Replay automatically moves the chart forward while you are viewing the latest candles, preserving your zoom and right-side spacing. Scroll back to inspect history and that view stays in place during playback; return to the latest candles to resume following.

### Chart scales and normalization

The **Normalization** and **Price scale** controls above the chart work on the base ticker with or without a benchmark, in both candlestick and line views. Choose **Logarithmic** for equal vertical distances between equal proportional price changes, or **Linear** for equal absolute price changes.

| Normalization   | Displayed value                                                    |
| --------------- | ------------------------------------------------------------------ |
| Price           | Original base price; a benchmark is rebased to that starting price |
| Percentage      | `100 × (price / starting price − 1)`                               |
| Indexed to 100  | `100 × price / starting price`                                     |
| Ratio to start  | `price / starting price`; 1.25 means a 25% gain                    |
| Log return (%)  | `100 × ln(price / starting price)`                                 |
| Z-score         | `(price − window mean) / population standard deviation`            |
| Min–max (0–100) | `100 × (price − window minimum) / window range`                    |

Percentage, indexed, and ratio modes support either price scale. Log returns use logarithmic price spacing automatically, so equal distances on the axis represent equal log returns. Z-score and min–max use linear spacing; the scale selector explains and locks these required choices. Your preferred linear/log scale returns when you switch back to an unrestricted mode.

For Z-score and min–max, set **Normalization window** to 2–500 candles (default 50) and click **Apply window**. Statistics use the latest revealed closes, using the available sample when it is shorter than the requested window. With a benchmark, each instrument's statistics use the same exact shared timestamps. The current base-value readout still refers to the current replay candle, even when the latest shared benchmark candle is older. At least two observations and a nonzero range are required; otherwise an explanation appears and the chart temporarily shows prices.

The statistical window is recalculated during replay, so earlier chart values are rescaled as the window advances. Earlier prices, candle wicks, and price indicators can lie outside a min–max range calibrated on recent closes. No unrevealed candle contributes to these calculations. The other normalized modes use the first loaded candle as a fixed baseline, or the first shared candle when comparing, independent of panning and zooming.

Display preferences survive reloads, base-market changes, and benchmark removal. **Reset chart display** returns to price/linear with a 50-candle window. Existing active benchmark scale preferences migrate to the shared chart controls. Trading, order prices, OHLC readouts, P&L, and drawing anchors retain original quote units; only the chart view changes. Price indicators follow the chart normalization, while oscillators and volume retain their own scales.

### Compare up to five tickers

Click **Compare** in the chart toolbar and enter `SPY`, `QQQ`, or another Yahoo Finance ticker. Click it again to add another comparison, up to **five tickers total: the base plus four comparisons**. The button shows the current count and disables at the limit; remove a comparison to free a slot. Duplicate symbols and the base symbol are rejected. Each comparison loads the base ticker's interval and history range and has its own line color, edit/remove controls, loading state, and error handling.

Use the shared chart display controls above to normalize all tickers: price, percentage, indexed, ratio, log return, Z-score, and min–max are supported. Adding a first benchmark defaults to percentage comparison if you have not already chosen a display setting. Explicit choices, including base-only logarithmic mode, are preserved.

With an active comparison, normalized chart-axis and base-series labels also retain the base ticker's actual quote, for example `235.69 · +12.34%`. The chart display readout shows the original price and currency alongside the normalized value. Benchmark labels retain normalized values, since their plotted price coordinates are rebased rather than actual benchmark quotes.

The fixed return baseline is the first revealed candle shared by the base and **every successfully loaded comparison**. It does not move when you pan or zoom. All comparison points and statistical windows use this same intersection of timestamps; unmatched sessions are omitted without carrying a quote forward. Return readouts use the latest shared timestamp, shown as **Returns as of**. If no common candle has been revealed yet, the base keeps its independent display and a notice explains why comparison lines are waiting. Adding/removing a ticker can change the shared baseline/window and therefore recalculate existing comparisons. A flat or insufficient statistical window falls back to prices consistently for every ticker. Benchmark return readouts always show ordinary percentage returns, even when the chart uses statistical normalization or log returns.

Trading, P&L, and drawing anchors continue to use the base ticker's original quote units. Price overlays use the selected normalized axis, while oscillators keep their own units and scales. Returns are calculated in each ticker's quote currency without foreign-exchange conversion. A comparison against the initial synthetic demo is explicitly labeled as such.

All comparison snapshots, symbols, colors, and shared display settings persist in this browser; an existing single comparison is retained when upgrading. Loading a different base market or interval refreshes all selected comparisons independently. Provider errors are shown and obsolete requests cannot replace the current dataset or restore a removed ticker. An unsuccessful symbol edit keeps that ticker's last successful comparison and leaves the others intact. Only the base ticker is traded; comparisons are visual benchmarks, not additional portfolio positions.

### Indicators and chart drawings

Open **Indicators** in the chart toolbar to search 50 studies by name or abbreviation and filter by category. Click a study to add it; adding it again creates an independent instance. Set each instance's period and color and click **Apply** for period changes. Price overlays share the candle pane; oscillators each get their own pane. Remove a study with its chart chip's × or manage all studies in the menu. Indicator settings persist in this browser.

The catalog includes SMA, EMA, WMA, DEMA, TEMA, HMA, VWMA, SMMA, ZLEMA, KAMA, T3, ALMA, linear regression, Bollinger Bands, Donchian channels, Keltner channels, Ichimoku, Supertrend, Parabolic SAR, VWAP, RSI, Stochastic, Stochastic RSI, MACD, PPO, ROC, momentum, CCI, Williams %R, Awesome Oscillator, Ultimate Oscillator, TRIX, CMO, DPO, TSI, Fisher Transform, ADX, Aroon, Vortex, ATR, NATR, standard deviation, Bollinger bandwidth, %B, Choppiness Index, OBV, accumulation/distribution, Chaikin Money Flow, MFI, and Force Index.

Calculations use only revealed candles and omit values until the required warm-up finishes. Each catalog description documents its formula and fixed secondary settings. Ichimoku shows current, undisplaced spans and omits its lagging plot; DPO is causal rather than centered. VWAP resets on UTC calendar days, so use intraday bars for an intraday VWAP. OBV and accumulation/distribution start at the loaded dataset's first candle. These conventions may differ from other platforms' defaults.

The drawing toolbar includes **trend line, ray, extended line, horizontal line, vertical line, rectangle, ellipse, parallel channel, Fibonacci retracement, arrow, text, and measure**. Click endpoints or drag to draw; channels take a third point to set width. Select a drawing to move it, drag its anchor handles to reshape it, or change its color. Delete removes the selection; toolbar controls undo, redo, or clear drawings. Press Escape to cancel placement. Text annotations use an inline editor.

Drawings store time/price anchors and stay aligned when replaying, panning, zooming, or resizing. They are saved separately for each source, ticker, and interval. Rewinding hides drawings with future anchors until those candles become visible again. Undo history is limited to the latest 50 edits in the current page session; drawings themselves survive a reload.

The active dataset, replay position, paper account, and order history are saved in this browser's local storage. This is one local session rather than a server account: clearing browser storage removes it, and other browsers/devices do not share it. Very large datasets can exceed the browser's storage quota; the workspace reports when saving fails.

### iPhone and iOS WebView

The mobile layout includes a bottom toolbar for Chart, Trade, Results, Play/Pause, and Next, 44-pixel control targets, decimal/numeric keyboards, notch/home-indicator padding, and dialogs that follow the visible viewport. Swipe the chart and drawing toolbars to reach additional controls. **Fullscreen chart** expands inside the page so it also works in an iOS WebView. Replay pauses when the page or native app enters the background.

In chart cursor mode, drag sideways to pan, pinch to zoom, or hold to inspect a candle; vertical swipes scroll the page. To draw, select a tool and tap its anchors or drag. Tap a drawing to select it, then drag its enlarged anchor targets to edit it. Canceled or interrupted gestures discard the unfinished placement.

See [the iOS hosting and WKWebView guide](ios-webview.md) for same-origin HTTPS deployment and the included [SwiftUI starter](../ios/ReplayApp.swift). The starter retains web storage and uses the native share sheet for CSV exports. The browser bundle uses system fonts and relative API URLs; it needs no third-party font service. This is a connected, self-hosted application, not an offline app.

Automated iPhone 13 tests run in touch-enabled WebKit at 390×844, with additional Safari-height and landscape checks. They do not replace a physical iPhone test of the software keyboard, native gestures, safe areas, or share sheet. The Swift starter still needs compilation, signing, and device validation in Xcode.

## Execution model

This is a manual replay simulator. Market orders execute immediately at the currently revealed candle's **close**, with adverse slippage applied. This makes the current candle's complete OHLC information visible before a market fill; results should be interpreted using that convention rather than as a next-open strategy backtest.

Limit and stop orders become eligible only on later candles. Buy limits trigger when the candle's low reaches their price, and sell limits trigger when its high reaches theirs. Buy stops trigger on the high; sell stops on the low. If the next candle opens through a trigger, its open is used: limit orders receive the better opening price, while stop orders can fill at a worse opening price. When several pending orders trigger in one candle, they are processed in submission order. OHLC candles cannot establish the actual order of trades within that candle.

Commission is charged on every fill as `quantity × fill price × commission bps / 10,000`. One basis point is 0.01%. Market and stop fills add adverse slippage in basis points; limit fills have no extra slippage and respect their limit. P&L uses average entry cost, and total P&L includes all commissions. The reported win rate counts closing fills rather than grouping complete round trips; the per-fill realized value deducts that fill's commission, while the account's realized P&L includes commissions on opening fills too.

New exposure is limited to **1× account equity at execution**. Short-sale proceeds do not increase buying power. Orders are checked when they fill; pending orders do not reserve capital. Position-reducing orders remain available when equity has fallen. Long and short positions, fractional quantities, partial closes, and reversals are supported for a single selected instrument.

There is no Pine Script interpreter or automated strategy runner, brokerage connection, live order execution, order-book/liquidity simulation, partial-fill model, borrow cost/availability model, forced liquidation, or multi-asset portfolio accounting. Contract multipliers and currency conversions are not modeled; quantities represent units of the displayed price series.

## Historical data

The backend supports intervals `1m`, `2m`, `5m`, `15m`, `30m`, `60m`, `90m`, `1h`, `1d`, `5d`, `1wk`, `1mo`, and `3mo`. Supported periods are `1d`, `5d`, `7d`, `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `10y`, `ytd`, and `max`. Custom start dates are inclusive and end dates are **exclusive**, following the [yfinance history API](https://ranaroussi.github.io/yfinance/reference/api/yfinance.download.html).

Yahoo's intraday history is limited. The application validates one-minute requests to at most seven calendar days per request within the recent 30-day window, other intraday intervals to the last 60 days, and hourly intervals to the last 730 days. Provider availability can be narrower for individual instruments. Use daily or coarser intervals for longer historical ranges. Empty ranges, invalid symbols, provider failures, and rate limits produce actionable errors.

Prices use `auto_adjust=True`: OHLC is adjusted for corporate actions using Yahoo's adjustment data. These are adjusted historical price units, not a reconstruction of the nominal prices and holdings on each historical date. The account does not separately book dividends, splits, or other corporate actions. Yahoo can revise historical data, and its latest candle may still be incomplete. The service excludes extended-hours data, removes invalid candles, deduplicates timestamps, and caches successful requests for two minutes. Daily/coarser candles are labeled using their exchange calendar date at midnight UTC; intraday timestamps retain the actual UTC instant.

Instrument names, currencies, and exchanges come from Yahoo's metadata. Missing metadata is not evidence of a particular currency. The project uses yfinance for research; consult the [yfinance documentation and data-use links](https://ranaroussi.github.io/yfinance/) for the provider's usage terms.

## Production build

```bash
npm run build
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The backend serves the built frontend and API from one origin when `dist/index.html` exists **at server startup**. Restart the backend after creating a first build. `npm run preview` previews the frontend build only; use the backend command above for the complete application.

## Verification and API

```bash
npm test
npm run build
.venv/bin/python -m pytest backend/tests -q
npx playwright install --with-deps chromium webkit
npm run test:e2e
```

The unit tests cover execution, long/short accounting, costs, order eligibility, risk limits, indicator formulas, drawings, and benchmark normalization/alignment. Backend tests mock Yahoo Finance so normal test runs do not depend on network access.

### End-to-end UI tests

`npm run test:e2e` launches desktop Chromium and iPhone 13 WebKit projects and starts its own Vite frontend on **5174** and test API on **8002**. Install both the Python and npm dependencies first, as shown above. No running development servers, Yahoo credentials, or live market connection are required. Ports 5174 and 8002 must be free; your normal workspace on 5173/8000 is left running.

The tests exercise visible controls and displayed outcomes, with account-state checks for exact accounting where useful:

- `tests/replay.spec.ts`: buy/sell P&L, fees, pending fills/cancellation, rejected orders, replay, rewind, persistence, data selection, CSV downloads, and mobile layout.
- `tests/trading.spec.ts`: stop orders, partial closes/reversals, account settings, input validation, skipped candles, replay completion, and keyboard shortcuts.
- `tests/workspace.spec.ts`: damaged storage recovery, storage-write failures, modal keyboard focus, chart controls, loading states, network retries, and currency display.
- `tests/fullstack.spec.ts`: browser → Vite proxy → actual FastAPI routes, including data loading, API validation, provider errors/rate limits, date ranges, and trading against returned prices. Only the upstream yfinance client is replaced by deterministic data in `tests/support/api.py`; the production API code handles validation, cleaning, caching, and serialization.
- `tests/indicators.spec.ts`: the 50-study catalog, multiple instances, editable settings, indicator panes, persistence, and replay behavior.
- `tests/drawings.spec.ts`: drawing placement, selection/editing, undo/redo, persistence, and replay alignment.
- `tests/comparison.spec.ts`: benchmark requests through the UI and API, normalized axis labels, logarithmic mode, shared timestamps, replay/rewind, saved settings, editing/removal, errors/retries, stale-request cancellation, and coexistence with indicators and drawings.
- `tests/chart-display.spec.ts`: standalone logarithmic charts, all seven normalization modes, rolling/shared-window statistics, replay warm-up, window validation, saved/migrated settings, benchmark removal, and chart-tool/trading/mobile integration.
- `tests/iphone.spec.ts`: portrait/landscape layouts, touch targets and input sizing, long/short paper trading, benchmark scales, indicator editing, touch drawing and chart interaction, replay, storage, simulated safe areas, expanded chart, lifecycle pause, and the native CSV bridge.
- `tests/insecure-origin.spec.ts`: desktop and iPhone indicator/drawing creation, duplicate studies, independent removal, and reload persistence when `crypto.randomUUID` is unavailable, as on local-network HTTP origins.
- `tests/replay-follow.spec.ts`: desktop and iPhone viewport movement during stepping/playback, with indicators, comparison, and logarithmic scaling, plus history inspection and returning to the right edge.
- `tests/comparison-price.spec.ts`: desktop and iPhone base-price visibility alongside normalized comparison labels, replay, logarithmic views, reload, and benchmark removal.
- `tests/multi-comparison.spec.ts`: five-ticker capacity, all normalization modes, duplicate rejection, individual colors/editing/removal, persistence, independent errors, and interval refresh on desktop and iPhone.

Every test uses a fresh browser context. Browser runtime errors fail the test. Failures retain screenshots, video, traces, and browser diagnostics under `test-results/`, with an HTML report in `playwright-report/`.

```bash
npm run test:e2e                         # Complete browser suite
npm run test:e2e:iphone                  # iPhone 13 WebKit suite
npm run test:e2e -- tests/trading.spec.ts # One group of journeys
npm run test:e2e:headed                  # Watch Chromium interact with the app
npm run test:e2e:ui                      # Interactive Playwright test runner
npm run test:e2e:report                  # Open the last HTML report
npm run test:e2e:types                   # Type-check browser tests and helpers
```

For a frontend-only test against an existing workspace, set `PLAYWRIGHT_BASE_URL`, for example `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npm run test:e2e -- tests/workspace.spec.ts`. This disables automatic server startup; the full-stack file expects the dedicated fixture API and should use the default command.

The included `.github/workflows/e2e.yml` runs the checks and browser suite on pushes and pull requests and uploads the report. Test-server management follows the [Playwright web-server configuration](https://playwright.dev/docs/test-webserver).

```bash
curl http://127.0.0.1:8000/api/health
curl 'http://127.0.0.1:8000/api/market-data?ticker=AAPL&interval=1d&period=1y'
curl 'http://127.0.0.1:8000/api/market-data?ticker=SPY&interval=1d&start=2024-01-01&end=2025-01-01'
```

`GET /api/market-data` returns ticker metadata, interval, source (`yfinance`), adjustment status, OHLCV bars with UNIX-second timestamps, fetch time, actual first/last candle timestamps, and warnings. Currency and exchange may be `null` if Yahoo does not report them. The query accepts a period or a start/end pair. API documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

The frontend uses TradingView's open-source Lightweight Charts library, with attribution in the application. This is an independent application and is not the TradingView website or its proprietary charting/strategy platform. See the [official Lightweight Charts repository](https://github.com/tradingview/lightweight-charts) for its Apache 2.0 license and attribution requirements.

# Replay feature expansion

Scope: all eleven requested additions. Native iOS packaging is excluded; iPhone
browser usability and WebKit end-to-end coverage remain included.

| Feature | Delivered behavior | Verification |
| --- | --- | --- |
| Trailing stops / break-even | Price, percent and ATR trailing; configurable break-even; prospective long/short updates; strategy controls | `brackets.test.ts`, `advanced-trading.spec.ts`, `live-protection.spec.ts` |
| Multiple take profits | Three allocated targets; remaining position protected; individual chart-level edits preserve other exits | `brackets.test.ts`, `advanced-trading.spec.ts`, `live-protection.spec.ts` |
| Bookmarks / checkpoints | Named exact-state retries, dataset identity, local restore and server-session fork, including portfolios and alerts | `checkpoints.test.ts`, `sessionPortfolio.test.ts`, `checkpoints.spec.ts`, `portfolio.spec.ts` |
| Alerts | Price/indicator/strategy conditions, history, optional replay pause, completed-bar Live and background evaluation | `alerts.test.ts`, `alerts.spec.ts`, `background-live.spec.ts` |
| Portfolio trading | Base plus five comparisons, shared cash and gross-exposure limits, positions, P&L, distinct journals and exports; replay and Live | `portfolio.test.ts`, `sessionPortfolio.test.ts`, `portfolio.spec.ts` |
| Strategy validation | Rolling training/test windows, training-only parameter selection, heatmaps, reproducible Monte Carlo distributions | `research.test.ts`, `research-validation.spec.ts` |
| Execution realism | Spread, volume-limited partial fills, short financing attributed to trades, optional reconciled finer-candle replay/strategy/Live execution | `execution.test.ts`, `finerExecution.test.ts`, `execution.spec.ts`, `finer-execution.spec.ts`, `live-protection.spec.ts` |
| Data library / CSV | Persisted datasets, validated CSV import, missing-slot inspection, dataset reuse | `backend/tests/test_datasets.py`, `data-library.spec.ts` |
| Multi-timeframe rules | Per-rule intervals using only completed, causal higher-timeframe aggregates | `timeframes.test.ts`, `timeframe-rules.spec.ts` |
| Extended hours | Optional provider requests, isolated caches/streams, persisted selection and chart shading | `backend/tests/test_api.py`, `extended-hours.spec.ts` |
| Background Live | Explicit persisted opt-in, browser-independent polling/orders/alerts, restart recovery, gap detection and reconnection | `backend/tests/test_workspace.py`, `background-live.spec.ts`, `portfolio.spec.ts` |

Test filenames without a directory refer to `src/lib/` for unit tests and `tests/`
for browser tests. The named feature journeys run in Chromium and iPhone 13 WebKit.

## Verification

- `npm test`: 399 passing unit tests.
- `.venv/bin/python -m pytest backend/tests -q`: 41 passing API tests.
- `npm run build` and `npm run test:e2e:types`: pass.
- `npx playwright test --reporter=list`: 254 passing browser tests.
- Subsequent audit corrections passed 38 targeted browser cases covering protected
  trades, portfolio journals/checkpoints, Live, and the practice workspace. The
  final portfolio capital correction passed all six portfolio journeys again.
- Regression coverage includes unique portfolio trade IDs, isolated journal notes,
  individual staged-level editing, and preventing same-candle closing gains from
  funding another ticker's earlier pending fill.

One initial full-suite failure assumed a permanently fixed provider candle count.
The Live test feed legitimately advances; the assertion now derives expected
execution prices and P&L from the returned dataset. The full rerun passed.

## Execution conventions

Trailing rules update at completed parent closes. ATR uses 14 true ranges and
waits for warm-up; break-even means entry price before costs. Finer windows must
reconcile OHLCV or use the reported conservative fallback; late data never
retroactively re-executes a parent candle. Portfolio instruments use one currency
and interval; same-timestamp fills compete in ticker order using preceding marks
for other instruments. Live portfolio execution can wait for a lagging provider
stream. Gap and adjusted-history checks cover all traded portfolio tickers.

## Release

Released on 2026-09-22. Application code commit `0ab1c9a` was pushed to
`aunkay/replay` and installed with `docker compose up -d --build` on port 8080.

- API and engine containers report healthy; `/api/health` returns `status: ok`.
- A production smoke journey created a temporary server session, attached a
  comparison, traded both symbols through the actual API/engine, advanced replay,
  saved a checkpoint and verified distinct journal entries. The temporary session
  was deleted afterward.
- Chromium and iPhone WebKit loaded that portfolio from the deployed frontend;
  positions rendered correctly, the phone had no horizontal overflow, and neither
  browser reported runtime errors.
- Public desktop/iPhone screenshots were refreshed from the deployed application.
- Docker is enabled at boot. Both containers use `restart: unless-stopped` and the
  existing persistent data volume.

GitHub-hosted CI could not start: [run 35670289311](https://github.com/aunkay/replay/actions/runs/35670289311)
reports an account billing lock for both jobs. This is distinct from the passing
local build, unit/API/E2E checks and deployed-container smoke verification above.

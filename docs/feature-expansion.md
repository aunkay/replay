# Replay feature expansion

Scope: implement the eleven requested additions; native iOS packaging is excluded.
Each item requires user-facing controls, persisted state where applicable, deterministic
engine behavior, and desktop/mobile browser coverage. Existing replay, Live, saved
sessions and strategy flows must remain compatible.

| Feature | Acceptance criteria | Status |
| --- | --- | --- |
| Trailing stops / break-even | Price, percent and ATR trailing; configurable break-even activation; prospective updates for long/short positions | Engine and ticket implemented; desktop/iPhone replay and reload tests pass; broader integration pending |
| Multiple take profits | Up to three price/percentage allocations; remaining position stays protected; conservative ambiguous-bar execution | Engine and ticket implemented; desktop/iPhone reload journey passes; broader saved/Live coverage pending |
| Bookmarks / checkpoints | Name, save, restore and retry replay with exact account state; dataset identity and saved-session handling | Pending |
| Alerts | Price crossings, indicator crossings, strategy conditions; notifications and optional replay pause; no future data | Pending |
| Portfolio trading | Trade base and comparisons using shared cash, buying power, positions and portfolio P&L | Pending |
| Strategy validation | Rolling train/test windows, parameter heatmaps, reproducible Monte Carlo distributions | Pending |
| Execution realism | Configurable spread, volume participation/partial fills, short borrowing costs, optional lower-timeframe execution | Pending |
| Data library / CSV | Server-persisted datasets, validated CSV import, missing-candle inspection, reusable data selection | Pending |
| Multi-timeframe rules | Per-rule interval selection; only completed higher-timeframe values at signal time | Pending |
| Extended hours | Request/cache/session support; explicit inclusion control; session chart shading | Pending |
| Background Live | Explicit persisted server monitoring opt-in, browser-independent operation and alert history, safe restart/reconnect | Pending |

## Verification and release

Add meaningful engine/API tests and end-to-end journeys for each row, including
invalid input and persistence where relevant. Run the complete regression suite,
build, deploy on port 8080 and smoke-test the deployed application. Do not run
Docker network-changing operations concurrently with browser tests. Audit all rows
against implementation and test evidence before marking this expansion complete.

## Current evidence

Initial multiple-target implementation: 356 unit tests passed; production build passed; desktop and iPhone `advanced-trading.spec.ts` scale-out/reload journey passed. Full release and remaining feature rows are not yet complete.

Protection implementation uses completed-close trailing updates and a 14-period simple mean of true range (15 observed candles), with no ATR stop until warm-up. Break-even is entry price before costs. Remaining work includes saved-server/Live coverage, strategy builder exposure, stricter imported-state validation, and full regression verification.

Latest checks: 359 unit tests pass; build and E2E TypeScript checks pass. Both added browser journeys pass on desktop and iPhone (four cases total). These checks do not establish completion of the full eleven-feature scope.

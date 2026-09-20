# Implemented trading workspace

The approved feature groups are available in the application:

- Stop-loss/take-profit OCO protection and risk-based position sizing.
- Persistent session library, controller handoff and browser-session migration.
- Journal notes, tags, chart images and portable session ZIP archives.
- Flat-to-flat analytics, grouping and exports.
- Seeded, fixed-length blind replay exercises.
- Up to four independently configured, synchronized charts and six unique symbols.
- Optional shared Live polling, completed-bar simulation, leases, spacing and backoff.
- Visual strategy rules, templates, worker jobs and parameter searches with training/test separation.

Usage and execution assumptions are documented in [Practice and live workspaces](practice-and-live.md).
The persistent two-service deployment, automatic startup and backups are documented in [Docker deployment](docker.md).

Release validation includes unit and API tests, the complete desktop/iPhone browser suite,
additional production-container smoke tests, a real yfinance 1-minute data fetch,
Live initialization, saved-account recovery after a container restart and a SQLite backup integrity check.
The native iOS wrapper remains a starter; physical-device/Xcode verification is outside this web release.

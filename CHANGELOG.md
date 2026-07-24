# Changelog

## 1.0.8 - 2026-07-24

### Highlights
- Added updater reliability hardening so downloaded updates continue prompting after restart until installed.
- Added one-click `Check for Updates` action in Settings for support and user self-diagnostics.
- Continued solve-path performance tuning to reduce latency in captcha assignment, event handling, and OTP autofill loops.

### User-Facing Improvements
- Settings now shows installed app version from Electron runtime (`app.getVersion`) with packaged/dev indicator.
- If an update is already downloaded, manual update checks immediately surface the install prompt.
- Added optional captcha performance telemetry panel and rolling p50/p95 metrics for faster provider diagnostics.

### Stability and Behavior
- Added persistent pending-update state tracking in main process to avoid missed install prompts.
- Added manual updater IPC bridge across main/preload/renderer for deterministic update checks.
- Reduced synchronous work on hot captcha flows and optimized repeated DOM scan patterns in session preload.

## 1.0.7 - 2026-07-24

### Highlights
- Reworked Captcha into a harvester-based workflow with provider-ready personal key setup.
- Removed AYCD-coupled internal autosolve path and replaced it with generic provider + token injection flow.
- Added manual solve fallback in runtime popups so captcha challenges can always be solved even without a live solver server.

### User-Facing Improvements
- New per-harvester provider presets (AYCD, CapSolver, 2Captcha, CapMonster, Custom) with endpoint autofill.
- Added one-click `Test Provider` in the harvester editor with inline pass/fail feedback.
- Runtime popup now includes `Open Manual Solve Window` to focus the active session quickly.
- Harvester type options are now constrained to PokemonCenter and Costco only.

### Stability and Behavior
- Captcha event bridge now tracks detected/solved/error state in real time across session -> main -> renderer.
- Improved credential readiness checks to prevent silent personal solver failures.
- Added compatibility handling for older captcha config records when loading into harvester mode.

## 1.0.6 - 2026-07-24

### Highlights
- Shifted trigger handling toward centralized global monitoring and disabled conflicting local polling path.
- Hardened app quality gates: lint, typecheck, and production build all pass.
- Reduced production bundle pressure with deterministic vendor chunk splitting.

### User-Facing Improvements
- Updated Global Triggers workflow messaging and monitor behavior for backend-driven triggers.
- Improved stability across core pages (Sessions, Task Groups, Captcha, Profiles, Proxies, Settings).
- Cleaned up outdated flows by removing unused legacy pages.

### Developer and Ops Updates
- Added/updated environment typing and bridge defaults to reduce runtime/type regressions.
- Converted tool configs to remove module-format warning noise during lint/build.
- Added worker trigger bus updates and Durable Object migration wiring in Cloudflare config.

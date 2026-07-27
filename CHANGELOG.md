# Changelog

## 1.0.24 - 2026-07-27

### Highlights
- Fixed packaging pipeline syntax regression in updater status messaging.

### Stability and Behavior
- Corrected malformed template string quotes in `electron/main.js` updater messages that caused bytecode compile failure during CI builds.
- Restores successful Windows/macOS artifact packaging for the release workflow.

## 1.0.23 - 2026-07-27

### Highlights
- Fixed activation endpoint fallback to target the current v1 trigger-auth worker.

### Stability and Behavior
- Updated default `VITE_TRIGGER_API_BASE` fallback from the legacy action-based worker host to `https://knull-trigger-auth.sloanbrack.workers.dev`.
- Resolves "Unknown action" during license activation on packaged builds when no build-time API base is injected.

## 1.0.22 - 2026-07-27

### Highlights
- Added live updater status tracking in Settings, including real download percentage and transfer speed.

### Stability and Behavior
- App now emits updater phases (`checking`, `downloading`, `downloaded`, `up-to-date`, `error`) from main process to renderer.
- Settings page now shows current updater state and a progress bar during downloads instead of only static background messaging.

## 1.0.21 - 2026-07-27

### Highlights
- Fixed activation failure on packaged builds when `VITE_TRIGGER_API_BASE` is missing at build time.

### Stability and Behavior
- Activation now falls back to the production trigger API endpoint (`https://knull-activation.sloanbrack.workers.dev`) when no build-time API base is injected.
- Removes the "Activation server not configured. Set VITE_TRIGGER_API_BASE." blocker for end users on fresh installs.

## 1.0.20 - 2026-07-27

### Highlights
- Removed legacy duplicate Discord trigger listener path; global trigger bus is now the single runtime source.
- Hardened public release exposure model to artifact-only publishing from private CI.
- Kept mac build icon packaging aligned to `electron/icon.png` for DMG/ZIP outputs.

### Stability and Behavior
- Prevented potential duplicate trigger launches caused by parallel legacy + bus listeners.
- Release pipeline now builds in private and uploads artifacts to public releases using `PUBLIC_RELEASES_TOKEN`.
- Public release repository history was sanitized to artifact-only snapshots to reduce source exposure.

## 1.0.9 - 2026-07-24

### Highlights
- Hotfix for rare post-update white-screen launches on some user machines.
- Added startup diagnostics for main window load failures and renderer exits.
- Added one-time automatic main window reload when UI fails to finish loading on startup.

### Stability and Behavior
- Main window now logs `did-fail-load` and `render-process-gone` failures for faster support triage.
- Startup timeout watchdog retries renderer boot once if initial load stalls.
- Diagnostic events are persisted to `SystemLog` under source `MainWindow`.

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

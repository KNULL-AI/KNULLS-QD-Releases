# Changelog

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

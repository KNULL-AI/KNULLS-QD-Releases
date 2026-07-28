# KNULLS-QD-Releases

This repository is intentionally artifact-only.

It contains public release assets for KNULL Queue Destroyer.
Source code is maintained in a separate private repository.# KNULLS-QD-Releases

This repository is intentionally artifact-only.

It contains public release assets for KNULL Queue Destroyer.
Source code is maintained in a separate private repository.# KNULL Queue Destroyer - Complete User Guide

This guide is for end users running the desktop app from public releases.

## Quick Start (2-Minute Setup)

1. Download the latest release for your OS from KNULLS-QD-Releases.
2. Install and launch the app.
3. Enter your user activation key on the Activation screen.
4. In Proxy Pool, add proxies and run a health check.
5. In Accounts, add the accounts you plan to run.
6. In Task Groups, create at least one group with retailer + URL.
7. In Sessions, launch one test session to confirm everything works.
8. Optional: enable Discord Monitor and IMAP in Settings when ready.

If anything fails in setup, go to Logs first and review the latest errors.

## What This App Is

KNULL Queue Destroyer is an Electron desktop app for managing:

- Proxy pools and proxy groups
- Browser sessions
- Account-to-proxy assignment
- Task group launches
- Discord-based trigger monitoring
- Captcha harvesters
- IMAP verification-code handling
- Local logs and configuration backup

The app is activation-key protected and uses a centralized trigger model.

## Platform Support

- Windows: Fully supported via NSIS installer releases.
- macOS: Supported via DMG and ZIP releases.

Notes for macOS:

- Builds are currently unsigned/not notarized.
- On first launch, macOS may warn about an unverified developer.
- If blocked, open Finder, right-click the app, and choose Open.

## Install and Update

### Get the latest build

1. Open the public releases page for KNULLS-QD-Releases.
2. Download the latest release for your OS.
3. Prefer the latest tag unless told otherwise.

### Windows install

1. Download the Setup `.exe`.
2. Run installer and complete prompts.
3. Launch KNULL Queue Destroyer from Start Menu or desktop shortcut.

### macOS install

1. Download the `.dmg` (or ZIP fallback).
2. Mount DMG and drag app to Applications.
3. Launch from Applications.

### In-app updates

- Windows updater uses `latest.yml` and blockmap assets.
- macOS updater uses `latest-mac.yml` and blockmap assets.
- You can manually check updates from Settings.

## First Launch and Activation

On first launch, you are sent to the Activation screen.

1. Enter your user activation key.
2. Click Activate.
3. Wait for validation.
4. After success, app unlocks full navigation.

Important:

- User license keys are required.
- Admin keys are not accepted in client activation.

## Recommended First-Time Setup Order

Use this sequence to avoid launch errors:

1. Proxy Pool: add and test proxies.
2. Accounts: add account credentials and proxy assignment preferences.
3. Profiles: create reusable session profiles (viewport, UA behavior).
4. Task Groups: define launchable task bundles by retailer.
5. Sessions: verify manual launches work.
6. Discord Monitor: connect channels and trigger behavior.
7. Captcha: configure harvester(s) and API providers.
8. Settings: export backup once stable.

## Navigation and How To Use Each Page

## Dashboard

Purpose:

- High-level operational overview.

Use it to:

- See active session counts.
- See quick proxy pool health signals.
- Stop running sessions in bulk.

## Proxy Pool

Purpose:

- Store and maintain all proxies.

Use it to:

- Add proxies individually or in bulk.
- Group proxies into proxy groups.
- Run proxy checks and diagnostics.
- Filter and sort by status.

Best practices:

- Keep healthy proxies active.
- Remove dead proxies quickly.
- Maintain dedicated groups by purpose (monitoring vs checkout tasks).

## Accounts

Purpose:

- Store account credentials and assignment strategy.

Use it to:

- Add/edit/delete accounts.
- Control account-level proxy assignment.
- Trigger account login flows as needed.

Best practices:

- Keep account labels clear.
- Pair critical accounts with stable proxies.

## Profiles

Purpose:

- Reusable browser session profile templates.

Use it to:

- Save profile presets for viewport/fingerprint behavior.
- Reuse profile settings across many sessions/task groups.

## Task Groups

Purpose:

- Define launch templates for repeatable task execution.

Use it to configure:

- Retailer type
- Target URL
- Instance count
- Proxy group
- Session profile
- Optional account assignment

Important behavior:

- Walmart account assignment can cap effective instance behavior to assigned account count.
- Account-level proxy assignment can override/fallback from task-group proxy settings.

## Sessions

Purpose:

- Run and control browser sessions.

Use it to:

- Launch sessions manually.
- Stop single or multiple sessions.
- Observe runtime status.
- Recover from crashes with proxy rotation behavior.

## Discord Monitor

Purpose:

- Monitor Discord channels and convert events into task launches.

Use it to:

- Configure monitor cards and channel inputs.
- Track trigger event logs.
- Tune cadence/cooldown and launch behavior.

Best practices:

- Keep cooldowns sane to avoid duplicate launch storms.
- Validate a monitor in a low-risk channel before production use.

## Captcha

Purpose:

- Manage captcha harvesters and challenge injection flow.

Use it to:

- Configure harvester environments.
- Enter solver provider/API settings.
- Test challenge resolution paths.

Best practices:

- Confirm provider endpoint and key before live use.
- Keep one known-good fallback setup.

## Logs

Purpose:

- Local runtime diagnostics and export.

Use it to:

- Filter by level.
- Inspect source-specific errors.
- Export logs for support/debug.
- Clear logs after archiving.

## Settings

Purpose:

- Operational controls and system utilities.

Includes:

- Import/Export app configuration
- IMAP tools
- Manual update checks
- Version info

### IMAP flow

IMAP features let the app ingest verification codes and attempt auto-delivery.

High-level flow:

1. Poll inbox for new code emails.
2. Match code to known account.
3. Find running session for that account.
4. Inject code if possible.
5. Record delivery status in local records.

Possible outcomes include:

- Auto-filled
- No account match
- No eligible session

## Typical Daily Workflow

1. Open app and verify activation/session state.
2. In Proxy Pool, run quick health checks.
3. Confirm Accounts and Task Groups are ready.
4. Start Discord Monitor(s).
5. Launch baseline Sessions or wait for trigger events.
6. Watch Dashboard/Logs during active windows.
7. Export config backup when stable changes are made.

## Backup and Migration

Use Settings Import/Export to move your setup between machines.

Recommended:

- Export after any major reconfiguration.
- Keep date-stamped backup files.
- Test import on a non-critical environment before event use.

## Troubleshooting

## Activation fails

- Confirm key format and account status.
- Ensure internet access and retry.
- Verify you are using a user key, not admin key.

## Sessions fail to launch

- Check proxy validity in Proxy Pool.
- Verify target URL and task-group configuration.
- Check Logs for session/proxy errors.

## Discord triggers not launching tasks

- Confirm monitor config and channel source.
- Confirm matching retailer/task-group mapping exists.
- Check cooldown/cadence settings.
- Review Logs and Discord Monitor event log.

## IMAP codes not auto-filling

- Confirm IMAP polling is active.
- Confirm account email match is exact.
- Confirm a session tied to that account is running.

## App icon still looks stale on Windows

- Unpin old shortcut and re-pin from the latest installed build.
- Restart Explorer or reboot to clear icon cache if needed.

## Performance and Stability Tips

- Keep only necessary sessions running.
- Archive/export logs periodically.
- Keep proxy groups clean and purpose-specific.
- Avoid very aggressive trigger intervals.

## Security Notes

- Do not share activation keys.
- Treat account credentials and proxy auth as secrets.
- Keep exported config files private.

## Release Strategy Notes

- Latest release is intended for normal users.
- Older releases may be marked obsolete for historical reference.
- Use latest unless a specific rollback is required.

## Support Checklist (Before Reporting an Issue)

Include:

1. App version
2. OS version
3. What page/action failed
4. Relevant log excerpt
5. Whether issue is reproducible

This reduces turnaround time and prevents guesswork.

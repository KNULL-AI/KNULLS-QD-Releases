# KNULL Queue Destroyer — User Guide

KNULL Queue Destroyer is a desktop app for Windows and macOS that manages browser sessions, proxy pools, Discord-based drop monitoring, and automated task execution for retail drops.

---

## Quick Start (First Time Setup)

Follow this order on your first run to avoid errors:

1. Download and install the latest release for your OS from the releases page.
2. Launch the app and enter your activation key on the Activation screen.
3. Go to **Proxy Pool** — add your proxies and run a health check.
4. Go to **Accounts** — add your account credentials.
5. Go to **Task Groups** — create at least one group with a retailer and target URL.
6. Go to **Sessions** — launch a test session to confirm everything works.
7. Go to **Discord Monitor** — set up channel monitoring if using global triggers.
8. Go to **Settings → IMAP** — configure IMAP if using auto verification codes.

If anything fails, check **Logs** first for specific error details.

---

## Install

### Windows
1. Download `KNULL-Queue-Destroyer-Setup-x.x.x.exe` from the releases page.
2. Run the installer and follow the prompts.
3. Launch from the Start Menu or desktop shortcut.

### macOS
1. Download `KNULL-Queue-Destroyer-x.x.x-arm64.dmg` from the releases page.
2. Open the DMG and drag the app to your Applications folder.
3. Launch from Applications.
4. If macOS warns about an unverified developer, right-click the app and choose **Open**.

### Updates
The app checks for updates automatically. You can also go to **Settings → About** and click **Check for Updates** to trigger a manual check.

---

## Activation

On first launch you will see the Activation screen.

1. Enter your user activation key in the input field.
2. Click **Activate**.
3. Wait for validation — this requires an internet connection.
4. Once confirmed, the full app unlocks.

**Notes:**
- Only user keys are accepted. Admin keys will not work here.
- If activation fails, check your internet connection and confirm the key is correct.

---

## Proxy Pool

The Proxy Pool is where you manage all your proxies and proxy groups.

### Adding Proxies

1. Click **+ Add Proxies** in the top right.
2. Paste your proxy list in any of these formats:
   - `host:port`
   - `host:port:user:pass`
   - `user:pass@host:port`
   - `protocol://user:pass@host:port`
3. Assign them to an existing proxy group or create a new one.
4. Click **Add**.

### Creating a Proxy Group

1. In the left sidebar, type a name in the **New group name** field.
2. Click the **+** button.
3. The new group appears in the sidebar immediately.

### Managing a Proxy Group

1. Click a group in the sidebar to select it.
2. Hover over the group name to reveal the ⚙️ settings icon.
3. Click ⚙️ to expand options:
   - **Rename** — edit the group name inline, press Enter to save.
   - **Delete** — removes the group. Proxies only used in this group are also deleted; proxies shared with other groups are kept.

### Running a Health Check

1. Select a proxy group from the sidebar.
2. Click **Test Proxies**.
3. Watch the progress bar — each proxy updates to **healthy** or **unhealthy** as results come in.
4. After the check, use **Delete Unhealthy** to remove failed proxies.

### Best Practices
- Keep dedicated groups per purpose (e.g. RESI for checkout, ISP for monitoring).
- Run health checks before any important launch.
- Remove unhealthy proxies regularly to keep groups performant.

---

## Accounts

The Accounts page stores login credentials for retailer accounts (Walmart).

### Adding an Account

1. Click **+ Add Account**.
2. Fill in label, email, and password.
3. Set the **proxy assignment** preference:
   - **None** — falls back to the task group proxy pool
   - **Single proxy** — always uses one specific proxy
   - **Proxy group** — rotates within a designated group

### Account Status
Each account shows a status badge:
- **Signed in** — authenticated
- **Needs code** — waiting for a verification code
- **Idle** — not currently in use

---

## Session Profiles

Session profiles are reusable templates for browser behavior settings.

### Creating a Profile

1. Go to **Profiles**.
2. Click **+ New Profile**.
3. Set:
   - **Name** — a descriptive label
   - **Viewport width/height** — browser window size
   - **User Agent** — leave blank to use the auto-rotate pool
   - **Language** — e.g. `en-US`
4. Save the profile.

Assign profiles to task groups to apply consistent browser settings across all sessions in that group.

---

## Task Groups

Task Groups are launch templates. Each one defines what to open, how many sessions to run, which proxies to use, and which browser to launch.

### Creating a Task Group

1. Go to **Task Groups**.
2. Choose the correct section:
   - **Costco / PokemonCenter** — for queue-based drops
   - **Walmart** — for Walmart account-driven flows
3. Click **+ New Task Group**.
4. Fill in:
   - **Task Group Name** — a descriptive label
   - **Target URL** — the product or queue page URL
   - **Instances** — number of browser windows to launch
   - **Launch delay (ms)** — stagger between launches (e.g. `500` = half second gap)
   - **Proxy Group** — which proxy group to rotate from
   - **Rotation Mode** — Round Robin, Random, or Sticky
   - **Session Profile** — optional reusable profile template
   - **Browser** — Chrome or Brave
   - **Discord Webhook** — optional URL for launch notifications
   - **User Agent** — leave blank to auto-rotate (recommended)
5. Click **Save Task Group**.

### Walmart-Specific Options
- **Warmup (minutes)** — how long to run before attempting the drop
- **Assign Accounts** — assign specific accounts; instance count locks to account count automatically

### Running a Task Group

Click the **▶ Run** button on any task group card to launch all sessions immediately.

### Editing a URL Quickly

Click directly on the URL text on the task group card to edit it inline without opening the full form.

### Deleting Task Groups
- Use the **trash icon** on individual cards to delete one.
- Use **Select All** then the **Delete N** button to bulk delete.

---

## Sessions

The Sessions page shows all running and stopped browser sessions.

### Launching a Session Manually

1. Click **+ Launch Session**.
2. Fill in a name, target URL, proxy, browser, and optional profile.
3. Click **Launch**.

### Session Controls

Each session card shows these actions:

| Button | What it does |
|--------|-------------|
| **Open** | Bring the browser window to front, or relaunch if closed |
| **Stop** | Kill the session and mark it stopped |
| **Force Rotate** | Swap to a new proxy on the existing session partition |
| **Rotate Session + Proxy** | Full reset — kills browser, picks a healthy proxy from the group, relaunches with fresh cookies and a new user agent |
| **Swap Proxy** | Manually pick a specific replacement proxy |
| **Remove Proxy** | Run the session direct (no proxy) |

### What "Rotate Session + Proxy" Does

This fully resets the browser fingerprint:
- Closes the current browser window
- Picks a healthy proxy from the session's assigned proxy group (falls back to any proxy in the group if none are healthy)
- Opens a new browser window with a **completely fresh storage partition** — new cookies, new cache, new fingerprint
- Applies a fresh randomized Chromium user agent from the pool

---

## Discord Monitor

The Discord Monitor connects to your Discord server and fires task group launches when it detects matching drop alerts in configured channels.

### Setting Up a Monitor

1. Click **+ Add Monitor**.
2. Fill in:
   - **Monitor name** — a label
   - **Retailer** — PokemonCenter, Walmart, or Costco
   - **Discord Channel ID** — right-click a Discord channel → Copy Channel ID
   - **Task Groups** — which groups to fire when a trigger fires
   - **Poll interval** — scan frequency in seconds
   - **Cooldown** — minimum gap between re-fires (prevents duplicate storms)
3. Click **Save**.
4. Click **▶ Start** on the monitor card to arm it.

### Bot Status Badge

At the top of the page you'll see a live status badge for the global monitoring bot. It shows **Online** or **Offline** with a pulsing dot. Click the refresh icon for an immediate check.

### Bot Triggers Tab

Shows a live log of every trigger the global bot has fired — retailer, type, URL, and timestamp. Click **Refresh** to pull the latest from the server.

### Event Log Tab

Shows all trigger events processed locally in this session.

### Best Practices
- Set a cooldown that matches your expected re-trigger interval.
- Test a monitor with a known-safe message before going live on a drop.
- Keep one monitor per retailer for clean separation.

---

## Captcha

The Captcha page manages captcha solver integrations.

1. Add your solver provider API key and endpoint.
2. Use the **Test** button to confirm it's reachable.
3. During live sessions, challenges are harvested and injected automatically when a solver is configured.

---

## Logs

The Logs page shows all runtime events from the app.

- **Filter by level** — Error, Warning, Info
- **Filter by source** — proxy-check, session, IMAP, etc.
- **Export** — save a log file for support or debugging
- **Clear** — clean up old entries after exporting

Check Logs first when troubleshooting anything unexpected.

---

## Settings

### General
- **Check Trigger Live Status** — pings the trigger server and confirms your connection.
- **Force Trigger Resync** — reconnects the WebSocket if it appears stale.
- **Check for Updates** — manually check for a new release.
- **Import / Export Config** — backup or restore task groups, proxy groups, monitors, and profiles.

> Proxies are excluded from exports as they may contain sensitive credentials.

### IMAP

IMAP lets the app poll your email inbox and automatically inject verification codes into running sessions.

**Setup:**
1. Go to **Settings → IMAP**.
2. Enter your IMAP host, port, email, and password.
3. Set the poll interval.
4. Click **Save** then **Start Polling**.
5. Use **Test** to confirm a successful connection.

**How it works:**
1. App polls the inbox on your set interval.
2. Matches the code to an account by email address.
3. Finds the running session tied to that account.
4. Injects the code automatically.

**Delivery outcomes:**
- ✅ **Auto-filled** — code injected into the session
- ⚠️ **No account match** — email doesn't match any saved account
- ⚠️ **No session** — account matched but no session is running

### Bot Monitor

Displays the live connection status of the global Discord monitoring bot.

- **Global Monitor configured** — endpoint is set and reachable.
- **Check Now** — sends an immediate health ping and shows online/offline status, uptime, and whether the Discord client is connected.

### About

Shows your installed version and build details. Use this when reporting issues.

---

## Typical Daily Workflow

1. Open the app — activation validates automatically in the background.
2. Go to **Proxy Pool** → run a quick health check on active groups.
3. Confirm **Task Groups** URLs are current for today's drop.
4. Arm **Discord Monitor(s)** for the channels you're watching.
5. Launch baseline **Sessions** or let trigger events fire them automatically.
6. Monitor **Dashboard** and **Logs** during the active drop window.
7. After the window, stop sessions and export a config backup if you made changes.

---

## Backup and Migration

Use **Settings → Import / Export Config** to move your setup between machines or save a snapshot.

**Best practices:**
- Export after any major configuration change.
- Keep date-stamped backups (e.g. `knull-config-2026-07-29.json`).
- Test an import in a safe environment before relying on it for an event.

---

## Troubleshooting

### Activation fails
- Confirm you have a stable internet connection.
- Confirm you are using a user key, not an admin key.
- Wait a minute and try again — the server may be briefly unavailable.

### Sessions fail to launch
- Run a proxy health check in **Proxy Pool**.
- Confirm the target URL is correct and reachable.
- Check **Logs** for session or proxy errors.

### Proxy rotation shows "No available proxies"
- Confirm the task group or session has a proxy group assigned.
- Run a health check — at least one proxy in the group must be healthy.
- The fallback will also try any proxy in the group if no healthy ones exist.

### Discord triggers not firing
- Confirm the monitor is **Started** (not just saved).
- Confirm the channel ID is correct.
- Confirm a task group is linked with the matching retailer.
- Check the cooldown — if active, triggers are suppressed until it expires.
- Review the **Event Log** tab in Discord Monitor.

### IMAP codes not auto-filling
- Confirm IMAP polling is **running** (Settings → IMAP shows active status).
- Confirm the account email in Accounts matches the inbox email exactly.
- Confirm a session tied to that account is currently running.

### "Verifying the device" on PokemonCenter
- Use **Rotate Session + Proxy** to get a completely fresh browser fingerprint.
- Make sure your proxies are health-checked — unhealthy proxies are skipped in rotation.
- RESI proxies work significantly better than datacenter for this check.

### macOS won't open the app
- Right-click the app in Finder and choose **Open**.
- If still blocked: **System Settings → Privacy & Security → Open Anyway**.

### App icon looks stale on Windows
- Unpin the old shortcut and re-pin from the latest installed build.
- If still showing old icon, restart Explorer or reboot to clear the icon cache.

---

## Performance Tips

- Keep only the sessions you need running — idle browser windows consume memory.
- Remove dead proxies from groups regularly.
- Keep proxy groups purpose-specific.
- Export and clear old logs periodically.

---

## Security

- Do not share your activation key.
- Treat account credentials and proxy auth as secrets.
- Keep exported config files private.

---

## Support

Before reporting an issue, include:

1. App version (Settings → About)
2. OS and version (Windows or macOS, version number)
3. Which page or action failed
4. Relevant lines from the Logs page
5. Whether the issue is reproducible

This helps resolve issues faster.


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

## Publishing Notes

For the release flow that builds in the private repo and publishes artifacts to the public repo, see [docs/publish-instructions.md](docs/publish-instructions.md).

### Release publishing checklist (private repo)

Use this exact order to match the previous successful versioned releases:

1. Confirm the app version in package.json is the release version you want (example: 1.0.31).
2. Commit and push the private repo changes to main.
3. Create and push a version tag in the private repo using the format vX.Y.Z.
4. Let GitHub Actions run from the tag push event.
5. Verify the run shows the tag as the run source (for example, v1.0.31), not main.
6. Verify the public artifact repo release is created or updated under that same version tag.

PowerShell example:

```powershell
git checkout main
git pull
git add .
git commit -m "release: v1.0.31"
git push origin main
git tag -a v1.0.31 -m "release v1.0.31"
git push origin v1.0.31
```

Important:

- Do not rely on manual workflow dispatch from main for official releases.
- Manual dispatch runs are labeled as main in Actions, even if the workflow later computes a version internally.
- Official release runs must be triggered by pushing the version tag.

Quick verification commands:

```powershell
gh run list -R KNULL-AI/KNULLS-QD --workflow release.yml --event push --limit 5
gh api repos/KNULL-AI/KNULLS-QD-Releases/releases --jq '.[0] | {tag_name: .tag_name, name: .name, html_url: .html_url}'
```

### Step-by-step publish flow (proven)

This is the exact flow used for successful public artifact releases, including updater-safe filename validation.

1. Update source code in the private repo and verify local changes.
2. Ensure artifact names are deterministic in package.json:
	 - Windows: `KNULL-Queue-Destroyer-Setup-${version}.${ext}`
	 - macOS: `KNULL-Queue-Destroyer-${version}-${arch}.${ext}`
3. Bump version in package.json (new version only; do not reuse a previous release tag).
4. Commit and push to main.
5. Create and push tag `vX.Y.Z` from that commit.
6. Wait for workflow `release.yml` to complete for that tag.
7. Verify public release assets exist under the same tag.
8. Verify updater metadata points to files that exist in release assets.

Copy/paste example:

```powershell
git checkout main
git pull

# Apply code changes first, then bump version.
npm version patch --no-git-tag-version

$version = node -p "require('./package.json').version"
$tag = "v$version"

git add .
git commit -m "release: $tag"
git push origin main
git tag -a $tag -m "release $tag"
git push origin $tag

# Wait and verify run state
gh run list -R KNULL-AI/KNULLS-QD --workflow release.yml --event push --limit 5

# Verify public release exists
gh api repos/KNULL-AI/KNULLS-QD-Releases/releases/tags/$tag --jq '{tag_name: .tag_name, name: .name, assets: (.assets | map(.name) | sort)}'
```

Updater 404 prevention check:

```powershell
$version = node -p "require('./package.json').version"
$tag = "v$version"

$release = gh api repos/KNULL-AI/KNULLS-QD-Releases/releases/tags/$tag | ConvertFrom-Json
$assetNames = $release.assets.name

$latest = $release.assets | Where-Object { $_.name -eq 'latest.yml' } | Select-Object -First 1
$latestText = gh api -H "Accept: application/octet-stream" repos/KNULL-AI/KNULLS-QD-Releases/releases/assets/$($latest.id)

$expected = ($latestText | Select-String -Pattern '^\s*- url:\s*(.+)$').Matches.Groups[1].Value.Trim()
if (-not $expected) {
	$expected = ($latestText | Select-String -Pattern '^path:\s*(.+)$').Matches.Groups[1].Value.Trim()
}

if ($assetNames -contains $expected) {
	Write-Host "PASS: latest.yml target exists in release assets -> $expected"
} else {
	Write-Host "FAIL: latest.yml target missing from release assets -> $expected"
}
```

If that check fails, do not ship the update. Fix artifact naming and release a new version tag.

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

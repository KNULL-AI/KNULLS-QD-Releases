# KNULL Queue Destroyer

Desktop app for managing browser sessions on Walmart, Pokémon Center, and Costco drops.

**[Download Latest Release →](https://github.com/KNULL-AI/KNULLS-QD-Releases/releases/latest)**

---

## What It Does

- Manages browser sessions with automatic proxy rotation
- Handles Walmart login flow via IMAP (auto-fills verification codes)
- Watches Discord channels for drop alerts and fires sessions automatically
- Walmart drop flow: warmup → sign in → wait → apply SKU → queue
- Accounts stay signed in between drops using per-account browser partitions
- Live stats: Logging In / Waiting for Product / In Queue per session group

---

## Recent Improvements (1.1.3x)

- **Per-group automatic force retry** — failed sessions retry themselves up to a
  limit you set, configured per task group
- **Genuinely separate rotated sessions** — Rotate Session + Proxy now gives the
  new browser its own partition, user agent, viewport, and a timezone matched to
  the new proxy
- **Health-ranked proxy assignment** — sessions are drawn from the healthiest
  proxies first, with a manual override when a health result is wrong
- Clear task-group save feedback in Tasks: "Settings saved" badge, persistent
  settings summary strip, changed-field highlight, last-updated indicator
- Safer configure flow: unsaved-change indicator, Save disabled until something
  actually changes

---

## Installation

### Windows
1. Download `KNULL-Queue-Destroyer-Setup-x.y.z.exe` from the latest release
2. Run the installer and follow the prompts
3. Launch from the Start Menu or desktop shortcut

### macOS
1. Download `KNULL-Queue-Destroyer-x.y.z-arm64.dmg` from the latest release
2. Mount and drag to Applications
3. Launch normally — current mac builds are signed and notarized

**Apple Silicon (arm64) only** — there is no Intel build. Windows and macOS ship
under the same version tag; if the newest release has no mac files yet, use the
newest release that does. On an older unsigned build, right-click → **Open**.

---

## Quick Start

1. **Activate** — enter your license key on the Activation screen
2. **Proxy Pool** — add residential proxies and create a proxy group
3. **Accounts** — add Walmart accounts in `email:password` format
4. **Tasks** — create a task group, assign accounts and proxy group
5. **Settings → IMAP** — configure for automatic login code injection
6. **Start** — click Start on your group to begin the warmup login flow

---

## Walmart Drop Flow

### First Time (Full Login)

1. Create a Walmart task group, assign accounts and proxy group
2. Click **Start** — one browser opens per account at the login page
3. IMAP auto-injects login codes; sessions transition to **Waiting for Product**
4. At drop time: paste the SKU into the **SKU field** → press Enter
5. Sessions navigate to the product page and enter the queue
6. Manually complete checkout when your queue position is reached

### Subsequent Drops

Nothing to switch on. Each account keeps its own persistent browser partition,
so signed-in state carries over:

1. Click **Start** — accounts still signed in land at **Waiting for Product**
2. Any account whose login lapsed re-runs the login flow on its own, with IMAP
   filling in the code
3. Paste the SKU at drop time → sessions go to queue

> Never stop sessions that are **In Queue** — you lose your queue position.

---

## Session Table

Sessions are displayed with color-coded left borders:

| Color | Meaning |
|---|---|
| 🟡 Yellow | Logging In — account is signing in |
| 🔵 Blue | Waiting for Product — signed in, ready for SKU |
| 🟢 Green | In Queue |
| 🔴 Red | Error |

**Filter chips** (Logging In / Waiting / In Queue / Error) filter the table to just that phase.  
**Column sorting** — click any header.  
**Bulk actions** — select rows with checkboxes → Stop or Delete selected.

---

## Discord Monitor

Watches Discord channels for drop alerts and fires task groups automatically.

1. Go to **Discord Monitor → + Add Monitor**
2. Select retailer, paste the Discord Channel ID, link your task group
3. Click **Save** then **▶ Start**

When an alert is detected, sessions launch automatically for that retailer's task group.

---

## Settings

| Feature | Notes |
|---|---|
| Check Trigger Live Status | Confirms your connection to the trigger server |
| Force Trigger Resync | Reconnects if the WebSocket goes stale |
| Sign Out / Re-activate | Clears stored session — use if trigger bus keeps failing after sleep |
| Check for Updates | Manual update check |
| Import / Export Config | Backup/restore groups, proxies, monitors, profiles |
| IMAP | Auto-inject Walmart login codes from email |

---

## Troubleshooting

**Trigger bus "Connection closed [1006]"** — click Force Trigger Resync. If still failing, Sign Out and re-activate with your license key.

**Sessions stuck on Logging In** — check Settings → IMAP is active and the test passes. Open the inbox to confirm Walmart sent a code.

**"Cannot find latest.yml"** — release is mid-publish. Wait a moment and check for updates again.

**Stop All skipped some sessions** — sessions In Queue are intentionally skipped to preserve queue position.

**Pokémon Center "Verifying the device"** — use Rotate Session + Proxy (pencil icon) to get a fresh browser fingerprint with a new proxy.

---

## Version History

See the [releases page](https://github.com/KNULL-AI/KNULLS-QD-Releases/releases)
— each release carries its own notes.

---

## Support

Include in any support request:
- App version (Settings → General → App Updates)
- OS version
- Which page/action failed
- Relevant Logs excerpt

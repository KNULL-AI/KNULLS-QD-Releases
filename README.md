# KNULL Queue Destroyer

Desktop app for running browser sessions on Walmart, Pokémon Center and Costco
drops.

**[Download Latest Release →](https://github.com/KNULL-AI/KNULLS-QD-Releases/releases/latest)**

---

## What it does

- Runs many browser sessions at once, each with its own proxy and its own
  persistent profile
- Keeps accounts signed in between drops, so a second drop does not repeat the
  first drop's login
- Fills Walmart login codes automatically from your email
- Watches Discord channels for drop alerts and starts your sessions for you
- Shows every session's live phase in one table, and sends alerts when a session
  gets through
- Opens a window for you when a challenge needs a person

---

## Installation

### Windows

1. Download `KNULL-Queue-Destroyer-Setup-x.y.z.exe` from the latest release
2. Run it and follow the prompts
3. Launch from the Start Menu or the desktop shortcut

### macOS

1. Download `KNULL-Queue-Destroyer-x.y.z-arm64.dmg`
2. Mount it and drag the app to Applications
3. Launch normally — current builds are signed and notarized

**Apple Silicon only** — there is no Intel build. Windows and macOS ship under
the same version tag; if the newest release has no mac files yet, use the newest
one that does. On an older unsigned build, right-click → **Open** the first time.

---

## First-time setup

Work through these in order. Each step depends on the one before it.

### 1. Activate

Enter your license key on the Activation screen. Keys are tied to one device —
if you need to move machines, use **Settings → Sign Out / Re-activate** on the
old one first.

### 2. Add proxies

**Proxies → Add**, then create a proxy group. Residential proxies are what these
sites expect; datacenter addresses are usually refused before you see a page.

One proxy is used per session. If you plan to run twenty sessions, you want
twenty proxies — the app will share them rather than refuse to start, and it
will warn you on screen when it has to, but sharing an address across accounts
is visible to the retailer.

### 3. Add accounts

**Accounts → Add**, in `email:password` format. Bulk paste works.

Pokémon Center does not need accounts — it checks out as a guest — so this step
is only for Walmart and Costco.

### 4. Create a task group

**Tasks → New Group**. A group ties together:

- a retailer
- the accounts it will use
- the proxy group it draws from
- how many sessions to run
- what to do when a session fails

Groups are the unit everything else works on — you start, stop and trigger a
group, not individual sessions.

### 5. Set up email codes (Walmart)

**Settings → IMAP**. Walmart emails a code at login and the app fills it in for
you. Run the test until it passes; if it does not, sessions will sit on
**Logging In** forever.

### 6. Optional — Discord alerts

**Settings → Webhook** to receive alerts when a session gets through, and
**Discord Monitor** to have drops start your groups automatically.

---

## Running a Walmart drop

### The first time

1. Click **Start** on your group — one browser opens per account at the login page
2. Codes arrive by email and fill themselves in
3. Sessions settle on **Waiting for Product**
4. At drop time, paste the SKU into the **SKU field** and press Enter
5. Sessions go to the product page and enter the queue
6. Complete checkout yourself when your position comes up

### Every drop after that

Nothing to switch on. Each account keeps its own browser profile, so signed-in
state carries over.

1. Click **Start** — accounts still signed in land straight on **Waiting for Product**
2. Any account whose login has lapsed re-runs the login on its own
3. Paste the SKU at drop time

> **Never stop a session that is In Queue.** You lose the place. Stop All skips
> them on purpose.

---

## Running a Pokémon Center drop

Pokémon Center works differently from Walmart and it is worth knowing how before
drop day.

- **No accounts and no sign-in.** Checkout is as a guest, so there is nothing to
  log into and nothing to keep signed in between drops.
- **There is a waiting room.** After the product goes live you are held on a
  waiting page — the one with the animated character — and given a countdown that
  moves up and down with traffic. The app reads that countdown and shows it.
- **A challenge can appear at any point.** See below.

The flow:

1. Create a Pokémon Center group with a proxy group and a session count
2. Start it before the drop so sessions are already on the site
3. When the drop opens, sessions move to the waiting room on their own
4. The session table shows the queue position or countdown as it changes
5. When a session clears the waiting room you get an alert naming that session
6. Go to that window and complete checkout

Because there is no account, the alert names the **session**, not an email
address — six windows look identical and only one of them is the one to go to.

---

## When a challenge appears

Some sessions will be asked to prove they are a person. The app tries to deal
with it, and hands it to you when it cannot.

- If it can be handled automatically, it is, and the session carries on.
- If not, a **solve window opens** for that session. Solve it and the session
  continues from where it was.
- The **Captcha Solver** page shows which sessions are waiting on a person and
  lets you open a window yourself.

You do not lose your place by taking a moment on one of these — but a session
sitting unanswered is not progressing, so the alert is worth watching for.

If a Pokémon Center session gets stuck on a device-verification screen that never
resolves, use **Rotate Session + Proxy** (the pencil icon) to give it a fresh
browser profile on a different address.

---

## The session table

Sessions are colour-coded down the left edge:

| Colour | Meaning |
|---|---|
| 🟡 Yellow | Logging In — signing in |
| 🔵 Blue | Waiting for Product — ready |
| 🟢 Green | In Queue — do not stop it |
| 🔴 Red | Error |

- **Filter chips** narrow the table to one phase
- **Click any column header** to sort
- **Checkboxes** select rows for Stop or Delete

---

## Discord Monitor

Watches a channel and starts a group when a drop is posted.

1. **Discord Monitor → + Add Monitor**
2. Choose the retailer, paste the Discord channel ID, link the task group
3. **Save**, then **▶ Start**

---

## Settings

| Setting | What it does |
|---|---|
| IMAP | Fills Walmart login codes from your email |
| Webhook | Where drop alerts are sent |
| Check Trigger Live Status | Confirms the app is reaching the trigger server |
| Force Trigger Resync | Reconnects a stale connection |
| Sign Out / Re-activate | Clears the stored activation |
| Check for Updates | Manual update check |
| Auto Update | Off by default — turn it on only if you want updates applied without asking |
| Import / Export Config | Backup and restore groups, proxies, monitors and profiles |

Exported configs contain your groups, URLs and account emails. They do **not**
contain proxy credentials. Keep them private regardless.

---

## Troubleshooting

**Sessions stuck on Logging In.** Check **Settings → IMAP** and run the test.
Open the inbox and confirm a code actually arrived.

**Trigger connection keeps closing (1006).** Click **Force Trigger Resync**. If
it keeps failing after the machine has slept, Sign Out and re-activate.

**Stop All left some sessions running.** Sessions In Queue are skipped on
purpose, so you do not lose the place.

**"Cannot find latest.yml".** A release is mid-publish. Wait a minute and check
again.

**A Pokémon Center session sits on device verification.** Rotate Session + Proxy
for a fresh profile and address.

**Sessions fail immediately on start.** Usually the proxy. Check the proxy group
has working entries and that you have enough of them for the session count.

**A challenge window opened and I closed it.** Reopen it from the **Captcha
Solver** page.

---

## Version history

See the [releases page](https://github.com/KNULL-AI/KNULLS-QD-Releases/releases)
— every release carries its own notes.

---

## Support

Include:

1. App version — **Settings → General → App Updates**
2. Your OS and version
3. Which page or action failed
4. The relevant part of **Logs**
5. Whether it happens every time

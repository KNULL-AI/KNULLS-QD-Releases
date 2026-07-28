# KNULL Queue Destroyer - Setup Video Script (Draft)

Estimated runtime: 4-5 minutes
Audience: New users installing and activating for the first time
Tone: Fast, practical, no fluff

## 0:00 - 0:15 Intro

Voiceover:
Welcome to KNULL Queue Destroyer. In this quick setup, I will show you the fastest path from install to your first working session, plus Discord monitoring and optional IMAP verification flow.

On screen:
- App logo/title card
- Text: From install to first session in minutes

## 0:15 - 0:45 Install and Launch

Voiceover:
Start by opening the latest release in the public releases repo. Download the Windows setup executable or macOS DMG. Install, then launch the app.

On screen:
- Public releases page
- Download latest asset
- Launch app

Callout text:
Use latest release unless instructed otherwise.

## 0:45 - 1:10 Activation

Voiceover:
On first launch you will see the activation screen. Enter your user license key and click Activate. Admin keys are not valid here.

On screen:
- Activate page
- Enter key field
- Activate button

Callout text:
User key required.

## 1:10 - 1:50 Proxy Pool Setup

Voiceover:
Next, open Proxy Pool. Add your proxies and run health checks. Keep your healthy proxies active and remove dead ones.

On screen:
- Open Proxy Pool tab
- Add proxy dialog
- Run check/diagnostic action

Callout text:
Healthy proxies first.

## 1:50 - 2:20 Accounts Setup

Voiceover:
Go to Accounts and add your account credentials. If needed, assign account-level proxy behavior so each account can launch with the right network path.

On screen:
- Accounts tab
- Add account flow

## 2:20 - 3:00 Profiles and Task Groups

Voiceover:
Now open Profiles and create a reusable session profile. Then go to Task Groups and create your first group with retailer, URL, instance count, proxy group, and optional account assignment.

On screen:
- Profiles tab create profile
- Task Groups tab create group

Callout text:
For Walmart flows, account assignment affects effective instance behavior.

## 3:00 - 3:30 Sessions Test Launch

Voiceover:
Open Sessions and launch one test session. Confirm it starts correctly and remains stable. If anything fails, check Logs immediately for the root cause.

On screen:
- Sessions tab
- Launch session
- Optional stop session

## 3:30 - 4:15 Discord Monitor

Voiceover:
Open Discord Monitor to configure channel monitoring and trigger behavior. Tune cadence and cooldown to avoid duplicate launch storms.

On screen:
- Discord Monitor tab
- Add monitor card
- Show event log

Callout text:
Validate in a low-risk channel first.

## 4:15 - 4:45 Optional IMAP in Settings

Voiceover:
If you use email verification codes, open Settings and configure IMAP polling. The app can detect new codes, map them to accounts, and attempt session injection when possible.

On screen:
- Settings tab
- IMAP section
- Poll start/status

## 4:45 - 5:00 Wrap-up

Voiceover:
That is the full baseline setup. Export a config backup in Settings once everything is stable, and keep your release updated to the latest version.

On screen:
- Settings export config
- Dashboard overview
- End card

## Recording Notes

- Record at 1080p.
- Keep mouse movements deliberate.
- Pause 1 second between major transitions for cleaner caption timing.
- Avoid exposing real keys, account secrets, or proxy credentials in recording.

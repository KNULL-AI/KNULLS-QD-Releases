# KNULL Queue Destroyer

Desktop app for managing Walmart, Pokémon Center and Costco browser sessions.

**[Download the latest release](https://github.com/KNULL-AI/KNULLS-QD-Releases/releases/latest)** · [Release notes](https://github.com/KNULL-AI/KNULLS-QD-Releases/releases)

Guide updated **October 12, 2026**. Controls can vary by installed version. Check **Settings → General → App Updates** and your release notes if a control below is unavailable; use the latest release available for your platform.

## Start here

1. Install the app and activate your license.
2. Add the accounts and connections your retailer needs.
3. Create one small task group and confirm it can open its browser.
4. Follow the [Walmart](#walmart), [Costco](#costco) or [Pokémon Center](#pokémon-center) steps below.
5. Set up [challenge harvesters](#challenges-and-harvesters) and optional automatic triggers before increasing your session count.

The app prepares and monitors sessions. Complete any required verification and checkout in the retailer's browser. A ready account, cleared challenge or queue admission does not guarantee inventory or a successful purchase.

## Install and update

### Windows

1. Open the latest release and download `KNULL-Queue-Destroyer-Setup-x.y.z.exe`.
2. Run the installer and follow its prompts.
3. Launch the app from the Start Menu or desktop shortcut.

### macOS

Download the release's `KNULL-Queue-Destroyer-x.y.z-arm64.dmg`, open it and drag the app into Applications. macOS builds support **Apple Silicon**. Check the release's actual assets: a Windows release may be available before its macOS build. Use the latest release that includes your platform.

### Updates

Open **Settings → General → App Updates → Check for Updates** to see your version and check manually. Install between runs. **Auto Update** can restart the app and interrupt running browsers; keep it off while participating in a drop.

## First-time setup

### Activate

Enter your license key on the Activation screen. **Settings → General → Sign Out / Re-activate** clears the activation session. It keeps a locally saved key; **Forget Saved Key** removes that saved key from the device.

### Add connections

In **Proxy Pool**, create a proxy group, select it and use **Add Proxies**. Supported entry formats include `host:port` and `host:port:user:pass`. Use **Test Proxies** and inspect the result before assigning the group.

A connection test confirms connectivity at that moment. It does not establish that a retailer will accept the connection. Keep connections stable while accounts are signed in or holding queue progress.

Proxy group members have numbered labels, for example **pkcresi 1** and **pkcresi 2**. Session rows show their assigned label and active sharing of the same saved entry. Review the group allocation preview and reuse policy before launching. **Require an unused proxy per session** needs enough unused configured connections; it cannot guarantee distinct public exit addresses.

**Measure exit** on a running proxied session performs one ipify lookup through that session and shows its time, sampled address and matching recent samples. It does not run automatically or change assignments. Samples become stale after five minutes; failed or refused lookups remain unknown. An exit measured at one destination does not prove which address a store saw or explain an access refusal.

Costco has separate account sign-in and task connections; use its [connection table](#costco-connections) below. For other retailers, review both the task group's proxy pool and any account-specific assignment before launching.

### Add accounts

Open **Accounts**, choose the retailer, then **Add Account**. Enter a label and email, plus a password where required. Accounts are added **one at a time**.

- **Walmart:** assign your saved accounts to the Walmart task group. Configure IMAP if you want the app to retrieve email verification codes.
- **Costco:** choose **Password** or **Email code (OTP)** for each account. Email-code mode does not require a password. Both pathways warm the account before sign-in. Additional verification can still require you.
- **Pokémon Center:** task groups can run without assigned accounts. The Accounts page also offers Pokémon Center sign-in, but account reuse in task sessions is not yet verified.

### Set up email codes

In **Settings → IMAP**, use **Add** for each mailbox, enter its details, then **Save** and **Test**. Enable the mailbox with its switch and confirm polling is running. **Start all** and **Stop all** control the configured mailboxes together. Use the mailbox provider's required app password where applicable.

The app matches eligible retailer codes to the account requesting them. Mailbox connectivity alone does not confirm code delivery or successful sign-in. If a code is missing, check the account's email address, mailbox status and the actual retailer window.

### Create a task group

In **Tasks**, choose **New Group**, name it and select the retailer. Open **Configure** to assign accounts or an instance count, connections and launch pacing.

**Launch Delay** spaces launches within a group. **Hold After Release** is a
Walmart-only option for delaying the group relative to its trigger. Costco and
Pokémon Center groups do not show or apply it, including any older saved value.

Two controls govern automatic triggers:

| Control | Meaning |
| --- | --- |
| **Armed** | The group can respond to a matching trigger. Disarmed groups can still be launched manually. |
| **Live drops** | On: real alerts. Off: test alerts. Check this before expecting a live drop to launch the group. |

Saving new defaults does not reroute a browser already running. Restarting a stopped session can apply the current proxy group. Read the change summary and launch preflight before applying the configuration to new sessions.

## Walmart

### Prepare and choose the product

1. Select your Walmart task group and assign its accounts and proxy pool.
2. Use **Start All** or **Launch Pool** to prepare the accounts. No SKU is needed just to prepare.
3. Confirm the sessions reach **Waiting for Product**. Open any account needing a code or manual verification.
4. Enter a Walmart SKU or product URL in the selected group's **SKU** field. Set the drop time in **Eastern Time (ET)** and the **Lead** time, then choose **Apply SKU & Arm**.
5. Check the displayed product and scheduled date/time in ET. The group shows **one armed SKU or no SKU armed**; it does not launch a list of historical SKUs.
6. At the scheduled occurrence, eligible sessions navigate to that product. For an immediate manual dispatch, use **Drop Now** on the selected group and check its dispatch result.

**Apply SKU & Arm schedules the product; it is not an immediate product launch.** Changing the time or lead disarms the schedule until you apply it again. Both the time input and armed summary use **Eastern Time (ET)**, with daylight-saving changes handled for New York. Enter the retailer's Eastern drop time regardless of your computer's timezone. If you missed the preparation lead, use **Start All** or **Launch Pool** yourself.

To change products, apply the replacement SKU to the same group and verify the displayed armed SKU. To stop automatic scheduling, turn off the schedule switch. Manual **Drop Now** can still use that group's last scheduled product, so review its button and result before clicking.

### Read queue progress

Keep **In Queue** sessions running. A waiting-page message such as “You are in!” or a countdown can still mean you are waiting; the app requires current admission evidence before treating it as a purchase window.

Open **Walmart run summary** in the session row for admission, product observation, cart and sign-in evidence, and when the page was last checked. A stale observation is a reason to inspect the browser; it is not proof that the queue ended. A successful dispatch means navigation was sent, not that every account entered the queue.

When admitted, focus that session and complete checkout. Product availability and cart acceptance remain separate results.

## Costco

Costco drops launch from a **product link**. Preparing ahead of time reduces the work needed after an alert; you can also paste a product link and launch a cold account, which warms up first.

### Costco connections

| Setting | Where to set it | Used for |
| --- | --- | --- |
| Account login connection | **Accounts → Costco → Edit → Proxy Assignment** | Preparing and signing into the saved account profile. **None (direct)** is a useful starting setup; a proxy can be selected. |
| **Task proxy pool** | Costco group's **Configure → Costco task connections** | Preparing the task browser, opening products and joining queues. |
| **Optional Direct account** | Same task connection section | One selected account can use Direct instead of a task proxy. Only one Direct account is allowed across active Costco tasks. |

Every other selected account needs an available task proxy with a distinct measured exit address. Multiple proxy entries may still share one exit address. The app checks for this before preparation and reports conflicts; it does not silently fall back to Direct or rotate a running task connection.

An account's additional queue tabs share its task connection and signed-in browser state. **You do not need a separate proxy for each tab.** Changing task connection settings does not change the saved account's login connection.

### Prepare before the drop

1. In **Accounts → Costco**, sign into each account using its selected method. Complete any verification in that account window and check its reported result.
2. In the Costco group's **Configure** dialog, select those accounts, the **Task proxy pool** and, optionally, one **Direct account**.
3. Set **Requested tabs per account** to **1** to start. This number is independent of the proxy count; selected accounts determine the account browsers.
4. Enable **Keep prepared accounts ready for a product alert** if you want continuing readiness checks while waiting. Save the configuration.
5. Select **Prepare accounts**. Follow **Preparation & queue positions** until each intended account reports current preparation. **Warming up** is an expected phase.
6. If **Focus account sign-in** appears, use it to finish the account flow. A saved profile alone is not proof that its task browser is ready.

Keep the app running and the machine awake while waiting. Keep ready uses browser activity and therefore connection traffic. Lost sign-in, stale preparation, access refusal or a changed connection can require attention; read the account's reason before retrying.

An empty Costco group can be saved as a draft. Removing its last account also disarms the group and clears its Direct assignment; review these changes before Save. Assign accounts and valid task connections before arming or launching it.

The queue can show **Verifying browser** during a background check, or ask for **Continue in queue window** / **Your turn · check queue window**. Focus the browser and follow any visible retailer prompt. A verification stage, a configured list of challenge methods or a your-turn message does not by itself establish admission or a purchase window.

An in-app attention alert names the account and tab when a your-turn or Continue state is detected. **Focus** opens that existing tab; it does not answer the retailer's prompt. **Dismiss** hides that episode's alert. The app does not bring the browser forward automatically, so keep its progress visible when your turn is approaching.

**Queue entry denied** and **Queue entry rate limited** pause automatic activity for the affected task. Inspect the browser before using **Prepare accounts** to explicitly retry. Repeated alerts, Keep ready and restock watching do not bypass that pause. Manual Reload remains available but does not clear the automatic-task pause. These messages do not by themselves mean the saved account is signed out.

### Launch a product

Paste the HTTPS Costco product URL into the group's product field and click **Launch product**. Ready accounts use their prepared browsers. Cold accounts prepare first; a required sign-in is shown separately before the task can proceed. Automatic product alerts use the same preparation path.

**Fallback product link** in Configure is optional. You can always paste a current product link into the group controls for a manual launch. **Test queue entry** is a separate diagnostic for an event entry link; it opens one tab per account and does not test multiple queue positions.

### Queue tabs, memory and links

The panel distinguishes entering a queue, verification, joining, a held position and an ended event. **Queue position not observed** means the app has not yet established a position; seeing an entry page or checkbox is insufficient.

Additional tabs wait until the first tab has a positively observed held position and existing pages remain healthy. The requested count is a limit, not a promise. Memory checks open pages gradually and can pause expansion below your requested count. The panel shows system/process memory and estimated capacity; per-tab memory is an estimate because pages can share browser processes.

The first browser and extra tabs use separate memory estimates. Extra-tab allowance begins conservatively and can decrease after qualified observations; later allocations can raise it again. **Capacity paused** means the next launch lacks qualified app/system headroom. Existing tabs stay open. This is not a fixed limit such as 20 tabs; free memory and review the estimate before explicitly retrying expansion.

Use a position's **Focus**, **Queue details** or **Copy full link** controls to inspect that tab. Treat a copied queue link as sensitive. The app exposes the observed link; using it in another browser, sharing it and completing checkout with it are not yet verified. Additional tabs do not create additional Costco accounts or change retailer purchase limits.

If expansion reports a failure, existing positions are preserved. Review the reason; **Launch product** with the same URL can retry expansion after current holding evidence is checked.

### Stock, cancellations and restocks

For drops, **In stock**, **Out of stock** or **Stock unknown** describe delivery availability for the selected product. Warehouse availability is separate and does not make a delivery-only item purchasable. Products without colors or other options use the same stock display. Unknown can mean the page is loading, the selection is incomplete or the available evidence is inconclusive.

**Out of stock does not mean the event is over.** Returned inventory can appear while the event is still active.

For a product that needs fresh page loads:

1. Select the option you want, if the product has options.
2. In its preparation panel, choose a **Restock reload interval** of 5, 10 or 30 seconds; the default is 10.
3. Click **Watch for restock**.
4. Read the watch status. It reloads only after a fresh out-of-stock reading, waits on unknown stock and stops when stock is found.
5. Review the retailer page and complete any purchase yourself. The watch does not add to cart or check out.

A confirmed selection change stops the watch: review the new selection and restart it if wanted. Queue or verification progress, access refusal, a confirmed event end, Stop or sleep/resume also stops the watch. Short restocks can fall between checks; no interval guarantees a cancellation purchase.

### Manual reload

Inside a Costco task browser, use **Reload** beside the tabs, **F5** or **Ctrl+R** for the selected task tab, including while loading, in a queue or during verification. While loading, the button becomes **X — stop loading**; click it or press **Esc** to stop. These actions stop that tab's restock watch, so restart **Watch for restock** afterward if wanted. Refreshing can affect the site's queue progress.

### Current Costco limits

Costco reCAPTCHA handling remains manual. BotDeflector uses an experimental automatic model when available, with bounded attempts and manual fallback; live Costco acceptance is not verified. Activated apps check for the model automatically, and **Settings → BotDeflector model updates** shows its status. Active-event admission, multiple distinct queue spots and shared-link behavior still need live-drop validation. Extra tabs require a confirmed first held position and sufficient memory.

## Pokémon Center

1. Create a Pokémon Center group and choose its proxy group, **Instances** and launch pacing.
2. Start the group or configure a matching automatic trigger.
3. Watch each session's queue and challenge status. Use its **Focus** action when attention is needed.
4. When the retailer allows you through, complete checkout in that session's browser.

A task group does not require an account assignment. Waiting-room appearance and timing can vary by event. Alerts identify the session so you can find the correct window.

Automatic support exists for supported Pokémon Center challenge paths, with bounded attempts and manual handoff. A cleared challenge is separate from successful storefront access. Use recovery or rotation only after reviewing the affected session; replacing a browser or connection can discard its progress.

## Challenges and harvesters

A **harvester** is a slot that routes a current challenge to the appropriate solving workflow. In **Captcha Solver**, create or edit a harvester and choose **Retailer / challenge family**:

| Retailer | Family | What to expect |
| --- | --- | --- |
| Pokémon Center | hCaptcha / DataDome | Existing supported automatic paths and manual fallback. |
| Walmart | PerimeterX | Existing supported handling and manual attention when needed. |
| Costco | reCAPTCHA / BotDeflector | Manual reCAPTCHA; experimental automatic BotDeflector when a model is available, with manual fallback in the owning window. |

Create separate Costco and Pokémon Center harvesters if you run both. A slot accepts only its own retailer's current session and challenge. reCAPTCHA, BotDeflector and hCaptcha assignments are not interchangeable. When Costco changes verification provider, the harvester follows the new visible stage in that session.

When Costco verification needs manual input, finish it in the displayed Costco window. The app observes the result. Opening or closing the window is not a successful solve. An event ending releases the assignment without claiming that verification succeeded. Collection and model availability are separate from verified acceptance.

If a challenge remains unresolved, use **Captcha Solver** and the affected session's **Focus** control to find it. Do not assume unlimited time: challenges, queue positions and purchase windows may expire.

An automatic attempt that hands off leaves the browser open and frees its automatic harvester after pending input cleanup. **Needs manual input · automatic harvester freed** indicates that distinction. A **releasing** slot is still cleaning up; an explicitly Manual harvester keeps its assignment until it ends. Open windows and occupied harvesters are different counts.

**In-frame Capture** contains the remaining challenge diagnostic options. The separate **Challenge extraction** setting has been removed; recording does not enable automatic solving.

## Session controls and progress

Ordinary session browsers have **Back**, **Forward** and **Refresh**. While loading, Refresh becomes **X — stop loading**. **F5** / **Ctrl+R** refresh and **Esc** stops loading. Page-initiated refreshes are allowed. Stopping a load cancels pending app recovery for it; automatic recovery still uses its own checks.

Each task row has an individual **Stop** action. The runtime summary separates open browsers, automatic assignments, free harvesters, manual attention and pending work. **Focus next needing attention** opens the next affected session. **Export run scorecard** saves the current run's recorded attempts and milestones for review.

The queue leaderboard includes test sessions and a timer when an estimate is available. Storefront, cart and checkout progress remain distinct; a successful cart request or checkout page does not confirm **Order placed**.

## Automatic triggers and alerts

Retailer discovery is global and managed by the backend. In **Monitor**, check the
connection status and **Event Log**; eligible alerts dispatch to armed groups for
that retailer. Group **Live drops** controls whether the group accepts real alerts
or test alerts. There is no channel or single linked group to attach in the monitor
editor. An online connection alone does not prove an alert was received or launched.

For Pokémon Center and Walmart, a second automatic launch is skipped and recorded while the same group and live/test scope is already starting or running. Separate test groups can run alongside live groups. Manual launches remain available, and a stopped group can respond to its next eligible trigger. The guard does not change a group's requested instance count or existing cooldown rules.

Costco product alerts use their prepared account browsers. Existing parents remain available for those actions; the Costco runtime handles duplicate product requests and retains its account, queue and refusal checks.

For Walmart feed items, **Set as SKU** selects the product for the chosen group.
Go to Tasks, verify that product and use **Apply SKU & Arm** before dispatching it
with **Drop Now** or its schedule. Set as SKU alone does not replace an existing
armed schedule or navigate open sessions.

Before relying on an automatic launch:

- Confirm the correct task group is **Armed** and **Live drops** is on for a real alert.
- Confirm the intended retailer is listed in Monitor and review its eligible groups and Event Log.
- Use **Settings → General → Check Client Live Status** for the trigger connection. **Force Client Resync** reconnects it when needed.
- Keep the app running. A configured trigger cannot prepare accounts while the app is closed.

A webhook sends notifications; it does not itself start a group. Configure the relevant webhook setting if you want external alerts. Keep a manual launch plan available: Walmart **Drop Now**, Costco **Launch product**, or the group's normal start controls.

## Focus, stop and protect progress

Use a session's **Focus** or browser action to open its actual window. Costco Focus selects the corresponding tab in its account browser.

**Stop All** reviews protected queue progress before closing it. You can stop only non-queue sessions, or continue through the explicit confirmations to stop everything and forfeit progress. Closing the entire app also interrupts sessions. Read the confirmation instead of assuming protected sessions will always survive the action.

## Back up configuration

Use **Settings → Import / Export Config** for portable configuration. It includes group names, target URLs, monitor channel IDs and keywords, and browser settings.

It omits account/proxy records and assignments, webhook URLs, monitor credentials, schedules and running-session state. It is **not a full backup of credentials, signed-in profiles or queue positions**. Imported groups and monitors remain disabled until you reconnect the missing settings and review them. Keep exported files private.

## Troubleshooting

| Problem | Next step |
| --- | --- |
| A group did not respond to an alert | Check Armed, Live drops, the linked retailer/group and monitor/trigger status. |
| Walmart is still logging in | Check enabled IMAP mailboxes and code delivery, then Focus the browser for additional verification. |
| Walmart says stale while the browser is still in line | Inspect the browser and Walmart run summary; stale evidence does not mean admission or an ended queue. Preserve the running window while investigating. |
| Costco preparation is suspended or not current | Read its reason. Check the account's sign-in, task connection and current browser before explicitly preparing again. |
| Costco queue entry is denied or rate limited | Inspect the browser. Automatic retries are paused; use Prepare accounts deliberately when ready to recheck. |
| Costco sign-out window stays open | Complete sign-out on the retailer page and read the account status. The app closes after confirming signed-out state and local cleanup; a cleanup warning requires attention. |
| Costco reports duplicate task exits or no connection capacity | Assign a task proxy with a different exit address to each additional account; only one active account can use Direct. |
| Costco shows Stock unknown | Let the product finish loading and select any required option. Check fulfillment restrictions. Unknown is not an out-of-stock verdict. |
| Costco restock watch stopped | Read its outcome. In-stock detection, selection changes and protected/error states stop refreshes. Review before restarting. |
| Refresh shows X instead | The page is loading. Click X or press Esc to stop that load; F5/Ctrl+R requests a fresh reload. |
| Fewer Costco tabs opened than requested | Check first-position evidence, existing tab health, memory capacity and any expansion pause. |
| A challenge window disappeared | Inspect the session and Captcha Solver; the event may have ended or the current assignment changed. |
| Trigger connection closed | Try Force Client Resync. If still failing, inspect connectivity and activation before signing out and reactivating. |
| An update reports missing files | Check the release's assets; publishing may still be in progress. Retry after the release is complete. |
| Local protected credentials cannot be read | Restart once, retain the existing app data and contact support with the warning. Do not delete profiles to troubleshoot blindly. |

## Support

Include your app version, operating system, retailer, the action you attempted, the status shown and whether it repeats. Add a relevant Logs excerpt or screenshot after removing credentials, verification codes, private queue links and other account data.

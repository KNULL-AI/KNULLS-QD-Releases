/**
 * Electron Bridge — all IPC calls to Electron's main process.
 * Gracefully no-ops in browser preview so the UI never crashes.
 */

function invoke(channel, ...args) {
  if (typeof window !== "undefined" && window.electronAPI?.[channel]) {
    return window.electronAPI[channel](...args);
  }
  console.warn(`[electronBridge] ${channel} (no-op — not in Electron)`);
  return Promise.resolve({ ok: false, error: "Not running in Electron" });
}

/** Launch a browser instance for a session */
export function launchBrowser({ sessionId, url, proxy, userAgent = null, browser = "chrome", profile = null, noPreload = false, manualOpen = false, credentials = null, partitionKey = null }) {
  return invoke("launchBrowser", { sessionId, url, proxy, userAgent, browser, profile, noPreload, manualOpen, credentials, partitionKey });
}

/** Kill a running browser session */
export function killBrowser(sessionId) {
  return invoke("killBrowser", sessionId);
}

/** Bring an existing task BrowserWindow to the front without re-launching it */
export function focusBrowser(sessionId) {
  return invoke("focusBrowser", sessionId);
}

/**
 * Fetch Discord messages via Electron's main process (bypasses CORS & keeps tokens server-side).
 */
export function fetchDiscordMessages(authHeader, channelId, afterId) {
  return invoke("fetchDiscordMessages", { authHeader, channelId, afterId });
}

/** Fetch all guilds (servers) the user/bot belongs to */
export function fetchDiscordGuilds(authHeader) {
  return invoke("fetchDiscordGuilds", { authHeader });
}

/** Fetch text channels for a given guild */
export function fetchDiscordGuildChannels(authHeader, guildId) {
  return invoke("fetchDiscordGuildChannels", { authHeader, guildId });
}

/**
 * Health-check a proxy via Electron's main process (real HTTP request).
 * @param {{ host, port, protocol, username, password }} proxy
 */
export function checkProxy(proxy) {
  return invoke("checkProxy", proxy);
}

export function diagnoseProxy(proxy, url) {
  if (typeof window !== "undefined" && window.electronAPI?.diagnoseProxy) {
    return window.electronAPI.diagnoseProxy(proxy, url);
  }
  console.warn("[electronBridge] diagnoseProxy (no-op — not in Electron)");
  return Promise.resolve({ status: 0, error: "Not running in Electron" });
}

/** Inject a solved captcha token into a running browser session window */
export function injectCaptchaToken(sessionId, type, token) {
  return invoke("injectCaptchaToken", { sessionId, type, token });
}

/** POST a Discord webhook via Electron's main process (keeps URLs/tokens server-side) */
export function sendDiscordWebhook(url, content) {
  if (typeof window !== "undefined" && window.electronAPI?.sendDiscordWebhook) {
    return window.electronAPI.sendDiscordWebhook(url, content);
  }
  console.warn("[electronBridge] sendDiscordWebhook (no-op — not in Electron)");
  return Promise.resolve({ ok: false, error: "Not running in Electron" });
}

/** Fetch unseen IMAP messages from the shared inbox (returns codes + metadata) */
export function imapFetch(config) {
  return invoke("imapFetch", config);
}

/** Inject a verification code into an open session's browser window */
export function injectVerificationCode(sessionId, code) {
  return invoke("injectVerificationCode", sessionId, code);
}

/** Start a per-second queue timer for a session in the main process */
export function startQueueTimer(sessionId, currentMs = 0) {
  return invoke("startQueueTimer", { sessionId, currentMs });
}

/** Stop the queue timer for a session */
export function stopQueueTimer(sessionId) {
  return invoke("stopQueueTimer", sessionId);
}

/** Subscribe to queue timer ticks from the main process. Returns the wrapper to pass to off*. */
export function onQueueTimerTick(cb) {
  if (typeof window !== "undefined" && window.electronAPI?.onQueueTimerTick) {
    return window.electronAPI.onQueueTimerTick(cb);
  }
  return cb;
}

export function offQueueTimerTick(wrapper) {
  if (typeof window !== "undefined" && window.electronAPI?.offQueueTimerTick) {
    window.electronAPI.offQueueTimerTick(wrapper);
  }
}

/** Subscribe to session crash events from the main process. Returns the wrapper to pass to off*. */
export function onSessionCrashed(cb) {
  if (typeof window !== "undefined" && window.electronAPI?.onSessionCrashed) {
    return window.electronAPI.onSessionCrashed(cb);
  }
  return cb;
}

export function onSessionLoadFailed(cb) {
  if (typeof window !== "undefined" && window.electronAPI?.onSessionLoadFailed) {
    return window.electronAPI.onSessionLoadFailed(cb);
  }
  return cb;
}

export function offSessionLoadFailed(wrapper) {
  if (typeof window !== "undefined" && window.electronAPI?.offSessionLoadFailed) {
    window.electronAPI.offSessionLoadFailed(wrapper);
  }
}

export function offSessionCrashed(wrapper) {
  if (typeof window !== "undefined" && window.electronAPI?.offSessionCrashed) {
    window.electronAPI.offSessionCrashed(wrapper);
  }
}

/** Subscribe to session launch events from the main process. Returns wrapper for off*. */
export function onSessionLaunched(cb) {
  if (typeof window !== "undefined" && window.electronAPI?.onSessionLaunched) {
    return window.electronAPI.onSessionLaunched(cb);
  }
  return cb;
}

export function offSessionLaunched(wrapper) {
  if (typeof window !== "undefined" && window.electronAPI?.offSessionLaunched) {
    window.electronAPI.offSessionLaunched(wrapper);
  }
}

/** Subscribe to captcha lifecycle events from task windows. Returns wrapper for off*. */
export function onCaptchaEvent(cb) {
  if (typeof window !== "undefined" && window.electronAPI?.onCaptchaEvent) {
    return window.electronAPI.onCaptchaEvent(cb);
  }
  return cb;
}

export function offCaptchaEvent(wrapper) {
  if (typeof window !== "undefined" && window.electronAPI?.offCaptchaEvent) {
    window.electronAPI.offCaptchaEvent(wrapper);
  }
}

/** Subscribe to the tray "Kill All Sessions" event. Returns the wrapper to pass to off*. */
export function onAllSessionsKilled(cb) {
  if (typeof window !== "undefined" && window.electronAPI?.onAllSessionsKilled) {
    return window.electronAPI.onAllSessionsKilled(cb);
  }
  return cb;
}

export function offAllSessionsKilled(wrapper) {
  if (typeof window !== "undefined" && window.electronAPI?.offAllSessionsKilled) {
    window.electronAPI.offAllSessionsKilled(wrapper);
  }
}

/** Run Gemini AI diagnostics on logs + proxy health — key never leaves main process */
export function geminiAnalyze(logs, proxySummary) {
  return invoke("geminiAnalyze", { logs, proxySummary });
}

/** POST to a Cloudflare Worker endpoint via main process (bypasses Electron CORS restrictions) */
export function cfRequest(url, body) {
  return invoke("cfRequest", { url, body });
}

export function getDeviceId() {
  return invoke("getDeviceId");
}

export function getAppVersion() {
  return invoke("getAppVersion");
}

export function checkForUpdatesManual() {
  return invoke("checkForUpdatesManual");
}

export function getUpdateStatus() {
  return invoke("getUpdateStatus");
}

export function onUpdateStatus(cb) {
  if (typeof window !== "undefined" && window.electronAPI?.onUpdateStatus) {
    return window.electronAPI.onUpdateStatus(cb);
  }
  return cb;
}

export function offUpdateStatus(wrapper) {
  if (typeof window !== "undefined" && window.electronAPI?.offUpdateStatus) {
    window.electronAPI.offUpdateStatus(wrapper);
  }
}

/** Start/stop the background IMAP poll loop — runs in main process, survives page navigation */
export function startImapPoll() {
  return invoke("startImapPoll");
}

export function stopImapPoll() {
  return invoke("stopImapPoll");
}

export function getImapPollStatus() {
  return invoke("getImapPollStatus");
}

/** Subscribe to IMAP poll results/errors from the main process. Returns the wrapper to pass to off*. */
export function onImapPollEvent(cb) {
  if (typeof window !== "undefined" && window.electronAPI?.onImapPollEvent) {
    return window.electronAPI.onImapPollEvent(cb);
  }
  return cb;
}

export function offImapPollEvent(wrapper) {
  if (typeof window !== "undefined" && window.electronAPI?.offImapPollEvent) {
    window.electronAPI.offImapPollEvent(wrapper);
  }
}
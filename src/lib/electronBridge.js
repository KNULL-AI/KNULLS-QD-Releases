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
export function launchBrowser({ sessionId, url, proxy, userAgent, browser = "chrome", profile = null, noPreload = false, manualOpen = false, credentials = null }) {
  return invoke("launchBrowser", { sessionId, url, proxy, userAgent, browser, profile, noPreload, manualOpen, credentials });
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

/** Fetch the identity of the token holder (/users/@me) */
export function fetchDiscordMe(authHeader) {
  return invoke("fetchDiscordMe", { authHeader });
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

/**
 * AYCD AutoSolve API call via Electron's main process.
 * @param {string} action - 'test' | 'submit' | 'poll'
 * @param {object} params
 */
export function aycdCall(action, params = {}) {
  return invoke("aycdCall", { action, ...params });
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

export function offSessionCrashed(wrapper) {
  if (typeof window !== "undefined" && window.electronAPI?.offSessionCrashed) {
    window.electronAPI.offSessionCrashed(wrapper);
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

/** Open Discord OAuth2 popup, intercept code, exchange via Cloudflare Worker */
export function discordOAuthLogin(cfEndpoint) {
  if (typeof window !== "undefined" && window.electronAPI?.discordOAuthLogin) {
    return window.electronAPI.discordOAuthLogin(cfEndpoint);
  }
  return Promise.resolve({ error: "Not running in Electron" });
}
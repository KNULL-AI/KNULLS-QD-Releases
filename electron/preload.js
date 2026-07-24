/**
 * Electron Preload — exposes safe IPC methods to the renderer (React app).
 * contextIsolation: true keeps Node.js out of the renderer while still
 * allowing controlled access via contextBridge.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Generic IPC invoke — used by db.js for SQLite calls
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),

  // Browser session management
  launchBrowser: (config) => ipcRenderer.invoke("launch-browser", config),
  killBrowser: (sessionId) => ipcRenderer.invoke("kill-browser", sessionId),
  focusBrowser: (sessionId) => ipcRenderer.invoke("focus-browser", sessionId),

  // Discord — messages fetched from main process to avoid CORS and keep tokens off renderer
  fetchDiscordMe: (params) => ipcRenderer.invoke("fetch-discord-me", params),
  fetchDiscordMessages: (params) => ipcRenderer.invoke("fetch-discord-messages", params),
  fetchDiscordGuilds: (params) => ipcRenderer.invoke("fetch-discord-guilds", params),
  fetchDiscordGuildChannels: (params) => ipcRenderer.invoke("fetch-discord-guild-channels", params),

  // Proxy health checks — real HTTP requests from main process
  checkProxy: (proxy) => ipcRenderer.invoke("check-proxy", proxy),
    diagnoseProxy: (proxy, url) => ipcRenderer.invoke("diagnose-proxy", { proxy, url }),

  // Captcha token injection into task windows
  injectCaptchaToken: (params) => ipcRenderer.invoke("inject-captcha-token", params),

  // Discord webhook — POST from main process so webhook URLs stay out of the renderer
  sendDiscordWebhook: (url, content) => ipcRenderer.invoke("send-discord-webhook", { url, content }),

  // IMAP — fetch unseen verification emails + inject codes into open sessions
  imapFetch: (config) => ipcRenderer.invoke("imap-fetch", config),
  injectVerificationCode: (sessionId, code) => ipcRenderer.invoke("inject-verification-code", { sessionId, code }),

  // IMAP background polling — runs in main process, survives renderer navigation
  startImapPoll: () => ipcRenderer.invoke("start-imap-poll"),
  stopImapPoll: () => ipcRenderer.invoke("stop-imap-poll"),
  getImapPollStatus: () => ipcRenderer.invoke("imap-poll-status"),
  onImapPollEvent: (cb) => { const wrapper = (_e, data) => cb(data); ipcRenderer.on("imap-poll-event", wrapper); return wrapper; },
  offImapPollEvent: (wrapper) => ipcRenderer.removeListener("imap-poll-event", wrapper),

  // Queue timers — main process ticks every second per session
  startQueueTimer: (sessionId, currentMs = 0) => ipcRenderer.invoke("start-queue-timer", { sessionId, currentMs }),
  stopQueueTimer: (sessionId) => ipcRenderer.invoke("stop-queue-timer", sessionId),
  onQueueTimerTick: (cb) => { const wrapper = (_e, data) => cb(data); ipcRenderer.on("queue-timer-tick", wrapper); return wrapper; },
  offQueueTimerTick: (wrapper) => ipcRenderer.removeListener("queue-timer-tick", wrapper),

  // Session crash watchdog — main notifies renderer when browser process exits
  onSessionCrashed: (cb) => { const wrapper = (_e, data) => cb(data); ipcRenderer.on("session-crashed", wrapper); return wrapper; },
  offSessionCrashed: (wrapper) => ipcRenderer.removeListener("session-crashed", wrapper),

  // Session launch diagnostics — main notifies renderer when browser windows are spawned
  onSessionLaunched: (cb) => { const wrapper = (_e, data) => cb(data); ipcRenderer.on("session-launched", wrapper); return wrapper; },
  offSessionLaunched: (wrapper) => ipcRenderer.removeListener("session-launched", wrapper),

  // Captcha lifecycle diagnostics — detected/solved/error from task windows
  onCaptchaEvent: (cb) => { const wrapper = (_e, data) => cb(data); ipcRenderer.on("captcha-event", wrapper); return wrapper; },
  offCaptchaEvent: (wrapper) => ipcRenderer.removeListener("captcha-event", wrapper),

  // Tray: notified when tray kills all sessions
  onAllSessionsKilled: (cb) => { const wrapper = (_e) => cb(); ipcRenderer.on("all-sessions-killed", wrapper); return wrapper; },
  offAllSessionsKilled: (wrapper) => ipcRenderer.removeListener("all-sessions-killed", wrapper),

  // Gemini AI diagnostics — key stays in main process, renderer only sends log text
  geminiAnalyze: (params) => ipcRenderer.invoke("gemini-analyze", params),
  setGeminiKey: (key) => ipcRenderer.invoke("set-gemini-key", key),

  // Cloudflare Worker activation requests (bypasses CORS)
  cfRequest: (params) => ipcRenderer.invoke("cf-request", params),
  getDeviceId: () => ipcRenderer.invoke("get-device-id"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  // Discord OAuth2 SSO — opens popup, intercepts redirect, returns user info
  discordOAuthLogin: (cfEndpoint) => ipcRenderer.invoke("discord-oauth-login", { cfEndpoint }),

  // Window controls
  checkForUpdatesManual: () => ipcRenderer.invoke("check-for-updates-manual"),
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
});
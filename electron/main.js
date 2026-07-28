/**
 * KNULL Queue Destroyer — Electron Main Process
 *
 * Setup:
 *   npm install electron electron-builder --save-dev
 *
 * Run in dev:
 *   npx electron .
 *
 * Build .exe:
 *   npx electron-builder --win
 *
 * package.json additions needed:
 *   "main": "electron/main.js",
 *   "build": {
 *     "appId": "com.knull.queuedestroyer",
 *     "productName": "KNULL Queue Destroyer",
 *     "win": { "target": "nsis", "icon": "electron/icon.ico" }
 *   }
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, session, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

// Persistent keep-alive agents for API calls — reuse TCP connections instead of
// opening a new socket per request under load.
const _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, keepAliveMsecs: 10000 });
const _httpAgent  = new http.Agent({  keepAlive: true, maxSockets: 32, keepAliveMsecs: 10000 });

const CHROME_FULL_VERSION = process.versions.chrome || "131.0.0.0";
const VERBOSE_MAIN_LOGS = !app.isPackaged || String(process.env.KNULL_VERBOSE_MAIN_LOGS || "").toLowerCase() === "1" || String(process.env.KNULL_VERBOSE_MAIN_LOGS || "").toLowerCase() === "true";
const WINDOWS_APP_ID = "com.knull.queuedestroyer";
const WINDOWS_ICON_PATH = path.join(__dirname, "icon.ico");
const WINDOWS_ICON = process.platform === "win32" && fs.existsSync(WINDOWS_ICON_PATH) ? WINDOWS_ICON_PATH : undefined;

function mainDebug(...args) {
  if (VERBOSE_MAIN_LOGS) {
    console.log(...args);
  }
}

// ── SQLite local database ─────────────────────────────────────────────────────
let Database;
try { Database = require("better-sqlite3"); } catch (_) { Database = null; }

const DB_PATH = path.join(app.getPath ? app.getPath("userData") : __dirname, "knull.db");
const DEVICE_ID_PATH = path.join(app.getPath ? app.getPath("userData") : __dirname, "device-id.txt");
const PENDING_UPDATE_PATH = path.join(app.getPath ? app.getPath("userData") : __dirname, "pending-update.json");

let _db = null;
function getDb() {
  if (_db) return _db;
  if (!Database) { console.warn("[knull] better-sqlite3 not available — DB calls will fail"); return null; }
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  const tables = [
    "Proxy", "ProxyGroup", "BrowserSession", "TaskGroup",
    "DiscordMonitor", "SystemLog", "SessionProfile", "ActivityEvent",
    "WalmartAccount", "ImapConfig", "VerificationCode",
    "WalmartDrop", "CaptchaConfig", "DiscordVerify", "WalmartSkuWhitelist"
  ];
  tables.forEach((t) => {
    db.prepare(`CREATE TABLE IF NOT EXISTS "${t}" (
      id TEXT PRIMARY KEY,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      data TEXT NOT NULL
    )`).run();
  });
}

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getOrCreateDeviceId() {
  try {
    if (fs.existsSync(DEVICE_ID_PATH)) {
      const existing = String(fs.readFileSync(DEVICE_ID_PATH, "utf8") || "").trim();
      if (existing) return existing;
    }
  } catch (_) {}

  const id = crypto.randomUUID();
  try {
    fs.writeFileSync(DEVICE_ID_PATH, id, "utf8");
  } catch (_) {}
  return id;
}

function rowToRecord(row) {
  if (!row) return null;
  const d = JSON.parse(row.data);
  return { id: row.id, created_date: row.created_date, updated_date: row.updated_date, ...d };
}

function recordToRow(id, data) {
  const { id: _id, created_date, updated_date, ...rest } = data;
  return { id, created_date: created_date || new Date().toISOString(), updated_date: updated_date || new Date().toISOString(), data: JSON.stringify(rest) };
}

function matchesQuery(record, query) {
  return Object.entries(query).every(([k, v]) => record[k] === v);
}

const SQL_SORT_KEYS = new Set(["id", "created_date", "updated_date"]);

function parseSort(sort = "-created_date") {
  const s = String(sort || "-created_date");
  return {
    desc: s.startsWith("-"),
    key: s.replace("-", "") || "created_date",
  };
}

function canPushDownQueryValue(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function buildJsonWhere(query = {}) {
  const entries = Object.entries(query || {});
  if (!entries.length) return { sql: "", params: [], pushdown: true };

  const clauses = [];
  const params = [];

  for (const [key, value] of entries) {
    if (!key || !canPushDownQueryValue(value)) {
      return { sql: "", params: [], pushdown: false };
    }

    const path = `$."${String(key).replace(/"/g, '\\"')}"`;
    if (value === null) {
      clauses.push("json_type(data, ?) = 'null'");
      params.push(path);
    } else {
      clauses.push("json_extract(data, ?) = ?");
      params.push(path, value);
    }
  }

  return {
    sql: ` WHERE ${clauses.join(" AND ")}`,
    params,
    pushdown: true,
  };
}

function sortRows(rows, sort) {
  const desc = sort.startsWith("-");
  const key = sort.replace("-", "");
  return [...rows].sort((a, b) => {
    const av = a[key] ?? "", bv = b[key] ?? "";
    if (desc) return bv > av ? 1 : bv < av ? -1 : 0;
    return av > bv ? 1 : av < bv ? -1 : 0;
  });
}

// ── DB IPC handlers ───────────────────────────────────────────────────────────
ipcMain.handle("db:list", (_e, { table, sort = "-created_date", limit = 500 }) => {
  const db = getDb(); if (!db) return [];

  const safeLimit = Math.max(0, Number(limit) || 0);
  const { key, desc } = parseSort(sort);
  if (SQL_SORT_KEYS.has(key)) {
    return db
      .prepare(`SELECT * FROM "${table}" ORDER BY ${key} ${desc ? "DESC" : "ASC"} LIMIT ?`)
      .all(safeLimit)
      .map(rowToRecord);
  }

  const rows = db.prepare(`SELECT * FROM "${table}"`).all().map(rowToRecord);
  return sortRows(rows, sort).slice(0, safeLimit);
});

ipcMain.handle("db:filter", (_e, { table, query = {}, sort = "-created_date", limit = 500 }) => {
  const db = getDb(); if (!db) return [];

  const safeLimit = Math.max(0, Number(limit) || 0);
  const { key, desc } = parseSort(sort);
  const where = buildJsonWhere(query);

  if (where.pushdown && SQL_SORT_KEYS.has(key)) {
    const rows = db
      .prepare(`SELECT * FROM "${table}"${where.sql} ORDER BY ${key} ${desc ? "DESC" : "ASC"} LIMIT ?`)
      .all(...where.params, safeLimit)
      .map(rowToRecord);
    return rows;
  }

  if (where.pushdown) {
    const rows = db
      .prepare(`SELECT * FROM "${table}"${where.sql}`)
      .all(...where.params)
      .map(rowToRecord);
    return sortRows(rows, sort).slice(0, safeLimit);
  }

  const rows = db.prepare(`SELECT * FROM "${table}"`).all().map(rowToRecord).filter((r) => matchesQuery(r, query));
  return sortRows(rows, sort).slice(0, safeLimit);
});

ipcMain.handle("db:get", (_e, { table, id }) => {
  const db = getDb(); if (!db) return null;
  return rowToRecord(db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id));
});

ipcMain.handle("db:create", (_e, { table, data }) => {
  const db = getDb(); if (!db) return null;
  const id = newId();
  const now = new Date().toISOString();
  const row = { id, created_date: now, updated_date: now, data: JSON.stringify({ ...data }) };
  db.prepare(`INSERT INTO "${table}" (id, created_date, updated_date, data) VALUES (@id, @created_date, @updated_date, @data)`).run(row);
  return { id, created_date: now, updated_date: now, ...data };
});

ipcMain.handle("db:update", (_e, { table, id, data }) => {
  const db = getDb(); if (!db) return null;
  const existing = rowToRecord(db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id));
  if (!existing) return null;
  const { id: _id, created_date, updated_date, ...existingData } = existing;
  const merged = { ...existingData, ...data };
  const now = new Date().toISOString();
  db.prepare(`UPDATE "${table}" SET data = ?, updated_date = ? WHERE id = ?`).run(JSON.stringify(merged), now, id);
  return { id, created_date, updated_date: now, ...merged };
});

ipcMain.handle("db:delete", (_e, { table, id }) => {
  const db = getDb(); if (!db) return;
  db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
});

ipcMain.handle("db:bulkCreate", (_e, { table, items }) => {
  const db = getDb(); if (!db) return [];
  const now = new Date().toISOString();
  const results = [];
  const insert = db.prepare(`INSERT INTO "${table}" (id, created_date, updated_date, data) VALUES (@id, @created_date, @updated_date, @data)`);
  const tx = db.transaction(() => {
    for (const data of items) {
      const id = newId();
      insert.run({ id, created_date: now, updated_date: now, data: JSON.stringify(data) });
      results.push({ id, created_date: now, updated_date: now, ...data });
    }
  });
  tx();
  return results;
});

ipcMain.handle("db:bulkUpdate", (_e, { table, items }) => {
  const db = getDb(); if (!db) return [];
  const now = new Date().toISOString();
  const results = [];
  // Prepare statements once outside the transaction loop
  const selectStmt = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`);
  const updateStmt = db.prepare(`UPDATE "${table}" SET data = ?, updated_date = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const { id, ...data } of items) {
      const existing = rowToRecord(selectStmt.get(id));
      if (!existing) continue;
      const { id: _id, created_date, updated_date, ...existingData } = existing;
      const merged = { ...existingData, ...data };
      updateStmt.run(JSON.stringify(merged), now, id);
      results.push({ id, created_date, updated_date: now, ...merged });
    }
  });
  tx();
  return results;
});

ipcMain.handle("db:updateMany", (_e, { table, query, patch }) => {
  const db = getDb(); if (!db) return [];
  const now = new Date().toISOString();
  const where = buildJsonWhere(query);
  const rows = where.pushdown
    ? db.prepare(`SELECT * FROM "${table}"${where.sql}`).all(...where.params).map(rowToRecord)
    : db.prepare(`SELECT * FROM "${table}"`).all().map(rowToRecord).filter((r) => matchesQuery(r, query));
  const results = [];
  const setData = patch.$set || patch;
  const updateStmt = db.prepare(`UPDATE "${table}" SET data = ?, updated_date = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const r of rows) {
      const { id, created_date, updated_date, ...rest } = r;
      const merged = { ...rest, ...setData };
      updateStmt.run(JSON.stringify(merged), now, id);
      results.push({ id, created_date, updated_date: now, ...merged });
    }
  });
  tx();
  return results;
});

ipcMain.handle("db:deleteMany", (_e, { table, query }) => {
  const db = getDb(); if (!db) return;
  if (Object.keys(query).length === 0) {
    db.prepare(`DELETE FROM "${table}"`).run();
    return;
  }

  const where = buildJsonWhere(query);
  if (where.pushdown) {
    db.prepare(`DELETE FROM "${table}"${where.sql}`).run(...where.params);
    return;
  }

  const rows = db.prepare(`SELECT * FROM "${table}"`).all().map(rowToRecord).filter((r) => matchesQuery(r, query));
  const del = db.prepare(`DELETE FROM "${table}" WHERE id = ?`);
  const tx = db.transaction(() => { rows.forEach((r) => del.run(r.id)); });
  tx();
});

// Track task BrowserWindows: sessionId → BrowserWindow
const browserWindows = new Map();
const webContentsToSessionId = new Map(); // webContents.id -> sessionId
// Cache the proxy assigned to each session so the app-level "login" handler
// can resolve 407 proxy auth challenges in O(1) instead of querying the DB.
const sessionProxies = new Map(); // sessionId → { host, port, username, password }
const sessionCredentials = new Map(); // sessionId → { email, password }

// Proxy rotation tracking: sessionId → { attempts: 0, blacklistedProxyIds: Set, taskGroupId, originalProxyGroupId, lastRotatedAt }
// Tracks rotation attempts per session to prevent infinite loops; blacklists failed proxies within session
const sessionRotationState = new Map();

// Sessions launched as manual-open — closing won't fire session-crashed
const manualOpenSessions = new Set();

// Track queue timer intervals: sessionId → intervalId
const timerIntervals = new Map();
const timerMeta = new Map(); // sessionId -> { ms, mode: "up" | "down" }
const queuePersistMeta = new Map(); // sessionId -> { ms, at }

function clearQueueTimer(sessionId) {
  if (timerIntervals.has(sessionId)) {
    clearInterval(timerIntervals.get(sessionId));
    timerIntervals.delete(sessionId);
  }
  timerMeta.delete(sessionId);
  queuePersistMeta.delete(sessionId);
}

function initSessionRotationState(sessionId, taskGroupId = null, proxyGroupId = null) {
  if (!sessionRotationState.has(sessionId)) {
    sessionRotationState.set(sessionId, {
      attempts: 0,
      blacklistedProxyIds: new Set(),
      taskGroupId,
      originalProxyGroupId: proxyGroupId,
      lastRotatedAt: null,
    });
  }
}

function clearSessionRotationState(sessionId) {
  sessionRotationState.delete(sessionId);
}

function getSessionIdByWebContents(webContents) {
  if (!webContents) return null;

  const fast = webContentsToSessionId.get(webContents.id);
  if (fast) return fast;

  for (const [sessionId, win] of browserWindows.entries()) {
    if (win && !win.isDestroyed() && win.webContents === webContents) {
      webContentsToSessionId.set(webContents.id, sessionId);
      return sessionId;
    }
  }
  return null;
}

function startQueueTimerInternal(sessionId, currentMs = 0, mode = "up") {
  clearQueueTimer(sessionId);

  let ms = Math.max(0, Number(currentMs) || 0);
  timerMeta.set(sessionId, { ms, mode });
  if (mainWindow) mainWindow.webContents.send("queue-timer-tick", { sessionId, ms });

  const interval = setInterval(() => {
    const meta = timerMeta.get(sessionId);
    if (!meta) {
      clearQueueTimer(sessionId);
      return;
    }

    if (meta.mode === "down") meta.ms = Math.max(0, meta.ms - 1000);
    else meta.ms += 1000;

    if (mainWindow) mainWindow.webContents.send("queue-timer-tick", { sessionId, ms: meta.ms });

    if (meta.mode === "down" && meta.ms <= 0) {
      clearQueueTimer(sessionId);
    }
  }, 1000);

  timerIntervals.set(sessionId, interval);
}

// Sessions being intentionally killed — suppress crash event for these
const intentionalKills = new Set();

// Helper to get the main window
let mainWindow = null;
let tray = null;
let _quitting = false;
const DEBUG_SESSION_DEVTOOLS = process.env.KNULL_DEBUG_SESSION_DEVTOOLS === "1";

// ── IPC: launch a task BrowserWindow ─────────────────────────────────────────
ipcMain.handle("launch-browser", async (_event, { sessionId, url, proxy, userAgent, browser, profile, noPreload = false, manualOpen = false, credentials = null, partitionKey = null }) => {
  mainDebug(`[knull] launch-browser requested session=${sessionId} manualOpen=${manualOpen} url=${url}`);
  // Close existing window for this session if any
  if (browserWindows.has(sessionId)) {
    const existing = browserWindows.get(sessionId);
    if (existing?.webContents?.id != null) {
      webContentsToSessionId.delete(existing.webContents.id);
    }
    try { existing.destroy(); } catch (_) {}
    browserWindows.delete(sessionId);
    clearSessionRotationState(sessionId);
  }

  // Each session gets its own cookie/storage partition by default.
  // For account-driven Walmart flows, partitionKey can pin multiple sessions to
  // one persistent account partition so warmup sign-in carries to new launches.
  const rawPartitionKey = partitionKey || sessionId;
  const safePartitionKey = String(rawPartitionKey).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const partition = `persist:knull-${safePartitionKey}`;
  const ses = session.fromPartition(partition);

  // Set proxy on the session object — supports auth credentials properly
  if (proxy) {
    // Electron's setProxy proxyRules uses "http" scheme for HTTP CONNECT tunneling regardless
    // of whether the proxy protocol is HTTP or HTTPS. SOCKS proxies use socks4/socks5.
    const proto = (proxy.protocol || "HTTP").toUpperCase();
    let schemePrefix;
    if (proto === "SOCKS5") schemePrefix = "socks5";
    else if (proto === "SOCKS4") schemePrefix = "socks4";
    else schemePrefix = "http"; // HTTP and HTTPS proxies both use http:// in Electron proxyRules

    // Use bare host:port — credentials handled entirely by the login event
    // (embedding creds in the URL causes ERR_NO_SUPPORTED_PROXIES on some Electron versions)
    const proxyUrl = `${schemePrefix}://${proxy.host}:${proxy.port}`;
    await ses.setProxy({ proxyRules: proxyUrl });
    // session-level login handles HTTPS CONNECT auth (407 responses)
    ses.removeAllListeners("login");
    ses.on("login", (_req, authInfo, callback) => {
      if (proxy.username && authInfo.isProxy) {
        callback(proxy.username, proxy.password || "");
      } else {
        callback();
      }
    });
  }

  // Override UA to remove Electron signature.
  // onBeforeSendHeaders replaces any previously set listener on this session — no stacking.
  const ua = userAgent || profile?.user_agent ||
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`;
  ses.webRequest.onBeforeSendHeaders(null); // clear stale handler before re-registering
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    h["User-Agent"] = ua;
    // Strip all Electron/Node fingerprint headers
    delete h["X-Electron-Version"];

    const hasHeader = (name) => Object.keys(h).some((k) => k.toLowerCase() === name.toLowerCase());
    // Ensure standard browser headers are present
    if (!hasHeader("Accept-Language")) h["Accept-Language"] = profile?.language ? `${profile.language},en;q=0.9` : "en-US,en;q=0.9";
    if (!hasHeader("Accept-Encoding")) h["Accept-Encoding"] = "gzip, deflate, br";
    callback({ requestHeaders: h });
  });
  await ses.setUserAgent(ua);

  const width = profile?.viewport_width || 1280;
  const height = profile?.viewport_height || 800;

  const win = new BrowserWindow({
    width,
    height,
    title: `KNULL — Session ${sessionId}`,
    icon: WINDOWS_ICON,
    show: manualOpen, // hidden by default until user explicitly takes control
    webPreferences: {
      session: ses,
      preload: noPreload ? undefined : path.join(__dirname, "session-preload.js"),
      contextIsolation: false,
      nodeIntegration: false,
      javascript: true,
      webSecurity: true,
    },
  });
  mainDebug(`[knull] BrowserWindow created session=${sessionId} webContentsId=${win.webContents?.id ?? 'n/a'}`);

  // Block new-window popups that could steal focus/session
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Optional debug: open DevTools for credentialed manual-open sessions.
  if (DEBUG_SESSION_DEVTOOLS && manualOpen && credentials) {
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed()) win.webContents.openDevTools({ mode: "detach" });
    });
  }

  if (manualOpen) manualOpenSessions.add(sessionId);
  else manualOpenSessions.delete(sessionId);

  // Save webContents ID before the window closes — accessing win.webContents
  // after "closed" throws "Object has been destroyed".
  const wcId = win.webContents?.id ?? null;

  // Hide window on close button instead of destroying it (keeps task alive)
  win.on("close", (event) => {
    event.preventDefault();
    win.hide();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("session-minimized", { sessionId });
    }
  });

  win.on("closed", () => {
    if (wcId != null && webContentsToSessionId.get(wcId) === sessionId) {
      webContentsToSessionId.delete(wcId);
    }
    if (browserWindows.get(sessionId) === win) {
      browserWindows.delete(sessionId);
    }
    sessionProxies.delete(sessionId);
    sessionCredentials.delete(sessionId);
    clearQueueTimer(sessionId);
    // Only fire session-crashed if it was NOT an intentional kill and NOT a manual open
    if (!intentionalKills.has(sessionId) && !manualOpenSessions.has(sessionId) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("session-crashed", { sessionId, code: 0 });
    }
    intentionalKills.delete(sessionId);
    manualOpenSessions.delete(sessionId);
    updateTray();
  });

  // Log load failures to SystemLog and notify renderer for proxy-related errors
  win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // user-aborted, ignore
    const msg = `Session load failed [${errorCode}] ${errorDescription} — URL: ${validatedURL || url} — Proxy: ${proxy ? proxy.host + ":" + proxy.port : "none"}`;
    console.warn("[knull]", msg);
    const db = getDb();
    if (db) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO "SystemLog" (id, created_date, updated_date, data) VALUES (?, ?, ?, ?)`).run(
        newId(), now, now,
        JSON.stringify({ level: "warn", source: "Sessions", message: msg, details: "" })
      );
    }
    // Notify renderer for proxy-related failures so the UI can surface them
    const proxyErrors = [-130, -202, -7, -100, -101, -105, -106];
    if (proxyErrors.includes(errorCode) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("session-load-failed", {
        sessionId,
        errorCode,
        errorDescription,
        url: validatedURL || url,
        proxy: proxy ? { host: proxy.host, port: proxy.port, protocol: proxy.protocol } : null,
      });
      // Trigger auto-rotation on proxy errors
      mainWindow.webContents.send("trigger-proxy-rotation", { sessionId });
    }
  });

  // Auto-fill credentials via executeJavaScript — more reliable than IPC for SPAs.
  // Registered BEFORE loadURL: `once("did-finish-load", ...)` can otherwise miss the
  // event entirely if the page finishes loading (e.g. cached) before this line runs.
  if (credentials?.email && credentials?.password) {
    const { email, password } = credentials;

    // Single script that types like a human: char-by-char with randomized delays,
    // real keydown/keypress/input/keyup events per keystroke, and waits for each
    // field to actually appear rather than guessing a fixed delay.
    const typeScript = `
      (async function () {
        function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
        function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

        function setNativeValue(el, value) {
          const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        }

        async function humanType(el, text) {
          el.scrollIntoView({ block: 'center' });
          el.focus();
          el.dispatchEvent(new Event('focus', { bubbles: true }));
          let current = '';
          for (const ch of text) {
            current += ch;
            el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
            setNativeValue(el, current);
            el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
            await sleep(rand(60, 160)); // per-keystroke pause — tune to taste
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        async function waitFor(selectors, timeoutMs) {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.offsetParent !== null) return el; // skip hidden/detached matches
            }
            await sleep(300);
          }
          return null;
        }

        async function waitForButtonByText(textCandidates, timeoutMs) {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const buttons = [...document.querySelectorAll('button')];
            let match = buttons.find((b) =>
              textCandidates.some((t) => b.innerText.trim().toLowerCase() === t.toLowerCase())
            );
            if (!match) match = document.querySelector('button[type="submit"]');
            if (!match) match = buttons.find((b) => /button_primary/i.test(b.className));
            if (match && match.offsetParent !== null && !match.disabled) return match;
            await sleep(300);
          }
          return null;
        }

        async function selectRadioByName(nameAttr, labelSubstring, timeoutMs) {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const radios = [...document.querySelectorAll('input[type="radio"]')];
            let match = radios.find((r) => r.name === nameAttr);
            if (!match && labelSubstring) {
              match = radios.find((r) => {
                const label = r.closest('label')?.innerText
                  || document.querySelector('label[for="' + r.id + '"]')?.innerText
                  || '';
                return label.toLowerCase().includes(labelSubstring.toLowerCase());
              });
            }
            if (match && match.offsetParent !== null) return match;
            await sleep(300);
          }
          return null;
        }

        try {
          console.log('[knull-autofill] starting');

          // ── Step 1: email / phone field ──────────────────────────────────
          const emailInput = await waitFor([
            'input[placeholder="Phone number or email (required)"]',
            'input[name="phone-number-email-field"]',
            'input[name="email"]',
            'input[type="email"]',
            'input[autocomplete="email"]',
            'input[autocomplete="username"]',
            'input[type="text"]:not([autocomplete="username"])', // generic fallback if placeholder wording changes
          ], 15000);
          if (!emailInput) { console.error('[knull-autofill] email input not found'); return; }
          console.log('[knull-autofill] email input found, typing');

          await humanType(emailInput, ${JSON.stringify(email)});
          await sleep(rand(400, 900)); // human pause before hitting Continue

          const continueBtn = await waitFor(['button[type="submit"]'], 3000);
          if (!continueBtn) { console.error('[knull-autofill] continue button not found'); return; }
          console.log('[knull-autofill] clicking continue');
          continueBtn.click();

          // ── Step 2: choose sign-in method → select "Email me a verification code" ──
          const emailOtpRadio = await selectRadioByName('otpEmail', 'email me a verification code', 15000);
          if (!emailOtpRadio) { console.error('[knull-autofill] email OTP radio not found'); return; }
          console.log('[knull-autofill] email OTP radio found, clicking');

          emailOtpRadio.click(); // real .click() correctly triggers React's radio onChange
          await sleep(rand(500, 900));

          const sendCodeBtn = await waitForButtonByText(['request code'], 5000);
          if (!sendCodeBtn) { console.error('[knull-autofill] send-code button not found'); return; }
          console.log('[knull-autofill] send-code button found:', sendCodeBtn.outerHTML.slice(0, 200), 'disabled:', sendCodeBtn.disabled);
          sendCodeBtn.click();
          console.log('[knull-autofill] send-code button clicked — done');

          // From here the IMAP monitor (Settings → IMAP) picks up the incoming code
          // and injects it via injectVerificationCode — no password step needed.
        } catch (err) {
          console.error('[knull-autofill] uncaught error:', err && err.message, err && err.stack);
        }
      })();
    `;

    win.webContents.once("did-finish-load", () => {
      const startDelay = Math.floor(Math.random() * 700) + 800; // 800–1500ms
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.webContents.executeJavaScript(typeScript).catch((err) => {
            console.error("[knull-autofill] executeJavaScript rejected:", err);
          });
        }
      }, startDelay);
    });
  }

  // Content error detection: scan for Pokemon Center errors after load
  // Detects Error 43 (proxy connection), Error 15/17 (access denied), explicit error pages
  // Note: Blank pages are NOT flagged as errors since websites legitimately fail to load under heavy load
  if (!noPreload) {
    win.webContents.on("did-finish-load", () => {
      if (win.isDestroyed()) return;
      // Wait 10s then check for error page indicators
      setTimeout(() => {
        if (win.isDestroyed()) return;
        win.webContents.executeJavaScript(`
          (function() {
            const text = document.body?.innerText || '';
            const html = document.documentElement?.outerHTML || '';
            
            // Detect specific error patterns (explicit errors only, not blank pages)
            const errorPatterns = [
              /Error 43|too many connections/i,  // Proxy connection errors
              /Error 15|Error 17|access denied|blocked by our security/i,  // Bot detection/security
              /Oops!.*Something's gone wrong/i,  // Generic error page
              /temporary unavailable/i,  // Temporarily unavailable
              /Imperva|imperva/,  // Imperva security blocking
            ];
            
            const hasError = errorPatterns.some(p => p.test(text) || p.test(html));
            
            if (hasError) {
              window.__knull_content_error = {
                type: 'error_page',
                detected: true,
                errorText: text.slice(0, 500),
              };
            }
          })()
        `).catch(() => {});
      }, 10000);
    });
  }

  win.loadURL(url);
  mainDebug(`[knull] loadURL issued session=${sessionId}`);

  browserWindows.set(sessionId, win);
  if (win.webContents?.id != null) {
    webContentsToSessionId.set(win.webContents.id, sessionId);
  }
  if (proxy) sessionProxies.set(sessionId, { host: proxy.host, port: proxy.port, username: proxy.username, password: proxy.password || "" });
  if (credentials?.email && credentials?.password) sessionCredentials.set(sessionId, { email: credentials.email, password: credentials.password });
  else sessionCredentials.delete(sessionId);
  initSessionRotationState(sessionId);

  const accountEmail = credentials?.email || null;
  mainDebug(`[knull] Launched BrowserWindow session ${sessionId} manualOpen=${manualOpen} account=${accountEmail || "none"} → ${url} via ${proxy ? `${proxy.protocol || "HTTP"} ${proxy.host}:${proxy.port} auth=${!!proxy.username}` : "no proxy"}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("session-launched", {
      sessionId,
      url,
      manualOpen,
      accountEmail,
      partition,
      proxyLabel: proxy ? `${proxy.host}:${proxy.port}` : "No proxy",
      launchedAt: new Date().toISOString(),
    });
  }
  mainDebug(`[knull] launch-browser finished session=${sessionId}`);
  updateTray();
  return { ok: true };
});

// ── IPC: Auto-rotate proxy on content/network errors ────────────────────────
ipcMain.handle("rotate-proxy", async (_event, { sessionId }) => {
  const win = browserWindows.get(sessionId);
  if (!win || win.isDestroyed()) return { ok: false, error: "Session window not found" };

  const rotationState = sessionRotationState.get(sessionId);
  if (!rotationState) return { ok: false, error: "Rotation state not initialized" };

  // Prevent infinite rotation loops — max 6 attempts (try original + 5 alternates)
  if (rotationState.attempts >= 5) {
    const msg = `Proxy rotation exhausted after 5 attempts for session ${sessionId}`;
    console.warn("[knull]", msg);
    const db = getDb();
    if (db) {
      db.prepare(`INSERT INTO "SystemLog" (id, created_date, updated_date, data) VALUES (?, ?, ?, ?)`).run(
        newId(), new Date().toISOString(), new Date().toISOString(),
        JSON.stringify({ level: "error", source: "ProxyRotation", message: msg })
      );
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("proxy-rotation-failed", { sessionId, reason: "Max attempts exceeded" });
    }
    return { ok: false, error: "Max rotation attempts exceeded" };
  }

  try {
    const db = getDb();
    if (!db) return { ok: false, error: "Database unavailable" };

    // Get current session proxy info
    const currentProxy = sessionProxies.get(sessionId);
    const sessionRecord = db.prepare(`SELECT * FROM "BrowserSession" WHERE id = ?`).get(sessionId);
    if (!sessionRecord) return { ok: false, error: "Session record not found" };

    const session = JSON.parse(sessionRecord.data);
    const proxyGroupId = session.proxy_group_id;

    if (!proxyGroupId) {
      return { ok: false, error: "No proxy group assigned to session" };
    }

    // Get proxy group and its proxies
    const groupRecord = db.prepare(`SELECT * FROM "ProxyGroup" WHERE id = ?`).get(proxyGroupId);
    if (!groupRecord) return { ok: false, error: "Proxy group not found" };

    const proxyGroup = JSON.parse(groupRecord.data);
    const proxyIds = proxyGroup.proxy_ids || [];

    // Find a healthy proxy not in the blacklist
    let nextProxy = null;
    for (const proxyId of proxyIds) {
      if (rotationState.blacklistedProxyIds.has(proxyId)) continue;

      const proxyRecord = db.prepare(`SELECT * FROM "Proxy" WHERE id = ?`).get(proxyId);
      if (!proxyRecord) continue;

      const proxyData = JSON.parse(proxyRecord.data);
      if (proxyData.status === "healthy") {
        nextProxy = { id: proxyId, ...proxyData };
        break;
      }
    }

    if (!nextProxy) {
      return { ok: false, error: "No healthy proxies available in group" };
    }

    // Blacklist the current proxy and increment rotation count
    if (currentProxy) {
      const allProxies = db.prepare(`SELECT * FROM "Proxy"`).all();
      for (const row of allProxies) {
        const p = JSON.parse(row.data);
        if (p.host === currentProxy.host && p.port === currentProxy.port) {
          rotationState.blacklistedProxyIds.add(row.id);
          break;
        }
      }
    }
    rotationState.attempts += 1;
    rotationState.lastRotatedAt = new Date().toISOString();

    // Update session in DB with new proxy
    const updatedSession = {
      ...session,
      proxy_id: nextProxy.id,
      proxy_label: `${nextProxy.protocol || "HTTP"}://${nextProxy.host}:${nextProxy.port}`,
    };
    db.prepare(`UPDATE "BrowserSession" SET data = ? WHERE id = ?`).run(
      JSON.stringify(updatedSession),
      sessionId
    );

    // Apply proxy to the session and reload the page
    const partition = win.webPreferences?.session?.partition || `persist:knull-${sessionId}`;
    const ses = require("electron").session.fromPartition(partition);
    const proto = (nextProxy.protocol || "HTTP").toUpperCase();
    let schemePrefix;
    if (proto === "SOCKS5") schemePrefix = "socks5";
    else if (proto === "SOCKS4") schemePrefix = "socks4";
    else schemePrefix = "http";

    const proxyUrl = `${schemePrefix}://${nextProxy.host}:${nextProxy.port}`;
    await ses.setProxy({ proxyRules: proxyUrl });

    // Handle proxy auth if needed
    if (nextProxy.username) {
      ses.removeAllListeners("login");
      ses.on("login", (_req, authInfo, callback) => {
        if (nextProxy.username && authInfo.isProxy) {
          callback(nextProxy.username, nextProxy.password || "");
        } else {
          callback();
        }
      });
    }

    // Update cached proxy for login handler
    sessionProxies.set(sessionId, {
      host: nextProxy.host,
      port: nextProxy.port,
      username: nextProxy.username || "",
      password: nextProxy.password || "",
    });

    // Reload the page with new proxy
    win.webContents.reload();

    const msg = `Session ${sessionId} rotated to proxy ${nextProxy.host}:${nextProxy.port} (attempt ${rotationState.attempts}/5)`;
    console.log("[knull]", msg);
    if (db) {
      db.prepare(`INSERT INTO "SystemLog" (id, created_date, updated_date, data) VALUES (?, ?, ?, ?)`).run(
        newId(), new Date().toISOString(), new Date().toISOString(),
        JSON.stringify({ level: "info", source: "ProxyRotation", message: msg })
      );
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("proxy-rotated", {
        sessionId,
        newProxy: { host: nextProxy.host, port: nextProxy.port },
        attempt: rotationState.attempts,
      });
    }

    return { ok: true, proxy: nextProxy, attempt: rotationState.attempts };
  } catch (err) {
    console.error("[knull] rotate-proxy error:", err);
    return { ok: false, error: err.message || String(err) };
  }
});

// ── IPC: Discord OAuth2 SSO login ─────────────────────────────────────────────
// Opens a popup window to Discord's authorize page, intercepts the redirect,
// exchanges the code via Cloudflare Worker, returns { discord_id, username, access_token }
const DISCORD_CLIENT_ID = "1526025662266212574";
const DISCORD_REDIRECT   = "http://localhost/callback";
const DISCORD_SCOPES     = "identify guilds guilds.members.read";

ipcMain.handle("discord-oauth-login", async (_event, { cfEndpoint }) => {
  return new Promise((resolve) => {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT)}&response_type=code&scope=${encodeURIComponent(DISCORD_SCOPES)}`;

    const popup = new BrowserWindow({
      width: 500,
      height: 700,
      title: "Login with Discord",
      icon: WINDOWS_ICON,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    let resolved = false;

    // Intercept navigation to the redirect URI to grab the auth code
    popup.webContents.on("will-navigate", (_e, navUrl) => {
      if (navUrl.startsWith(DISCORD_REDIRECT)) {
        const parsed = new URL(navUrl);
        const code = parsed.searchParams.get("code");
        if (!resolved && code) {
          resolved = true;
          popup.destroy();
          // Exchange code via Cloudflare Worker
          nodeFetch(cfEndpoint + "/oauth/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, redirect_uri: DISCORD_REDIRECT }),
            timeoutMs: 15000,
          }).then((r) => r.json()).then((data) => resolve(data)).catch((e) => resolve({ error: e.message }));
        }
      }
    });

    // Also catch did-navigate for some Discord redirect flows
    popup.webContents.on("did-navigate", (_e, navUrl) => {
      if (navUrl.startsWith(DISCORD_REDIRECT)) {
        const parsed = new URL(navUrl);
        const code = parsed.searchParams.get("code");
        if (!resolved && code) {
          resolved = true;
          popup.destroy();
          nodeFetch(cfEndpoint + "/oauth/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, redirect_uri: DISCORD_REDIRECT }),
            timeoutMs: 15000,
          }).then((r) => r.json()).then((data) => resolve(data)).catch((e) => resolve({ error: e.message }));
        }
      }
    });

    popup.on("closed", () => {
      if (!resolved) { resolved = true; resolve({ error: "Login window closed" }); }
    });

    popup.loadURL(authUrl);
  });
});

// ── IPC: fetch Discord /users/@me identity ────────────────────────────────────
ipcMain.handle("fetch-discord-me", async (_event, { authHeader }) => {
  try {
    const res = await nodeFetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: authHeader } });
    const body = await res.json();
    if (!res.ok) return { error: `Discord API ${res.status}: ${body.message || "unknown"}` };
    return { id: body.id, username: body.username, discriminator: body.discriminator, global_name: body.global_name };
  } catch (e) {
    return { error: e.message };
  }
});

// ── IPC: fetch Discord guilds + channels (avoids CORS, for channel picker) ────
ipcMain.handle("fetch-discord-guilds", async (_event, { authHeader }) => {
  try {
    const res = await nodeFetch("https://discord.com/api/v10/users/@me/guilds", { headers: { Authorization: authHeader } });
    const body = await res.json();
    if (!res.ok) return { error: `Discord API ${res.status}: ${body.message || "unknown"}` };
    return { guilds: Array.isArray(body) ? body : [] };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle("fetch-discord-guild-channels", async (_event, { authHeader, guildId }) => {
  try {
    const res = await nodeFetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers: { Authorization: authHeader } });
    const body = await res.json();
    if (!res.ok) return { error: `Discord API ${res.status}: ${body.message || "unknown"}` };
    // Only text channels (type 0) and announcement channels (type 5)
    const textChannels = Array.isArray(body) ? body.filter((c) => c.type === 0 || c.type === 5) : [];
    return { channels: textChannels };
  } catch (e) {
    return { error: e.message };
  }
});

// ── IPC: fetch Discord messages (avoids CORS in renderer) ────────────────────
ipcMain.handle("fetch-discord-messages", async (_event, { authHeader, channelId, afterId }) => {
  try {
    const params = new URLSearchParams({ limit: "10" });
    if (afterId) params.set("after", afterId);
    const url = `https://discord.com/api/v10/channels/${channelId}/messages?${params}`;
    const res = await nodeFetch(url, { headers: { Authorization: authHeader } });
    const body = await res.json();
    if (!res.ok) return { error: `Discord API ${res.status}: ${body.message || "unknown"}` };
    const msgs = Array.isArray(body) ? [...body].reverse() : [];
    return { messages: msgs };
  } catch (e) {
    return { error: e.message };
  }
});

// ── IPC: diagnose proxy against a real target URL ─────────────────────────────
// Returns the HTTP status code the target site gives when accessed via this proxy.
// This reveals 403 geo/IP blocks, 407 auth failures, 503 bot challenges, etc.
ipcMain.handle("diagnose-proxy", async (_event, { proxy, url }) => {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const isTargetHttps = parsed.protocol === "https:";
      const proto = (proxy.protocol || "HTTP").toUpperCase();
      const isSocks = proto.startsWith("SOCKS");

      if (isSocks) {
        // SOCKS4/5: establish a tunnel to the target host, then send a HEAD request.
        const isSocks5 = proto === "SOCKS5";
        const targetHost = parsed.hostname;
        const targetPort = isTargetHttps ? 443 : (parseInt(parsed.port) || 80);
        const net = require("net");
        const socket = net.createConnection({ host: proxy.host, port: proxy.port });
        socket.setTimeout(8000);
        let step = "connect";
        const failSocks = (err) => { socket.destroy(); resolve({ status: 0, error: err || "SOCKS failed" }); };
        socket.on("timeout", () => failSocks("Timeout"));
        socket.on("error", () => failSocks("Connection failed"));
        socket.on("connect", () => {
          if (isSocks5) {
            step = "socks5-greeting";
            socket.write(proxy.username
              ? Buffer.from([0x05, 0x02, 0x00, 0x02])
              : Buffer.from([0x05, 0x01, 0x00]));
          } else {
            step = "socks4-connect";
            const hostBuf = require("net").isIP(targetHost) === 4
              ? targetHost.split(".").map(Number)
              : null;
            if (!hostBuf) { failSocks("SOCKS4 requires IPv4 target"); return; }
            const user = proxy.username ? Buffer.from(proxy.username + "\x00") : Buffer.from([0x00]);
            const buf = Buffer.alloc(8 + user.length);
            buf[0] = 0x04; buf[1] = 0x01;
            buf.writeUInt16BE(targetPort, 2);
            buf[4] = hostBuf[0]; buf[5] = hostBuf[1]; buf[6] = hostBuf[2]; buf[7] = hostBuf[3];
            user.copy(buf, 8);
            socket.write(buf);
          }
        });
        socket.on("data", (data) => {
          if (step === "socks5-greeting") {
            if (data.length < 2 || data[0] !== 0x05) { failSocks("Bad SOCKS5 greeting"); return; }
            if (data[1] === 0xFF) { failSocks("No acceptable auth method"); return; }
            if (data[1] === 0x02 && proxy.username) {
              step = "socks5-auth";
              const u = Buffer.from(proxy.username || "");
              const p = Buffer.from(proxy.password || "");
              const buf = Buffer.alloc(3 + u.length + p.length);
              buf[0] = 0x01; buf[1] = u.length; u.copy(buf, 2);
              buf[2 + u.length] = p.length; p.copy(buf, 3 + u.length);
              socket.write(buf);
            } else {
              step = "socks5-connect";
              const hostNameBuf = Buffer.from(targetHost);
              const buf = Buffer.alloc(7 + hostNameBuf.length);
              buf[0] = 0x05; buf[1] = 0x01; buf[2] = 0x00; buf[3] = 0x03;
              buf[4] = hostNameBuf.length; hostNameBuf.copy(buf, 5);
              buf.writeUInt16BE(targetPort, 5 + hostNameBuf.length);
              socket.write(buf);
            }
            return;
          }
          if (step === "socks5-auth") {
            if (data.length < 2 || data[1] !== 0x00) { failSocks("SOCKS5 auth failed"); return; }
            step = "socks5-connect";
            const hostNameBuf = Buffer.from(targetHost);
            const buf = Buffer.alloc(7 + hostNameBuf.length);
            buf[0] = 0x05; buf[1] = 0x01; buf[2] = 0x00; buf[3] = 0x03;
            buf[4] = hostNameBuf.length; hostNameBuf.copy(buf, 5);
            buf.writeUInt16BE(targetPort, 5 + hostNameBuf.length);
            socket.write(buf);
            return;
          }
          if (step === "socks5-connect" || step === "socks4-connect") {
            const tunnelOk = isSocks5
              ? (data[0] === 0x05 && data[1] === 0x00)
              : (data[0] === 0x00 && data[1] === 0x5A);
            if (!tunnelOk) { failSocks(isSocks5 ? `SOCKS5 error 0x${data[1]?.toString(16)}` : `SOCKS4 error 0x${data[1]?.toString(16)}`); return; }
            // Tunnel open — send HEAD through it
            if (isTargetHttps) {
              const tlsSocket = require("tls").connect({ socket, servername: targetHost, rejectUnauthorized: false }, () => {
                const path = parsed.pathname + (parsed.search || "");
                tlsSocket.write(`HEAD ${path || "/"} HTTP/1.1\r\nHost: ${targetHost}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36\r\nConnection: close\r\n\r\n`);
              });
              let raw = "";
              tlsSocket.on("data", (c) => { raw += c.toString(); });
              tlsSocket.on("end", () => {
                const m = raw.match(/^HTTP\/\d+\.?\d* (\d{3})/);
                socket.destroy(); resolve({ status: m ? parseInt(m[1]) : 0 });
              });
              tlsSocket.on("error", () => { socket.destroy(); resolve({ status: 0, error: "TLS error" }); });
            } else {
              const path = parsed.pathname + (parsed.search || "");
              socket.write(`HEAD ${path || "/"} HTTP/1.1\r\nHost: ${targetHost}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36\r\nConnection: close\r\n\r\n`);
              let raw = "";
              socket.on("data", (c) => { raw += c.toString(); });
              socket.on("end", () => {
                const m = raw.match(/^HTTP\/\d+\.?\d* (\d{3})/);
                resolve({ status: m ? parseInt(m[1]) : 0 });
              });
            }
          }
        });
        return;
      }

      if (isTargetHttps) {
        // HTTPS target: open a CONNECT tunnel through the proxy, then send HEAD
        const connectReq = http.request({
          host: proxy.host,
          port: proxy.port,
          method: "CONNECT",
          path: `${parsed.hostname}:443`,
          headers: {
            Host: `${parsed.hostname}:443`,
            ...(proxy.username ? { "Proxy-Authorization": `Basic ${Buffer.from(`${proxy.username}:${proxy.password || ""}`).toString("base64")}` } : {}),
          },
          timeout: 8000,
        });
        connectReq.on("connect", (_res, socket) => {
          const tlsSocket = require("tls").connect({ socket, servername: parsed.hostname, rejectUnauthorized: false }, () => {
            // pathname is never empty for a valid URL; guard the search segment explicitly
            const path = parsed.pathname + (parsed.search || "");
            tlsSocket.write(`HEAD ${path || "/"} HTTP/1.1\r\nHost: ${parsed.hostname}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36\r\nConnection: close\r\n\r\n`);
          });
          let raw = "";
          tlsSocket.on("data", (chunk) => { raw += chunk.toString(); });
          tlsSocket.on("end", () => {
            const match = raw.match(/^HTTP\/\d+\.?\d* (\d{3})/);
            resolve({ status: match ? parseInt(match[1]) : 0 });
          });
          tlsSocket.on("error", () => resolve({ status: 0, error: "TLS error" }));
          setTimeout(() => { tlsSocket.destroy(); resolve({ status: 0, error: "Timeout" }); }, 8000);
        });
        connectReq.on("response", (res) => {
          // Proxy rejected CONNECT (407 auth, etc.)
          resolve({ status: res.statusCode });
        });
        connectReq.on("timeout", () => { connectReq.destroy(); resolve({ status: 0, error: "Timeout" }); });
        connectReq.on("error", () => resolve({ status: 0, error: "Connection failed" }));
        connectReq.end();
      } else {
        // Plain HTTP target: send request directly through proxy
        const reqOptions = {
          host: proxy.host,
          port: proxy.port,
          method: "HEAD",
          path: url,
          headers: {
            Host: parsed.hostname,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            ...(proxy.username ? { "Proxy-Authorization": `Basic ${Buffer.from(`${proxy.username}:${proxy.password || ""}`).toString("base64")}` } : {}),
          },
          timeout: 8000,
        };
        const req = http.request(reqOptions, (res) => resolve({ status: res.statusCode }));
        req.on("timeout", () => { req.destroy(); resolve({ status: 0, error: "Timeout" }); });
        req.on("error", () => resolve({ status: 0, error: "Connection failed" }));
        req.end();
      }
    } catch (e) {
      resolve({ status: 0, error: e.message });
    }
  });
});

// ── IPC: health-check a proxy (real HTTP request) ─────────────────────────────
ipcMain.handle("check-proxy", async (_event, proxy) => {
  return new Promise((resolve) => {
    const start = Date.now();
    const testUrl = "http://www.google.com/generate_204";
    const parsed = new URL(testUrl);
    const proxyHost = proxy.host;
    const proxyPort = proxy.port;
    const isSocks = proxy.protocol?.toUpperCase().startsWith("SOCKS");

    if (isSocks) {
      // Perform a real SOCKS4/SOCKS5 handshake by attempting a CONNECT to 1.1.1.1:80.
      // A successful tunnel open confirms the proxy actually routes traffic, not just TCP open.
      const net = require("net");
      const isSocks5 = proxy.protocol?.toUpperCase() === "SOCKS5";
      const TEST_HOST_IP = [1, 1, 1, 1]; // 1.1.1.1 (Cloudflare, reliable test target)
      const TEST_PORT = 80;

      const socket = net.createConnection({ host: proxyHost, port: proxyPort });
      socket.setTimeout(7000);

      let step = "connect";

      const fail = () => { socket.destroy(); resolve({ ok: false, responseTime: Date.now() - start }); };

      socket.on("timeout", fail);
      socket.on("error", fail);

      socket.on("connect", () => {
        if (isSocks5) {
          // SOCKS5: send greeting — offer no-auth (0x00) and user/pass auth (0x02)
          const hasAuth = !!(proxy.username);
          step = "socks5-greeting";
          socket.write(hasAuth
            ? Buffer.from([0x05, 0x02, 0x00, 0x02])   // 2 methods: no-auth + user/pass
            : Buffer.from([0x05, 0x01, 0x00]));         // 1 method: no-auth
        } else {
          // SOCKS4: send CONNECT request directly (no auth negotiation phase)
          step = "socks4-connect";
          const user = proxy.username ? Buffer.from(proxy.username + "\x00") : Buffer.from([0x00]);
          const buf = Buffer.alloc(8 + user.length);
          buf[0] = 0x04; buf[1] = 0x01;                         // version 4, CONNECT
          buf.writeUInt16BE(TEST_PORT, 2);                       // dest port
          buf[4] = TEST_HOST_IP[0]; buf[5] = TEST_HOST_IP[1];   // dest IP
          buf[6] = TEST_HOST_IP[2]; buf[7] = TEST_HOST_IP[3];
          user.copy(buf, 8);
          socket.write(buf);
        }
      });

      socket.on("data", (data) => {
        if (step === "socks5-greeting") {
          // Server chose auth method
          if (data.length < 2 || data[0] !== 0x05) {
            // If response starts with "HTTP/" (0x48 0x54 0x54 0x50) it's an HTTP proxy misconfigured as SOCKS
            const isHttpResponse = data.length >= 4 && data[0] === 0x48 && data[1] === 0x54 && data[2] === 0x54 && data[3] === 0x50;
            socket.destroy();
            resolve({ ok: false, responseTime: Date.now() - start, protocolMismatch: isHttpResponse || undefined, hint: isHttpResponse ? "Responded as HTTP proxy — try switching protocol to HTTP" : undefined });
            return;
          }
          const method = data[1];
          if (method === 0xFF) { fail(); return; } // no acceptable method

          if (method === 0x02 && proxy.username) {
            // User/pass auth sub-negotiation
            step = "socks5-auth";
            const u = Buffer.from(proxy.username || "");
            const p = Buffer.from(proxy.password || "");
            const buf = Buffer.alloc(3 + u.length + p.length);
            buf[0] = 0x01; buf[1] = u.length; u.copy(buf, 2);
            buf[2 + u.length] = p.length; p.copy(buf, 3 + u.length);
            socket.write(buf);
          } else {
            // No-auth or auth done — send CONNECT request
            step = "socks5-connect";
            socket.write(Buffer.from([
              0x05, 0x01, 0x00, 0x01,          // version 5, CONNECT, reserved, IPv4
              ...TEST_HOST_IP,                  // dest IP
              (TEST_PORT >> 8) & 0xFF, TEST_PORT & 0xFF, // dest port
            ]));
          }
          return;
        }

        if (step === "socks5-auth") {
          // Auth response: [0x01, status] — status 0x00 means success
          if (data.length < 2 || data[0] !== 0x01 || data[1] !== 0x00) { fail(); return; }
          step = "socks5-connect";
          socket.write(Buffer.from([
            0x05, 0x01, 0x00, 0x01,
            ...TEST_HOST_IP,
            (TEST_PORT >> 8) & 0xFF, TEST_PORT & 0xFF,
          ]));
          return;
        }

        if (step === "socks5-connect" || step === "socks4-connect") {
          // SOCKS5: [0x05, 0x00, ...] = success; SOCKS4: [0x00, 0x5A, ...] = success
          const ok = isSocks5
            ? (data[0] === 0x05 && data[1] === 0x00)
            : (data[0] === 0x00 && data[1] === 0x5A);
          // Detect HTTP proxy responding to SOCKS4 CONNECT (starts with "HTTP/")
          const isHttpResponse = !ok && data.length >= 4 && data[0] === 0x48 && data[1] === 0x54 && data[2] === 0x54 && data[3] === 0x50;
          socket.destroy();
          resolve({ ok, responseTime: Date.now() - start, protocolMismatch: isHttpResponse || undefined, hint: isHttpResponse ? "Responded as HTTP proxy — try switching protocol to HTTP" : undefined });
        }
      });
      return;
    }

    // HTTP/HTTPS proxy: open a CONNECT tunnel to 1.1.1.1:443 (same target used for SOCKS).
    // A successful CONNECT confirms the proxy can route HTTPS traffic — the same requirement
    // as reaching Walmart/Pokemon Center. Any non-200 response (e.g. 407, 403, 502) = fail.
    const connectOptions = {
      host: proxyHost,
      port: proxyPort,
      method: "CONNECT",
      path: "1.1.1.1:443",
      headers: { Host: "1.1.1.1:443" },
      timeout: 7000,
    };
    if (proxy.username) {
      const auth = Buffer.from(`${proxy.username}:${proxy.password || ""}`).toString("base64");
      connectOptions.headers["Proxy-Authorization"] = `Basic ${auth}`;
    }

    const req = http.request(connectOptions);
    req.on("connect", (_res, socket, _head) => {
      const ok = _res.statusCode === 200;
      socket.destroy();
      resolve({ ok, responseTime: Date.now() - start });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, responseTime: Date.now() - start }); });
    req.on("error", () => resolve({ ok: false, responseTime: Date.now() - start }));
    req.end();
  });
});

// ── Helper: Node.js fetch (works in Electron's Node runtime) ──────────────────
function nodeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: options.timeoutMs || 15000,
    };
    reqOptions.agent = isHttps ? _httpsAgent : _httpAgent;
    const req = lib.request(reqOptions, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => { try { return Promise.resolve(JSON.parse(raw || "{}")); } catch(_) { return Promise.resolve({}); } },
        });
      });
    });
    req.on("timeout", () => { req.destroy(new Error(`nodeFetch timeout: ${url}`)); });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── IPC: focus an existing task window (bring to front) ──────────────────────
ipcMain.handle("focus-browser", (_event, sessionId) => {
  const win = browserWindows.get(sessionId);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true };
  }
  return { ok: false, error: "No window for that session" };
});

// ── IPC: fetch unseen IMAP messages + extract verification codes ──────────────
ipcMain.handle("imap-fetch", async (_event, config) => {
  try {
    const { imapFetch } = require("./imap");
    return await imapFetch(config);
  } catch (e) {
    return { error: e.message };
  }
});

// ── IPC: push a verification code into an open session window ─────────────────
ipcMain.handle("inject-verification-code", (_event, { sessionId, code }) => {
  const win = browserWindows.get(sessionId);
  if (!win || win.isDestroyed()) return { ok: false, error: "No open session for that account" };
  const creds = sessionCredentials.get(sessionId) || null;
  win.webContents.send("inject-verification-code", { code, password: creds?.password || null });
  return { ok: true };
});

// ── IPC: push captcha token into an open session window ──────────────────────
ipcMain.handle("inject-captcha-token", (_event, { sessionId, type, token }) => {
  const win = browserWindows.get(sessionId);
  if (!win || win.isDestroyed()) return { ok: false, error: "No open session for captcha token injection" };
  if (!token) return { ok: false, error: "Missing captcha token" };
  win.webContents.send("inject-captcha-token", { type, token });
  return { ok: true };
});

// ── IPC: kill a browser session ───────────────────────────────────────────────
ipcMain.handle("kill-browser", (_event, sessionId) => {
  const win = browserWindows.get(sessionId);
  if (win) {
    intentionalKills.add(sessionId); // mark as intentional so closed event skips crash signal
    try { win.destroy(); } catch (_) {}
  }
  sessionProxies.delete(sessionId);
  sessionCredentials.delete(sessionId);
  clearQueueTimer(sessionId);
  updateTray();
  return { ok: true };
});

// ── IPC: queue timer tick (renderer asks main to start/stop per-session timer) ─
ipcMain.handle("start-queue-timer", (_event, { sessionId, currentMs }) => {
  startQueueTimerInternal(sessionId, currentMs || 0, "up");
  return { ok: true };
});

ipcMain.handle("stop-queue-timer", (_event, sessionId) => {
  clearQueueTimer(sessionId);
  return { ok: true };
});

// Session windows report parsed queue wait times from queue pages.
// Use this to drive a live countdown in the Queue Leaderboard.
ipcMain.on("queue-wait-detected", (_event, payload) => {
  const sessionId = getSessionIdByWebContents(_event.sender);
  if (!sessionId) return;

  const remainingMs = Number(payload?.remainingMs);
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return;

  const nextMs = Math.floor(remainingMs);
  const persisted = queuePersistMeta.get(sessionId);
  const nowTs = Date.now();
  const shouldPersist = !persisted
    || Math.abs(nextMs - persisted.ms) >= 15000
    || (nowTs - persisted.at) >= 60000;

  // Persist selectively to reduce write load with many active sessions.
  if (shouldPersist) {
    const db = getDb();
    if (db) {
      const row = db.prepare('SELECT * FROM "BrowserSession" WHERE id = ?').get(sessionId);
      if (row) {
        const rec = rowToRecord(row);
        const merged = { ...rec, queue_timer_ms: nextMs };
        const now = new Date().toISOString();
        db.prepare('UPDATE "BrowserSession" SET data = ?, updated_date = ? WHERE id = ?')
          .run(JSON.stringify((({ id, created_date, updated_date, ...rest }) => rest)(merged)), now, sessionId);
      }
    }
    queuePersistMeta.set(sessionId, { ms: nextMs, at: nowTs });
  }

  startQueueTimerInternal(sessionId, nextMs, "down");
});

// Session windows report captcha lifecycle events so renderer can open
// on-demand harvester popups and reflect real-time solving status.
ipcMain.on("captcha-event", (_event, payload) => {
  const sessionId = getSessionIdByWebContents(_event.sender);
  if (!sessionId || !mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send("captcha-event", {
    sessionId,
    eventType: payload?.eventType || "detected",
    type: payload?.type || null,
    siteKey: payload?.siteKey || null,
    pageUrl: payload?.pageUrl || null,
    error: payload?.error || null,
    at: payload?.at || new Date().toISOString(),
  });
});

// ── IMAP background polling ─────────────────────────────────────────────────
// Lives entirely in the main process (like the queue timers above) so it keeps
// running no matter which page is open in the renderer — unlike a setTimeout
// loop living in React component state, which dies the moment that page unmounts.
//
// Deliberately uses its own tiny DB helpers below rather than reusing/refactoring
// the db:create / db:update IPC handlers, to avoid touching code every other
// table in the app already depends on.
let imapPollTimer = null;
let imapPollActive = false;
const imapProcessedUids = new Set();

function _imapDbList(table) {
  const db = getDb(); if (!db) return [];
  return db.prepare(`SELECT * FROM "${table}"`).all().map(rowToRecord);
}
function _imapDbCreate(table, data) {
  const db = getDb(); if (!db) return null;
  const id = newId();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO "${table}" (id, created_date, updated_date, data) VALUES (@id, @created_date, @updated_date, @data)`)
    .run({ id, created_date: now, updated_date: now, data: JSON.stringify({ ...data }) });
  return { id, created_date: now, updated_date: now, ...data };
}
function _imapDbUpdate(table, id, data) {
  const db = getDb(); if (!db) return null;
  const existing = rowToRecord(db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id));
  if (!existing) return null;
  const { id: _id, created_date, updated_date, ...rest } = existing;
  const merged = { ...rest, ...data };
  const now = new Date().toISOString();
  db.prepare(`UPDATE "${table}" SET data = ?, updated_date = ? WHERE id = ?`).run(JSON.stringify(merged), now, id);
  return { id, created_date, updated_date: now, ...merged };
}

async function imapPollOnce() {
  const cfg = _imapDbList("ImapConfig")[0];
  if (!cfg?.host || !cfg?.username || !cfg?.password) return;

  let res;
  try {
    const { imapFetch } = require("./imap");
    res = await imapFetch({ host: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password, tls: cfg.tls, limit: 15 });
  } catch (e) {
    res = { error: e.message };
  }

  if (res.error) {
    console.error("[knull-imap] fetch error:", res.error, "mainWindow:", !!mainWindow);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("imap-poll-event", { type: "error", error: res.error });
    }
    return;
  }

  const messages = res.messages || [];
  const accounts = _imapDbList("WalmartAccount");
  const newCodes = [];

  for (const msg of messages) {
    if (imapProcessedUids.has(msg.uid)) continue;
    imapProcessedUids.add(msg.uid);
    if (!msg.code) continue;

    const msgTo = (msg.to || "").toLowerCase();
    const msgSubject = (msg.subject || "").toLowerCase();
    const msgSnippet = (msg.snippet || "").toLowerCase();
    const account = accounts.find((a) => {
      const email = (a.email || "").toLowerCase();
      if (!email) return false;
      if (email === msgTo) return true;
      return msgSubject.includes(email) || msgSnippet.includes(email);
    });
    let delivery_status = "displayed", session_id = null;

    if (!account) {
      delivery_status = "no_account";
    } else {
      const sessions = _imapDbList("BrowserSession").filter(
        (s) => s.walmart_account_id === account.id && s.status === "running"
      );
      if (sessions.length) {
        const win = browserWindows.get(sessions[0].id);
        if (win && !win.isDestroyed()) {
          const creds = sessionCredentials.get(sessions[0].id) || null;
          win.webContents.send("inject-verification-code", { code: msg.code, password: creds?.password || null });
          delivery_status = "auto_filled";
          session_id = sessions[0].id;
          _imapDbUpdate("WalmartAccount", account.id, { status: "signed_in", last_used: new Date().toISOString() });
        } else {
          delivery_status = "no_session";
        }
      } else {
        delivery_status = "no_session";
      }
    }

    const rec = _imapDbCreate("VerificationCode", {
      code: msg.code, to_email: msg.to, from_email: msg.from, subject: msg.subject,
      snippet: msg.snippet, account_id: account ? account.id : null, session_id, delivery_status, message_uid: msg.uid,
    });
    newCodes.push(rec);
  }

  _imapDbUpdate("ImapConfig", cfg.id, { last_sync: new Date().toISOString() });

  mainDebug("[knull-imap] poll complete: found", messages.length, "messages,", newCodes.length, "new codes, mainWindow:", !!mainWindow);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainDebug("[knull-imap] sending imap-poll-event to renderer");
    mainWindow.webContents.send("imap-poll-event", { type: "result", newCodes, checkedCount: messages.length });
  } else {
    console.warn("[knull-imap] mainWindow not ready, event NOT sent");
  }
}

function imapScheduleNext() {
  clearTimeout(imapPollTimer);
  const cfg = _imapDbList("ImapConfig")[0];
  const ms = (cfg?.poll_interval_seconds || 15) * 1000;
  imapPollTimer = setTimeout(async () => {
    if (!imapPollActive) return;
    await imapPollOnce();
    if (imapPollActive) imapScheduleNext();
  }, ms);
}

ipcMain.handle("start-imap-poll", () => {
  mainDebug("[knull-imap] start-imap-poll called, currently active:", imapPollActive);
  if (imapPollActive) return { ok: true, alreadyRunning: true };
  imapPollActive = true;
  // Seed the dedup set from already-known codes so a restart doesn't reprocess old mail.
  imapProcessedUids.clear();
  _imapDbList("VerificationCode").forEach((c) => c.message_uid && imapProcessedUids.add(c.message_uid));
  mainDebug("[knull-imap] poll activated, scheduling first poll");
  imapScheduleNext();
  return { ok: true };
});

ipcMain.handle("stop-imap-poll", () => {
  imapPollActive = false;
  clearTimeout(imapPollTimer);
  imapPollTimer = null;
  return { ok: true };
});

ipcMain.handle("imap-poll-status", () => ({ active: imapPollActive }));

// ── Tray icon ─────────────────────────────────────────────────────────────────
function buildTrayIcon(runningCount) {
  // 16x16 green circle for running, grey for idle — generated as PNG data URI
  const color = runningCount > 0 ? "#10b981" : "#6b7280";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
    <circle cx="8" cy="8" r="7" fill="${color}"/>
    <text x="8" y="12" font-size="9" font-family="monospace" font-weight="bold"
      fill="white" text-anchor="middle">${runningCount > 9 ? "9+" : runningCount}</text>
  </svg>`;
  return nativeImage.createFromDataURL(
    "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64")
  );
}

let _trayDebounce = null;
function updateTray() {
  if (!tray) return;
  clearTimeout(_trayDebounce);
  _trayDebounce = setTimeout(_doUpdateTray, 150);
}
function _doUpdateTray() {
  if (!tray) return;
  const count = browserWindows.size;
  tray.setImage(buildTrayIcon(count));
  tray.setToolTip(`KNULL Queue Destroyer — ${count} session${count !== 1 ? "s" : ""} running`);

  const menu = Menu.buildFromTemplate([
    {
      label: `KNULL Queue Destroyer`,
      enabled: false,
    },
    {
      label: `${count} session${count !== 1 ? "s" : ""} running`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Show Window",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Kill All Sessions",
      click: () => {
        for (const [sessionId, win] of browserWindows.entries()) {
          intentionalKills.add(sessionId);
          try { win.destroy(); } catch (_) {}
          clearQueueTimer(sessionId);
        }
        browserWindows.clear();
        webContentsToSessionId.clear();
        sessionProxies.clear();
        sessionCredentials.clear();
        updateTray();
        if (mainWindow) mainWindow.webContents.send("all-sessions-killed");
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
} // end _doUpdateTray

function createTray() {
  tray = new Tray(buildTrayIcon(0));
  tray.on("double-click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  updateTray();
}

// ── Shared exit handler: confirm + tear down all sessions + quit ──────────────
function confirmAndExit(win) {
  const sessionCount = browserWindows.size;
  const detail = sessionCount > 0
    ? `This will close ${sessionCount} running browser session${sessionCount !== 1 ? "s" : ""}.`
    : "Are you sure you want to exit KNULL Queue Destroyer?";
  const choice = dialog.showMessageBoxSync(win, {
    type: "question",
    buttons: ["Exit", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    title: "Confirm Exit",
    message: "Exit KNULL Queue Destroyer?",
    detail,
  });
  if (choice === 0) {
    for (const [sessionId, bwin] of browserWindows.entries()) {
      intentionalKills.add(sessionId);
      try { bwin.destroy(); } catch (_) {}
    }
    browserWindows.clear();
    webContentsToSessionId.clear();
    sessionProxies.clear();
    sessionCredentials.clear();
    app.exit(0);
  }
}

// ── IPC: forward a Discord webhook from the renderer ─────────────────────────
// Keeps webhook URLs and all outbound HTTP in the main process.
ipcMain.handle("send-discord-webhook", async (_event, { url, content }) => {
  try {
    const res = await nodeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      timeoutMs: 10000,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Main window ───────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0f",
    titleBarStyle: "hidden",
    frame: false,
    icon: WINDOWS_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  let mainUiLoaded = false;
  let mainUiRetried = false;
  let startupCacheHealAttempted = false;

  const logMainUiIssue = (message, details = "") => {
    const full = details ? `${message} — ${details}` : message;
    console.error("[knull-main-ui]", full);
    const db = getDb();
    if (db) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO "SystemLog" (id, created_date, updated_date, data) VALUES (?, ?, ?, ?)`).run(
        newId(), now, now,
        JSON.stringify({ level: "error", source: "MainWindow", message, details: String(details || "") })
      );
    }
  };

  const tryStartupCacheHeal = () => {
    if (startupCacheHealAttempted) return false;
    startupCacheHealAttempted = true;

    try {
      const userData = app.getPath("userData");
      const gpuCachePaths = [
        path.join(userData, "GPUCache"),
        path.join(userData, "DawnGraphiteCache"),
        path.join(userData, "DawnWebGPUCache"),
      ];

      let cleared = 0;
      for (const p of gpuCachePaths) {
        if (fs.existsSync(p)) {
          fs.rmSync(p, { recursive: true, force: true });
          cleared += 1;
        }
      }

      logMainUiIssue("Startup cache self-heal executed", `cleared=${cleared}`);
      return true;
    } catch (e) {
      logMainUiIssue("Startup cache self-heal failed", e?.message || String(e));
      return false;
    }
  };

  win.webContents.once("did-finish-load", () => {
    mainUiLoaded = true;
  });

  win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // aborted navigation
    logMainUiIssue("Main UI failed to load", `[${errorCode}] ${errorDescription} url=${validatedURL || "n/a"}`);

    if (!mainUiLoaded && !mainUiRetried && tryStartupCacheHeal()) {
      mainUiRetried = true;
      try { win.reload(); } catch (_) {}
    }
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    logMainUiIssue("Main renderer process exited", `reason=${details?.reason || "unknown"} code=${details?.exitCode ?? "n/a"}`);
  });

  // Rare startup race/recovery: if UI never paints after launch, retry once.
  setTimeout(() => {
    if (!win.isDestroyed() && !mainUiLoaded && !mainUiRetried) {
      mainUiRetried = true;
      logMainUiIssue("Main UI did not finish loading within timeout", "retrying once");
      tryStartupCacheHeal();
      try { win.reload(); } catch (_) {}
    }
  }, 15000);

  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173"); // Vite dev server
    win.webContents.openDevTools();
  } else {
    // Load the built Vite output locally — no cloud dependency
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // X button — show native confirm dialog, then kill all sessions and quit
  win.on("close", (e) => {
    e.preventDefault(); // always intercept first
    confirmAndExit(win);
  });

  win.on("closed", () => { mainWindow = null; });
}

app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");

// App-level login handler — catches 407 Proxy Auth Required for ALL sessions,
// including plain HTTP requests where the session-level handler doesn't fire.
// Uses the in-memory sessionProxies cache (populated at launch) for O(1) lookup
// instead of querying the DB on every auth challenge.
app.on("login", (_event, _webContents, _req, authInfo, callback) => {
  if (!authInfo.isProxy) { callback(); return; }
  // Match on both host and port to avoid sending wrong credentials when multiple
  // proxies share the same IP but different ports.
  for (const [, p] of sessionProxies.entries()) {
    if (p.host === authInfo.host && String(p.port) === String(authInfo.port) && p.username) {
      callback(p.username, p.password || "");
      return;
    }
  }
  // Fallback: match host only (covers cases where authInfo.port is not populated)
  for (const [, p] of sessionProxies.entries()) {
    if (p.host === authInfo.host && p.username) {
      callback(p.username, p.password || "");
      return;
    }
  }
  callback();
});

function compareVersion(a, b) {
  const ap = String(a || "0").split(".").map((n) => Number(n) || 0);
  const bp = String(b || "0").split(".").map((n) => Number(n) || 0);
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i += 1) {
    const av = ap[i] || 0;
    const bv = bp[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function savePendingUpdate(info = {}) {
  try {
    const payload = {
      version: String(info?.version || ""),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PENDING_UPDATE_PATH, JSON.stringify(payload), "utf8");
  } catch (_) {}
}

function loadPendingUpdate() {
  try {
    if (!fs.existsSync(PENDING_UPDATE_PATH)) return null;
    const raw = fs.readFileSync(PENDING_UPDATE_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function clearPendingUpdate() {
  try {
    if (fs.existsSync(PENDING_UPDATE_PATH)) fs.unlinkSync(PENDING_UPDATE_PATH);
  } catch (_) {}
}

let updaterStatus = {
  phase: "idle",
  message: "Idle",
  version: null,
  percent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0,
  updatedAt: new Date().toISOString(),
};

function setUpdaterStatus(patch = {}) {
  updaterStatus = {
    ...updaterStatus,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", updaterStatus);
  }
}

async function promptInstallDownloadedUpdate(version) {
  const safeVersion = String(version || "new");
  try {
    const res = await dialog.showMessageBox(mainWindow || null, {
      type: "info",
      title: "Update Ready",
      message: `Version ${safeVersion} has been downloaded.`,
      detail: "Restart the app now to install this update.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (res.response === 0) {
      clearPendingUpdate();
      autoUpdater.quitAndInstall(false, true);
    } else {
      savePendingUpdate({ version: safeVersion });
    }
  } catch (e) {
    console.error("[knull] Failed to show update dialog:", e?.message || e);
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    mainDebug("[knull] Auto-updater disabled in development mode");
    setUpdaterStatus({
      phase: "disabled",
      message: "Updater is disabled in development mode.",
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
    });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    mainDebug("[knull] Checking for app updates...");
    setUpdaterStatus({
      phase: "checking",
      message: "Checking for updates...",
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
    });
  });

  autoUpdater.on("update-available", (info) => {
    mainDebug(`[knull] Update available: ${info?.version || "unknown"}`);
    setUpdaterStatus({
      phase: "available",
      version: info?.version || null,
      message: `Update ${info?.version || "new"} found. Downloading in background...`,
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
    });
    dialog.showMessageBox(mainWindow || null, {
      type: "info",
      title: "Update Available",
      message: `Version ${info?.version || "new"} is available. Downloading in the background now.`,
      buttons: ["OK"],
    }).catch(() => {});
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdaterStatus({
      phase: "downloading",
      message: "Downloading update...",
      percent: Number(progress?.percent || 0),
      bytesPerSecond: Number(progress?.bytesPerSecond || 0),
      transferred: Number(progress?.transferred || 0),
      total: Number(progress?.total || 0),
    });
  });

  autoUpdater.on("update-not-available", () => {
    mainDebug("[knull] App is up to date");
    setUpdaterStatus({
      phase: "up-to-date",
      version: app.getVersion(),
      message: "You are already on the latest version.",
      percent: 100,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
    });
  });

  autoUpdater.on("error", (err) => {
    console.error("[knull] Auto-updater error:", err?.message || err);
    setUpdaterStatus({
      phase: "error",
      message: err?.message || "Updater error",
      bytesPerSecond: 0,
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    mainDebug(`[knull] Update downloaded: ${info?.version || "unknown"}`);
    savePendingUpdate(info);
    setUpdaterStatus({
      phase: "downloaded",
      version: info?.version || null,
      message: `Update ${info?.version || "new"} is downloaded and ready to install.`,
      percent: 100,
      bytesPerSecond: 0,
    });
    await promptInstallDownloadedUpdate(info?.version);
  });

  // If an update was already downloaded in a previous run but the user clicked
  // "Later", remind on next launch so the install prompt is not missed.
  const pending = loadPendingUpdate();
  if (pending?.version) {
    if (compareVersion(pending.version, app.getVersion()) <= 0) {
      clearPendingUpdate();
    } else {
      setUpdaterStatus({
        phase: "downloaded",
        version: pending.version,
        message: `Update ${pending.version} is already downloaded and ready to install.`,
        percent: 100,
        bytesPerSecond: 0,
      });
      setTimeout(() => {
        promptInstallDownloadedUpdate(pending.version).catch(() => {});
      }, 1500);
    }
  }

  autoUpdater.checkForUpdates().catch((e) => {
    console.error("[knull] checkForUpdates failed:", e?.message || e);
    setUpdaterStatus({
      phase: "error",
      message: e?.message || "Failed to check for updates.",
      bytesPerSecond: 0,
    });
  });
}

ipcMain.handle("check-for-updates-manual", async () => {
  if (!app.isPackaged) {
    return { ok: false, reason: "not-packaged", message: "Updater is disabled in development mode." };
  }

  const pending = loadPendingUpdate();
  if (pending?.version && compareVersion(pending.version, app.getVersion()) > 0) {
    setUpdaterStatus({
      phase: "downloaded",
      version: pending.version,
      message: `Update ${pending.version} is already downloaded and ready to install.`,
      percent: 100,
      bytesPerSecond: 0,
    });
    promptInstallDownloadedUpdate(pending.version).catch(() => {});
    return {
      ok: true,
      status: "update-ready",
      currentVersion: app.getVersion(),
      pendingVersion: pending.version,
      message: `Version ${pending.version} is already downloaded and ready to install.`,
    };
  }

  try {
    const res = await autoUpdater.checkForUpdates();
    const info = res?.updateInfo || null;
    const nextVersion = info?.version || null;
    if (nextVersion && compareVersion(nextVersion, app.getVersion()) > 0) {
      return {
        ok: true,
        status: "checking-started",
        currentVersion: app.getVersion(),
        nextVersion,
        message: `Update ${nextVersion} found. Downloading in background...`,
      };
    }

    return {
      ok: true,
      status: "up-to-date",
      currentVersion: app.getVersion(),
      message: "You are already on the latest version.",
    };
  } catch (e) {
    setUpdaterStatus({
      phase: "error",
      message: e?.message || "Manual update check failed.",
      bytesPerSecond: 0,
    });
    return {
      ok: false,
      reason: "check-failed",
      message: e?.message || "Manual update check failed.",
    };
  }
});

ipcMain.handle("get-update-status", () => ({
  ok: true,
  currentVersion: app.getVersion(),
  ...updaterStatus,
}));

ipcMain.handle("get-app-version", () => ({
  ok: true,
  version: app.getVersion(),
  packaged: app.isPackaged,
}));

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId(WINDOWS_APP_ID);
  }
  createWindow();
  createTray();
  setupAutoUpdater();
  // Resume IMAP background polling if it was left active from a previous session
  const imapCfg = _imapDbList("ImapConfig")[0];
  if (imapCfg?.is_active) {
    imapPollActive = true;
    imapProcessedUids.clear();
    _imapDbList("VerificationCode").forEach((c) => c.message_uid && imapProcessedUids.add(c.message_uid));
    imapScheduleNext();
  }
});
app.on("window-all-closed", () => {
  if (_quitting) app.exit(0);
});
app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});
app.on("before-quit", () => {
  // Kill any remaining sessions before exit
  for (const [sessionId, bwin] of browserWindows.entries()) {
    intentionalKills.add(sessionId);
    try { bwin.destroy(); } catch (_) {}
  }
  browserWindows.clear();
  webContentsToSessionId.clear();
  sessionProxies.clear();
  sessionCredentials.clear();
  imapPollActive = false;
  clearTimeout(imapPollTimer);
});

// ── IPC: Gemini AI diagnostics ────────────────────────────────────────────────
// API key lives ONLY in the main process — never sent to or stored in the renderer.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL = GEMINI_API_KEY ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}` : "";
let GEMINI_URL_OVERRIDE = null;

ipcMain.handle("set-gemini-key", (_event, key) => {
  GEMINI_URL_OVERRIDE = key?.trim()
    ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key.trim()}`
    : null;
  return { ok: true };
});

ipcMain.handle("gemini-analyze", async (_event, { logs, proxySummary }) => {
  try {
    const prompt = `You are an expert diagnostics assistant for a high-performance browser session orchestration tool called KNULL Queue Destroyer.

Analyze the following system logs and proxy health summary, then provide:
1. CRITICAL ISSUES: Any crashes, errors, or failures that need immediate attention
2. PATTERNS: Recurring issues or trends detected (e.g. specific proxy hosts failing, timing issues)
3. SUGGESTED FIXES: Concrete, actionable steps to resolve each issue (be specific — proxy IPs, error codes, config changes)
4. HEALTH SCORE: A score out of 100 for overall system health

Proxy Summary:
${proxySummary}

Recent System Logs (newest first):
${logs}

Respond in plain English. Be concise and technical. Format with clear section headers.`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    });

    const res = await nodeFetch(GEMINI_URL_OVERRIDE || GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      timeoutMs: 30000,
    });

    const data = await res.json();
    if (!res.ok) return { error: data.error?.message || `Gemini API error ${res.status}` };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { error: "No response from Gemini" };
    return { result: text };
  } catch (e) {
    return { error: e.message };
  }
});

// ── IPC: Cloudflare activation request (bypasses Electron renderer CORS) ─────
ipcMain.handle("cf-request", async (_event, { url, body }) => {
  try {
    const parsed = new URL(url);
    const isTrustedHost = parsed.protocol === "https:" && parsed.hostname === "knull-activation.sloanbrack.workers.dev";
    const isTrustedPath = parsed.pathname === "/activate";
    if (!isTrustedHost || !isTrustedPath) {
      return { error: "Blocked untrusted activation endpoint" };
    }

    const res = await nodeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 15000,
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle("get-device-id", () => getOrCreateDeviceId());

// ── IPC: window controls ──────────────────────────────────────────────────────
ipcMain.handle("window-minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle("window-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("window-close", () => {
  if (!mainWindow) return;
  confirmAndExit(mainWindow);
});

ipcMain.handle("show-browser-window", (_event, sessionId) => {
  const win = browserWindows.get(sessionId);
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
});

ipcMain.handle("focusBrowser", (_event, sessionId) => {
  const win = browserWindows.get(sessionId);
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return { ok: true };
  }
  return { ok: false };
});
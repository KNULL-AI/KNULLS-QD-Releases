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
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

// Persistent keep-alive agents for AYCD polling — reuse TCP connections instead of
// opening a new socket per poll call (critical at 100 concurrent solve tasks)
const _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, keepAliveMsecs: 10000 });
const _httpAgent  = new http.Agent({  keepAlive: true, maxSockets: 32, keepAliveMsecs: 10000 });

// ── SQLite local database ─────────────────────────────────────────────────────
let Database;
try { Database = require("better-sqlite3"); } catch (_) { Database = null; }

const DB_PATH = path.join(app.getPath ? app.getPath("userData") : __dirname, "knull.db");

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
    "DiscordMonitor", "AYCDConfig", "SystemLog", "SessionProfile", "ActivityEvent",
    "WalmartAccount", "ImapConfig", "VerificationCode",
    "WalmartDrop", "CaptchaConfig", "DiscordVerify"
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
  const rows = db.prepare(`SELECT * FROM "${table}"`).all().map(rowToRecord);
  return sortRows(rows, sort).slice(0, limit);
});

ipcMain.handle("db:filter", (_e, { table, query = {}, sort = "-created_date", limit = 500 }) => {
  const db = getDb(); if (!db) return [];
  const rows = db.prepare(`SELECT * FROM "${table}"`).all().map(rowToRecord).filter((r) => matchesQuery(r, query));
  return sortRows(rows, sort).slice(0, limit);
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
  if (table === "AYCDConfig") { _aycdCredCache = null; _aycdCredCacheTs = 0; }
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
  const rows = db.prepare(`SELECT * FROM "${table}"`).all().map(rowToRecord).filter((r) => matchesQuery(r, query));
  const results = [];
  const setData = patch.$set || patch;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const { id, created_date, updated_date, ...rest } = r;
      const merged = { ...rest, ...setData };
      db.prepare(`UPDATE "${table}" SET data = ?, updated_date = ? WHERE id = ?`).run(JSON.stringify(merged), now, id);
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
  const rows = db.prepare(`SELECT * FROM "${table}"`).all().map(rowToRecord).filter((r) => matchesQuery(r, query));
  const del = db.prepare(`DELETE FROM "${table}" WHERE id = ?`);
  const tx = db.transaction(() => { rows.forEach((r) => del.run(r.id)); });
  tx();
});

// Track task BrowserWindows: sessionId → BrowserWindow
const browserWindows = new Map();
// Cache the proxy assigned to each session so the app-level "login" handler
// can resolve 407 proxy auth challenges in O(1) instead of querying the DB.
const sessionProxies = new Map(); // sessionId → { host, username, password }

// Sessions launched as manual-open — closing won't fire session-crashed
const manualOpenSessions = new Set();

// Track queue timer intervals: sessionId → intervalId
const timerIntervals = new Map();

// Sessions being intentionally killed — suppress crash event for these
const intentionalKills = new Set();

// Helper to get the main window
let mainWindow = null;
let tray = null;
let _quitting = false;

// ── IPC: launch a task BrowserWindow ─────────────────────────────────────────
ipcMain.handle("launch-browser", async (_event, { sessionId, url, proxy, userAgent, browser, profile, noPreload = false, manualOpen = false, credentials = null }) => {
  // Close existing window for this session if any
  if (browserWindows.has(sessionId)) {
    try { browserWindows.get(sessionId).destroy(); } catch (_) {}
    browserWindows.delete(sessionId);
  }

  // Each session gets its own isolated cookie/storage partition (persisted across restarts)
  const partition = `persist:knull-${sessionId}`;
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  ses.webRequest.onBeforeSendHeaders(null); // clear stale handler before re-registering
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    h["User-Agent"] = ua;
    // Strip all Electron/Node fingerprint headers
    delete h["X-Electron-Version"];
    delete h["Sec-CH-UA-Full-Version-List"];
    delete h["sec-ch-ua-full-version-list"];
    // Ensure standard browser headers are present
    if (!h["Accept-Language"]) h["Accept-Language"] = profile?.language ? `${profile.language},en;q=0.9` : "en-US,en;q=0.9";
    if (!h["Accept-Encoding"]) h["Accept-Encoding"] = "gzip, deflate, br";
    // Fix sec-ch-ua to match the UA string (Chrome 131)
    h["sec-ch-ua"] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
    h["sec-ch-ua-mobile"] = "?0";
    h["sec-ch-ua-platform"] = '"Windows"';
    callback({ requestHeaders: h });
  });

  const width = profile?.viewport_width || 1280;
  const height = profile?.viewport_height || 800;

  const win = new BrowserWindow({
    width,
    height,
    title: `KNULL — Session ${sessionId}`,
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

  // Block new-window popups that could steal focus/session
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // ── TEMP DEBUG: open DevTools for credentialed manual-open sessions so we can
  // inspect the real login form DOM (shadow roots, actual attribute names, bot
  // challenge overlays, etc). Remove this block once autofill selectors are confirmed.
  if (manualOpen && credentials) {
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed()) win.webContents.openDevTools({ mode: "detach" });
    });
  }

  if (manualOpen) manualOpenSessions.add(sessionId);
  else manualOpenSessions.delete(sessionId);

  win.on("closed", () => {
    browserWindows.delete(sessionId);
    sessionProxies.delete(sessionId);
    if (timerIntervals.has(sessionId)) {
      clearInterval(timerIntervals.get(sessionId));
      timerIntervals.delete(sessionId);
    }
    // Only fire session-crashed if it was NOT an intentional kill and NOT a manual open
    if (!intentionalKills.has(sessionId) && !manualOpenSessions.has(sessionId) && mainWindow) {
      mainWindow.webContents.send("session-crashed", { sessionId, code: 0 });
    }
    intentionalKills.delete(sessionId);
    manualOpenSessions.delete(sessionId);
    updateTray();
  });

  // Log load failures to SystemLog so user can diagnose proxy issues
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
        if (!emailInput) return;

        await humanType(emailInput, ${JSON.stringify(email)});
        await sleep(rand(400, 900)); // human pause before hitting Continue

        const continueBtn = await waitFor(['button[type="submit"]'], 3000);
        if (continueBtn) continueBtn.click();

        // ── Step 2: password field (only exists after Continue) ───────────
        const pwInput = await waitFor(['input[type="password"]'], 15000);
        if (!pwInput) return;

        await sleep(rand(300, 700));
        await humanType(pwInput, ${JSON.stringify(password)});
        await sleep(rand(400, 900));

        const signInBtn = await waitFor(['button[type="submit"]'], 3000);
        if (signInBtn) signInBtn.click();
      })();
    `;

    win.webContents.once("did-finish-load", () => {
      const startDelay = Math.floor(Math.random() * 700) + 800; // 800–1500ms
      setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.executeJavaScript(typeScript).catch(() => {});
      }, startDelay);
    });
  }

  win.loadURL(url);

  browserWindows.set(sessionId, win);
  if (proxy) sessionProxies.set(sessionId, { host: proxy.host, username: proxy.username, password: proxy.password || "" });

  console.log(`[knull] Launched BrowserWindow session ${sessionId} → ${url} via ${proxy ? `${proxy.protocol || "HTTP"} ${proxy.host}:${proxy.port} auth=${!!proxy.username}` : "no proxy"}`);
  updateTray();
  return { ok: true };
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
        // Can't do full SOCKS CONNECT tunnel in pure Node without extra libs — resolve as unsupported
        resolve({ status: 0, error: "SOCKS diagnostic not supported — use HTTP/HTTPS proxies" });
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
      // SOCKS proxies require an external library — mark as unchecked from main process
      // and fall back to a simple TCP connect check
      const net = require("net");
      const socket = net.createConnection({ host: proxyHost, port: proxyPort }, () => {
        socket.destroy();
        resolve({ ok: true, responseTime: Date.now() - start });
      });
      socket.setTimeout(5000);
      socket.on("timeout", () => { socket.destroy(); resolve({ ok: false }); });
      socket.on("error", () => resolve({ ok: false }));
      return;
    }

    const reqOptions = {
      host: proxyHost,
      port: proxyPort,
      method: "HEAD",
      path: testUrl,
      headers: { Host: parsed.host },
      timeout: 6000,
    };
    if (proxy.username) {
      const auth = Buffer.from(`${proxy.username}:${proxy.password || ""}`).toString("base64");
      reqOptions.headers["Proxy-Authorization"] = `Basic ${auth}`;
    }

    const req = http.request(reqOptions, () => {
      resolve({ ok: true, responseTime: Date.now() - start });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.on("error", () => resolve({ ok: false }));
    req.end();
  });
});

// ── AYCD base URL ─────────────────────────────────────────────────────────────
const AYCD_BASE = "https://api.aycd.io/autosolve/v2";

// ── IPC: AYCD AutoSolve — automatic per-session captcha solving ──────────────
// Credentials cached in memory after first load — no per-solve DB hit.
let _aycdCredCache = null;
let _aycdCredCacheTs = 0;

// poll_tier → interval in ms: low=1-10 instances, medium=10-50, high=50-100
const POLL_TIER_MS = { low: 800, medium: 1200, high: 1800 };

function getAycdCreds() {
  // Re-read from DB at most every 30s in case user updated them
  if (_aycdCredCache && Date.now() - _aycdCredCacheTs < 30000) return _aycdCredCache;
  const db = getDb();
  if (!db) return null;
  const configs = db.prepare(`SELECT * FROM "AYCDConfig"`).all().map(rowToRecord);
  const config = configs[0];
  if (!config?.api_key || !config?.access_token) return null;
  _aycdCredCache = {
    apiKey: config.api_key,
    accessToken: config.access_token,
    pollMs: POLL_TIER_MS[config.poll_tier] ?? 1200,
  };
  _aycdCredCacheTs = Date.now();
  return _aycdCredCache;
}

const CAPTCHA_TYPE_MAP = { recaptchav2: "recaptcha-v2", recaptchav3: "recaptcha-v3", hcaptcha: "hcaptcha" };

// Concurrency cap — prevents hammering AYCD at 100 simultaneous instances.
// Submit tasks immediately but share a single polling loop across all in-flight solves.
const _aycdInFlight = new Map(); // taskId → { resolve, reject, headers }
let _aycdPolling = false;

async function _aycdPollLoop() {
  if (_aycdPolling) return;
  _aycdPolling = true;
  while (_aycdInFlight.size > 0) {
    const creds = getAycdCreds();
    const interval = creds?.pollMs ?? 1200;
    await new Promise((r) => setTimeout(r, interval));
    // Poll all in-flight tasks in parallel — one batch per tick
    const entries = [..._aycdInFlight.entries()];
    await Promise.allSettled(entries.map(async ([taskId, { resolve, headers }]) => {
      try {
        const pollRes = await nodeFetch(`${AYCD_BASE}/token/${taskId}`, { method: "GET", headers, timeoutMs: 8000 });
        const pollData = await pollRes.json();
        const token = pollData.token || pollData.solution;
        if (token) {
          _aycdInFlight.delete(taskId);
          resolve({ token });
        } else if (pollData.error) {
          _aycdInFlight.delete(taskId);
          resolve({ error: pollData.error });
        }
      } catch (_) {
        // transient network error — will retry next tick
      }
    }));
  }
  _aycdPolling = false;
}

ipcMain.handle("aycd-autosolve", async (_event, { type, siteKey, pageUrl }) => {
  try {
    const creds = getAycdCreds();
    if (!creds) return { error: "No AYCD credentials — add them in the Captcha Solver page" };

    const headers = {
      "api-key": creds.apiKey,
      "access-token": creds.accessToken,
      "Content-Type": "application/json",
    };
    const captchaType = CAPTCHA_TYPE_MAP[type] || "recaptcha-v2";

    // Submit task — one HTTP call per solve, fast
    const submitRes = await nodeFetch(`${AYCD_BASE}/token`, {
      method: "POST",
      headers,
      timeoutMs: 10000,
      body: JSON.stringify({ "site-key": siteKey, "page-url": pageUrl, "captcha-type": captchaType }),
    });
    const submitData = await submitRes.json();
    if (!submitRes.ok) return { error: submitData.message || `AYCD submit error ${submitRes.status}` };

    const taskId = submitData.taskId || submitData.task_id || submitData.id;
    if (!taskId) return { error: "AYCD did not return a task ID" };

    // Register in shared poll loop — all 100 tasks polled together, not each with own loop
    return await new Promise((resolve) => {
      // Auto-timeout after 120s regardless
      const timeout = setTimeout(() => {
        _aycdInFlight.delete(taskId);
        resolve({ error: "Timed out waiting for AYCD solution (120s)" });
      }, 120000);

      _aycdInFlight.set(taskId, {
        headers,
        resolve: (result) => { clearTimeout(timeout); resolve(result); },
      });

      // Kick off poll loop if not already running
      _aycdPollLoop();
    });
  } catch (e) {
    return { error: e.message };
  }
});

// ── IPC: AYCD AutoSolve API ───────────────────────────────────────────────────

ipcMain.handle("aycd-call", async (_event, { action, apiKey, accessToken, siteKey, pageUrl, captchaType, taskId }) => {
  try {
    const headers = {
      "api-key": apiKey,
      "access-token": accessToken,
      "Content-Type": "application/json",
    };

    if (action === "test") {
      const res = await nodeFetch(`${AYCD_BASE}/token`, { method: "GET", headers });
      return { ok: res.ok || res.status === 404, status: res.status };
    }

    if (action === "submit") {
      const res = await nodeFetch(`${AYCD_BASE}/token`, {
        method: "POST",
        headers,
        timeoutMs: 10000,
        body: JSON.stringify({ "site-key": siteKey, "page-url": pageUrl, "captcha-type": captchaType }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.message || `Error ${res.status}` };
      return data;
    }

    if (action === "poll") {
      const res = await nodeFetch(`${AYCD_BASE}/token/${taskId}`, { method: "GET", headers });
      const data = await res.json();
      return data;
    }

    return { error: "Unknown action" };
  } catch (e) {
    return { error: e.message };
  }
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
  win.webContents.send("inject-verification-code", code);
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
  if (timerIntervals.has(sessionId)) {
    clearInterval(timerIntervals.get(sessionId));
    timerIntervals.delete(sessionId);
  }
  updateTray();
  return { ok: true };
});

// ── IPC: queue timer tick (renderer asks main to start/stop per-session timer) ─
ipcMain.handle("start-queue-timer", (_event, { sessionId, currentMs }) => {
  if (timerIntervals.has(sessionId)) return { ok: true }; // already running
  let ms = currentMs || 0;
  const interval = setInterval(() => {
    ms += 1000;
    if (mainWindow) mainWindow.webContents.send("queue-timer-tick", { sessionId, ms });
  }, 1000);
  timerIntervals.set(sessionId, interval);
  return { ok: true };
});

ipcMain.handle("stop-queue-timer", (_event, sessionId) => {
  if (timerIntervals.has(sessionId)) {
    clearInterval(timerIntervals.get(sessionId));
    timerIntervals.delete(sessionId);
  }
  return { ok: true };
});

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
          if (timerIntervals.has(sessionId)) {
            clearInterval(timerIntervals.get(sessionId));
            timerIntervals.delete(sessionId);
          }
        }
        browserWindows.clear();
        sessionProxies.clear();
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
    sessionProxies.clear();
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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;

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
  for (const [, p] of sessionProxies.entries()) {
    if (p.host === authInfo.host && p.username) {
      callback(p.username, p.password || "");
      return;
    }
  }
  callback();
});

app.whenReady().then(() => {
  createWindow();
  createTray();
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
  sessionProxies.clear();
});

// ── IPC: Gemini AI diagnostics ────────────────────────────────────────────────
// API key lives ONLY in the main process — never sent to or stored in the renderer.
const GEMINI_API_KEY = "AQ.Ab8RN6LahkglZ7UiDjaF1JFEPeI0xfYpW5ET-U_nfi_i-Cyf_w";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
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
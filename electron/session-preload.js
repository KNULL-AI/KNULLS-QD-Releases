/**
 * KNULL — Session Preload
 * Injected into every task BrowserWindow.
 * - Stealth: removes all Electron/automation fingerprints
 * - Captcha detection + token injection hooks for external solvers
 * - Anti-idle: human-like mouse simulation
 * contextIsolation: false — runs in the same JS world as the page.
 */

// Capture Node-scope require FIRST — before stealth patches shadow window.require
const { ipcRenderer } = require("electron");

// ─────────────────────────────────────────────────────────────────────────────
// STEALTH PATCHES — must run first, before any page JS
// ─────────────────────────────────────────────────────────────────────────────

// 1. Nuke Electron/Node globals — done via defineProperty so they can't be re-added
(function nukeElectronGlobals() {
  const noop = undefined;
  ["process", "require", "module", "exports", "__dirname", "__filename"].forEach((key) => {
    try {
      Object.defineProperty(window, key, { get: () => noop, configurable: false });
    } catch (_) {}
  });
})();

// 2. navigator.webdriver — make it non-enumerable and return false
try {
  Object.defineProperty(navigator, "webdriver", {
    get: () => false,
    enumerable: false,
    configurable: true,
  });
} catch (_) {}

// 2b. Basic user-agent / platform / vendor spoofing for page JS
try {
  const runtimeUA = String(navigator.userAgent || "");
  const strippedUA = runtimeUA
    .replace(/\sElectron\/[\d.]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const fakeUA = strippedUA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const chromeMatch = fakeUA.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/i);
  const chromeMajor = chromeMatch ? chromeMatch[1] : "131";
  const chromeFull = chromeMatch ? `${chromeMatch[1]}.${chromeMatch[2]}.${chromeMatch[3]}.${chromeMatch[4]}` : "131.0.0.0";
  Object.defineProperty(navigator, "userAgent", { get: () => fakeUA, enumerable: true, configurable: true });
  Object.defineProperty(navigator, "appVersion", { get: () => fakeUA, enumerable: true, configurable: true });
  Object.defineProperty(navigator, "platform", { get: () => "Win32", enumerable: true, configurable: true });
  Object.defineProperty(navigator, "vendor", { get: () => "Google Inc.", enumerable: true, configurable: true });
  Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0, enumerable: true, configurable: true });

  // 2c. navigator.userAgentData for modern Chromium UA-CH checks
  try {
    const fakeUAData = {
      brands: [
        { brand: "Google Chrome", version: chromeMajor },
        { brand: "Chromium", version: chromeMajor },
        { brand: "Not A(Brand)", version: "24" },
      ],
      mobile: false,
      platform: "Windows",
      getHighEntropyValues: async (hints) => {
        const base = {
          architecture: "x86",
          bitness: "64",
          model: "",
          platform: "Windows",
          platformVersion: "10.0.0",
          uaFullVersion: chromeFull,
          fullVersionList: [
            { brand: "Google Chrome", version: chromeFull },
            { brand: "Chromium", version: chromeFull },
            { brand: "Not A(Brand)", version: "24.0.0.0" },
          ],
        };
        if (!Array.isArray(hints)) return base;
        return hints.reduce((acc, key) => {
          if (Object.prototype.hasOwnProperty.call(base, key)) acc[key] = base[key];
          return acc;
        }, {});
      },
    };
    Object.defineProperty(navigator, "userAgentData", { get: () => fakeUAData, enumerable: true, configurable: true });
  } catch (_) {}
} catch (_) {}

// 3. Spoof navigator.plugins — empty list is a dead giveaway
try {
  const fakePlugins = [
    { name: "Chrome PDF Plugin",   filename: "internal-pdf-viewer",  description: "Portable Document Format" },
    { name: "Chrome PDF Viewer",   filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
    { name: "Native Client",       filename: "internal-nacl-plugin",  description: "" },
  ];
  const pluginArray = Object.create(PluginArray.prototype);
  fakePlugins.forEach((p, i) => {
    const plugin = Object.create(Plugin.prototype);
    Object.defineProperty(plugin, "name",        { get: () => p.name });
    Object.defineProperty(plugin, "filename",    { get: () => p.filename });
    Object.defineProperty(plugin, "description", { get: () => p.description });
    Object.defineProperty(plugin, "length",      { get: () => 0 });
    Object.defineProperty(pluginArray, i,        { get: () => plugin, enumerable: true });
  });
  Object.defineProperty(pluginArray, "length",   { get: () => fakePlugins.length });
  Object.defineProperty(navigator, "plugins",    { get: () => pluginArray, enumerable: true, configurable: true });
} catch (_) {}

// 4. navigator.mimeTypes — must be non-empty alongside plugins
try {
  const fakeMimes = [
    { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: null },
  ];
  const mimeArray = Object.create(MimeTypeArray.prototype);
  fakeMimes.forEach((m, i) => {
    const mime = Object.create(MimeType.prototype);
    Object.defineProperty(mime, "type",        { get: () => m.type });
    Object.defineProperty(mime, "suffixes",    { get: () => m.suffixes });
    Object.defineProperty(mime, "description", { get: () => m.description });
    Object.defineProperty(mimeArray, i,        { get: () => mime, enumerable: true });
  });
  Object.defineProperty(mimeArray, "length", { get: () => fakeMimes.length });
  Object.defineProperty(navigator, "mimeTypes", { get: () => mimeArray, enumerable: true, configurable: true });
} catch (_) {}

// 5. navigator.languages — realistic
try {
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"], enumerable: true, configurable: true });
} catch (_) {}

// 6. navigator.hardwareConcurrency + deviceMemory — zero = obvious bot
try {
  Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8,  enumerable: true, configurable: true });
  Object.defineProperty(navigator, "deviceMemory",        { get: () => 8,  enumerable: true, configurable: true });
} catch (_) {}

// 7. window.chrome — Chrome exposes this; its absence triggers bot checks
try {
  if (!window.chrome) {
    Object.defineProperty(window, "chrome", {
      value: {
        app: { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" } },
        runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {} },
        loadTimes: function() { return {}; },
        csi: function() { return { onloadT: Date.now(), pageT: Date.now(), startE: Date.now(), tran: 15 }; },
      },
      enumerable: true,
      configurable: true,
      writable: false,
    });
  }
} catch (_) {}

// 8. Permissions API — navigator.permissions.query({ name: "notifications" }) should not return "denied" instantly
try {
  const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
  if (origQuery) {
    navigator.permissions.query = (params) => {
      if (params?.name === "notifications") return Promise.resolve({ state: Notification.permission, onchange: null });
      return origQuery(params);
    };
  }
} catch (_) {}

// 9. navigator.connection — undefined/null rtt is a primary bot signal on Akamai/PerimeterX
try {
  const fakeConnection = {
    rtt: 50 + Math.floor(Math.random() * 50),       // realistic 50–100ms
    downlink: 10 + Math.random() * 5,               // ~10–15 Mbps
    effectiveType: "4g",
    saveData: false,
    onchange: null,
  };
  Object.defineProperty(navigator, "connection", { get: () => fakeConnection, enumerable: true, configurable: true });
  Object.defineProperty(navigator, "mozConnection",    { get: () => fakeConnection, enumerable: false, configurable: true });
  Object.defineProperty(navigator, "webkitConnection", { get: () => fakeConnection, enumerable: false, configurable: true });
} catch (_) {}

// 10. performance.now() — add subtle per-instance jitter so all 100 windows don't return
//     identical timing deltas (a statistical bot signal when sampled across many requests)
try {
  const _origPerfNow = performance.now.bind(performance);
  const _jitter = Math.random() * 0.3; // 0–0.3ms constant offset, unique per window
  performance.now = function () { return _origPerfNow() + _jitter; };
} catch (_) {}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE QUEUE WAIT DETECTION (all retailers)
// Reports "Estimated wait time" to main process so the Queue Leaderboard can
// show live shortest-wait ranking across active browser instances.
// ─────────────────────────────────────────────────────────────────────────────

let _lastQueueMsSent = null;
let _lastQueueSendAt = 0;

function parseQueueWaitMs(text) {
  if (!text) return null;

  // HH:MM:SS format
  let m = text.match(/(?:estimated\s+)?wait\s+time\s*:?\s*(\d{1,2}):(\d{2}):(\d{2})/i)
    || text.match(/virtual\s+queue[^\n]*?(\d{1,2}):(\d{2}):(\d{2})/i);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const sec = Number(m[3]);
    if (Number.isFinite(h) && Number.isFinite(min) && Number.isFinite(sec)) {
      return ((h * 3600) + (min * 60) + sec) * 1000;
    }
  }

  // MM:SS format
  m = text.match(/(?:estimated\s+)?wait\s+time\s*:?\s*(\d{1,3}):(\d{2})(?!:)/i);
  if (m) {
    const min = Number(m[1]);
    const sec = Number(m[2]);
    if (Number.isFinite(min) && Number.isFinite(sec)) {
      return ((min * 60) + sec) * 1000;
    }
  }

  // Textual formats, e.g. "wait time: 50 minutes" / "1 hour 20 minutes"
  const hm = text.match(/(?:estimated\s+)?wait\s+time\s*:?\s*(?:(\d+)\s*hour[s]?)?\s*(?:(\d+)\s*minute[s]?)?/i);
  if (hm && (hm[1] || hm[2])) {
    const h = Number(hm[1] || 0);
    const min = Number(hm[2] || 0);
    if (Number.isFinite(h) && Number.isFinite(min)) {
      return ((h * 3600) + (min * 60)) * 1000;
    }
  }

  return null;
}

function readQueueWaitMsFromDom() {
  const txt = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  if (!txt) return null;
  // Queue pages vary by retailer — keep this broad but still queue-specific.
  if (!/virtual\s+queue|estimated\s+wait\s+time|you('?|\sa)re\s+in\s+the\s+queue|queue\s+to\s+access/i.test(txt)) return null;
  return parseQueueWaitMs(txt);
}

function reportQueueWaitIfNeeded() {
  try {
    const ms = readQueueWaitMsFromDom();
    if (ms == null || ms <= 0) return;

    const now = Date.now();
    const changedEnough = _lastQueueMsSent == null || Math.abs(ms - _lastQueueMsSent) > 15000;
    const staleReport = now - _lastQueueSendAt > 30000;
    if (!changedEnough && !staleReport) return;

    _lastQueueMsSent = ms;
    _lastQueueSendAt = now;
    ipcRenderer.send("queue-wait-detected", { remainingMs: ms });
  } catch (_) {}
}

// Initial and periodic scans (queue pages can transition dynamically).
setTimeout(reportQueueWaitIfNeeded, 800);
setTimeout(reportQueueWaitIfNeeded, 3000);
setInterval(reportQueueWaitIfNeeded, 5000);

// Mutation-driven updates with debounce to avoid flood on heavily dynamic pages.
let _queueScanScheduled = false;
const queueObserver = new MutationObserver(() => {
  if (_queueScanScheduled) return;
  _queueScanScheduled = true;
  setTimeout(() => {
    _queueScanScheduled = false;
    reportQueueWaitIfNeeded();
  }, 700);
});

try {
  if (document.documentElement) {
    queueObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }
} catch (_) {}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTCHA DETECTION + TOKEN INJECTION
// ─────────────────────────────────────────────────────────────────────────────

let _solving = false;
let _lastSolvedKey = "";  // siteKey+pathname combo
let _lastSolvedTs = 0;    // timestamp of last successful solve
let _lastDetectedKey = "";
let _lastDetectedTs = 0;
let _cachedV3Href = "";
let _cachedV3SiteKey = "";
let _lastV3ScanTs = 0;

function emitCaptchaEvent(eventType, info = {}, extra = {}) {
  try {
    ipcRenderer.send("captcha-event", {
      eventType,
      type: info?.type || null,
      siteKey: info?.siteKey || null,
      pageUrl: info?.pageUrl || window.location.href,
      at: new Date().toISOString(),
      ...extra,
    });
  } catch (_) {}
}

function detectCaptcha() {
  const url = window.location.href;

  // reCAPTCHA v2 — standard div or invisible
  const rcV2 = document.querySelector("[data-sitekey]");
  if (rcV2) {
    // Exclude hCaptcha elements
    if (!rcV2.classList.contains("h-captcha") && !rcV2.hasAttribute("data-hcaptcha-sitekey")) {
      const siteKey = rcV2.getAttribute("data-sitekey");
      if (siteKey) return { type: "recaptchav2", siteKey, pageUrl: url };
    }
  }

  // reCAPTCHA v3 — render= param in script src.
  // Scan at most once per second per URL to avoid repeated full script walks.
  if (url !== _cachedV3Href) {
    _cachedV3Href = url;
    _cachedV3SiteKey = "";
    _lastV3ScanTs = 0;
  }

  const now = Date.now();
  if (!_cachedV3SiteKey && now - _lastV3ScanTs > 1000) {
    _lastV3ScanTs = now;
    for (const s of document.querySelectorAll("script[src]")) {
      if (s.src.includes("recaptcha") && s.src.includes("render=")) {
        const m = s.src.match(/render=([^&]+)/);
        if (m && m[1] !== "explicit") {
          _cachedV3SiteKey = m[1];
          break;
        }
      }
    }
  }

  if (_cachedV3SiteKey) return { type: "recaptchav3", siteKey: _cachedV3SiteKey, pageUrl: url };

  // hCaptcha
  const hcap = document.querySelector(".h-captcha[data-sitekey], [data-hcaptcha-sitekey]");
  if (hcap) {
    const siteKey = hcap.getAttribute("data-sitekey") || hcap.getAttribute("data-hcaptcha-sitekey");
    if (siteKey) return { type: "hcaptcha", siteKey, pageUrl: url };
  }

  return null;
}

function injectToken(type, token) {
  // Inject into all response textareas (some sites have multiple iframes)
  const fieldName = type === "hcaptcha" ? "h-captcha-response" : "g-recaptcha-response";
  document.querySelectorAll(`textarea[name="${fieldName}"], #${fieldName}`).forEach((el) => {
    try {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, token);
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {
      try { el.value = token; } catch (_) {}
    }
  });

  // Fire grecaptcha widget callback directly
  try {
    if (type !== "hcaptcha") {
      const cfg = window.___grecaptcha_cfg;
      if (cfg?.clients) {
        Object.values(cfg.clients).forEach((client) => {
          // Walk all keys looking for a callback function
          const walk = (obj, depth = 0) => {
            if (depth > 4 || !obj || typeof obj !== "object") return;
            if (typeof obj.callback === "function") { try { obj.callback(token); } catch (_) {} return; }
            Object.values(obj).forEach((v) => walk(v, depth + 1));
          };
          walk(client);
        });
      }
    }
  } catch (_) {}

  // hCaptcha — trigger execute() for invisible variant and fire callback if registered
  try {
    if (type === "hcaptcha" && typeof window.hcaptcha !== "undefined") {
      // Fire widget callback if registered
      const widgetId = document.querySelector("[data-hcaptcha-widget-id]")?.getAttribute("data-hcaptcha-widget-id") ?? "0";
      if (typeof window.hcaptcha.getResponse === "function" && !window.hcaptcha.getResponse(widgetId)) {
        // Response not yet registered — try execute for invisible hCaptcha
        try { window.hcaptcha.execute(widgetId); } catch (_) {}
      }
      // Walk hcaptcha internal config for the callback
      if (window.hcaptcha.__hCaptchaApi?.callbacks) {
        Object.values(window.hcaptcha.__hCaptchaApi.callbacks).forEach((cb) => {
          if (typeof cb === "function") { try { cb(token); } catch (_) {} }
        });
      }
    }
  } catch (_) {}
}

async function trySolve() {
  if (_solving) return;
  const info = detectCaptcha();
  if (!info) return;

  const detectedKey = info.siteKey + "|" + window.location.pathname + "|" + info.type;
  if (_lastDetectedKey !== detectedKey || Date.now() - _lastDetectedTs > 30000) {
    _lastDetectedKey = detectedKey;
    _lastDetectedTs = Date.now();
    emitCaptchaEvent("detected", info);
  }

  // Actual solve happens externally (renderer/main solver pipeline).
  // We keep state here to avoid duplicate challenge notifications.
  _solving = true;
  setTimeout(() => { _solving = false; }, 200);
}

ipcRenderer.on("inject-captcha-token", (_e, payload) => {
  const type = payload?.type;
  const token = payload?.token;
  if (!type || !token) return;

  try {
    injectToken(type, token);
    _lastSolvedKey = `${type}|${window.location.pathname}`;
    _lastSolvedTs = Date.now();
    emitCaptchaEvent("solved", { type, pageUrl: window.location.href, siteKey: null });
  } catch (_) {
    emitCaptchaEvent("error", { type, pageUrl: window.location.href, siteKey: null }, { error: "Token injection failed" });
  }
});

// Watch for captcha DOM nodes being added — debounced so heavy mutation bursts
// (queue sites updating the DOM constantly) don't queue thousands of trySolve calls.
let _observerDebounce = null;
const _captchaObserver = new MutationObserver(() => {
  if (_solving) return;
  clearTimeout(_observerDebounce);
  _observerDebounce = setTimeout(trySolve, 200);
});

function startCaptchaObserver() {
  _captchaObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  setTimeout(trySolve, 500);
}

// Handle both: DOM already ready (preload fires after load) and not yet ready
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startCaptchaObserver, { once: true });
} else {
  // DOM already loaded — start immediately
  startCaptchaObserver();
}

// Reset dedup state on navigation so new pages always solve fresh
function resetSolveState() { _lastSolvedKey = ""; _lastSolvedTs = 0; }
window.addEventListener("popstate", () => { resetSolveState(); setTimeout(trySolve, 500); });
window.addEventListener("load",     () => { resetSolveState(); setTimeout(trySolve, 600); });

// ─────────────────────────────────────────────────────────────────────────────
// WALMART LOGIN AUTO-FILL — triggered on launch with account credentials
// ─────────────────────────────────────────────────────────────────────────────
ipcRenderer.on("autofill-credentials", (_e, { email, password }) => {
  function fillInput(el, value) {
    // Use React's internal setter so onChange fires properly
    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeInputSetter) nativeInputSetter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup",   { bubbles: true }));
  }

  let _autofillDone = false;

  function waitForInput(selector, cb, maxWaitMs = 10000) {
    const start = Date.now();
    const poll = () => {
      const el = document.querySelector(selector);
      if (el) { cb(el); return; }
      if (Date.now() - start < maxWaitMs) setTimeout(poll, 300);
    };
    poll();
  }

  function doAutofill() {
    if (_autofillDone) return;
    // Walmart uses: input[name="email"] on step 1, input[type="password"] on step 2
    const emailSelectors = 'input[name="email"], input[type="email"], input[name="phone-number-email-field"], input[autocomplete="email"], input[autocomplete="username"]';
    waitForInput(emailSelectors, (emailEl) => {
      if (_autofillDone) return;
      fillInput(emailEl, email);
      emailEl.focus();
      setTimeout(() => {
        // Click the primary submit button to proceed to step 2
        const btn = document.querySelector('button[type="submit"]');
        if (btn) btn.click();
        // Poll for password field
        waitForInput('input[type="password"]', (pwEl) => {
          if (_autofillDone) return;
          _autofillDone = true;
          setTimeout(() => {
            fillInput(pwEl, password);
            pwEl.focus();
            setTimeout(() => {
              const signInBtn = document.querySelector('button[type="submit"]');
              if (signInBtn) signInBtn.click();
            }, 600);
          }, 400);
        });
      }, 800);
    });
  }

  // Small initial delay in case the SPA hasn't rendered yet
  setTimeout(doAutofill, 800);
});

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICATION CODE AUTO-FILL — triggered by main process when IMAP finds a code
// ─────────────────────────────────────────────────────────────────────────────
ipcRenderer.on("inject-verification-code", (_e, payload) => {
  const code = typeof payload === "object" && payload !== null ? payload.code : payload;
  const fallbackPassword = typeof payload === "object" && payload !== null ? payload.password : null;

  function fillInput(el, value) {
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(el, value); else el.value = value;
    } catch (_) { try { el.value = value; } catch (_) {} }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "0", bubbles: true }));
  }
  function visible(el) { return el.offsetParent !== null || el.getClientRects().length > 0; }

  function findVisibleInputByPredicate(predicate) {
    const inputs = document.querySelectorAll("input");
    for (const el of inputs) {
      if (!visible(el)) continue;
      if (predicate(el)) return el;
    }
    return null;
  }

  function findVisibleButtonByText(textMatcher, root = document) {
    const buttons = root.querySelectorAll('button[type="submit"], button');
    for (const button of buttons) {
      if (!visible(button) || button.disabled) continue;
      const txt = (button.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
      if (textMatcher(txt)) return button;
    }
    return null;
  }

  function listVisibleInputs() {
    const inputs = [];
    const nodes = document.querySelectorAll("input");
    for (const el of nodes) {
      if (visible(el)) inputs.push(el);
    }
    return inputs;
  }

  // Some Walmart flows ask for password again after OTP submission.
  // Retry for a short window and submit automatically when that prompt appears.
  function handlePostCodePasswordChallenge(password) {
    if (!password) return;
    const started = Date.now();
    const maxMs = 30000;

    const tryFill = () => {
      const pw = findVisibleInputByPredicate((el) => el.type === "password");
      if (pw) {
        fillInput(pw, String(password));
        pw.focus();
        setTimeout(() => {
          const btn = findVisibleButtonByText((t) => t === "continue" || t === "sign in" || t.includes("continue"));
          if (btn) btn.click();
        }, 300);
        return;
      }
      if (Date.now() - started < maxMs) setTimeout(tryFill, 600);
    };

    setTimeout(tryFill, 900);
  }

  // Walmart enables its primary submit action only after React processes every
  // OTP input event. Wait for that state instead of clicking a generic button
  // (which could select the passkey alternative on this screen).
  function submitVerification() {
    const started = Date.now();
    const trySubmit = () => {
      const signIn = findVisibleButtonByText((t) => t === "sign in");
      if (signIn) {
        signIn.click();
        handlePostCodePasswordChallenge(fallbackPassword);
        return;
      }
      if (Date.now() - started < 5000) setTimeout(trySubmit, 150);
    };
    setTimeout(trySubmit, 250);
  }
  const textTypes = ["text", "tel", "number", ""];
  const visibleInputs = listVisibleInputs();

  // 1) Per-digit OTP boxes (maxlength=1) — distribute one char each
  const singles = visibleInputs.filter((el) => el.getAttribute("maxlength") === "1" && (el.type || "text"));
  if (singles.length >= String(code).length) {
    for (let i = 0; i < String(code).length; i++) fillInput(singles[i], String(code)[i]);
    submitVerification();
    return;
  }

  // 2) A single OTP-style input that looks like a code field
  const labelled = visibleInputs.filter((el) => {
    const t = (el.type || "text").toLowerCase();
    if (!textTypes.includes(t)) return false;
    const sig = ((el.name || "") + " " + (el.id || "") + " " + (el.placeholder || "") + " " + (el.getAttribute("autocomplete") || "")).toLowerCase();
    return /code|otp|verif|pin|mfa|token|2fa/.test(sig);
  });
  if (labelled.length) { fillInput(labelled[0], String(code)); submitVerification(); return; }

  // 3) Any empty visible text/tel/number input
  const any = visibleInputs.filter((el) => !el.value && textTypes.includes((el.type || "text").toLowerCase()));
  if (any.length) { fillInput(any[0], String(code)); submitVerification(); }

  handlePostCodePasswordChallenge(fallbackPassword);
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE VISIBILITY SPOOF — always report "visible" so hidden windows don't
// trigger retailer-side reload/pause logic (Costco, PokemonCenter, Walmart
// all check document.visibilityState / document.hidden on visibilitychange)
// ─────────────────────────────────────────────────────────────────────────────
try {
  Object.defineProperty(document, "hidden",           { get: () => false, configurable: true });
  Object.defineProperty(document, "visibilityState",  { get: () => "visible", configurable: true });
  // Suppress visibilitychange events entirely — sites can't detect the window going to background
  const _origAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, opts) {
    if (type === "visibilitychange") return; // drop silently
    return _origAEL.call(this, type, listener, opts);
  };
  // Also stop the event from firing via document.onvisibilitychange
  Object.defineProperty(document, "onvisibilitychange", { get: () => null, set: () => {}, configurable: true });
  // Block pagehide / blur events that trigger session-abandonment or queue-drop logic
  window.addEventListener("pagehide", (e) => { e.stopImmediatePropagation(); }, true);
  window.addEventListener("blur",     (e) => { e.stopImmediatePropagation(); }, true);
} catch (_) {}

// ─────────────────────────────────────────────────────────────────────────────
// ANTI-REFRESH / META REFRESH BLOCKER
// ─────────────────────────────────────────────────────────────────────────────
function setupAntiRefresh() {
  const _origReload = window.location.reload.bind(window.location);
  let _recentInteraction = false;
  let _interactionTimer = null;
  const markInteraction = () => {
    _recentInteraction = true;
    clearTimeout(_interactionTimer);
    _interactionTimer = setTimeout(() => { _recentInteraction = false; }, 2000);
  };
  window.addEventListener("click",   markInteraction, true);
  window.addEventListener("keydown", markInteraction, true);

  try {
    window.location.reload = function (...args) {
      if (_recentInteraction) return _origReload(...args);
    };
  } catch (_) {}

  document.querySelectorAll('meta[http-equiv="refresh" i]').forEach((el) => el.remove());
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.tagName === "META" && node.httpEquiv?.toLowerCase() === "refresh") {
          node.remove();
        }
      }
    }
  }).observe(document.head || document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", setupAntiRefresh, { once: true });
} else {
  setupAntiRefresh();
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTI-IDLE — human-curve mouse movement
// ─────────────────────────────────────────────────────────────────────────────
(function antiIdle() {
  let _mx = Math.floor(Math.random() * 800) + 200;
  let _my = Math.floor(Math.random() * 400) + 200;

  function easeRand(current, max) {
    // Move by a small random delta with slight bias toward center to stay on-screen
    const delta = (Math.random() - 0.48) * 60;
    let next = current + delta;
    if (next < 50) next = 50 + Math.random() * 40;
    if (next > max - 50) next = (max - 50) - Math.random() * 40;
    return Math.round(next);
  }

  setInterval(() => {
    try {
      const w = window.innerWidth || 1280;
      const h = window.innerHeight || 800;
      _mx = easeRand(_mx, w);
      _my = easeRand(_my, h);
      document.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true, cancelable: true,
        clientX: _mx, clientY: _my,
        movementX: Math.round((Math.random() - 0.5) * 8),
        movementY: Math.round((Math.random() - 0.5) * 8),
      }));
    } catch (_) {}
  }, 20000 + Math.floor(Math.random() * 20000)); // random 20–40s to avoid timing fingerprint
})();

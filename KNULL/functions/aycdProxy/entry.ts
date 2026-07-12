// ── KNULL Captcha Proxy ───────────────────────────────────────────────────────
// This function is a LOCAL REFERENCE ONLY.
// The community pool route is intentionally disabled here.
// Deploy this logic to your own server/cloud (Cloudflare Workers, Railway, etc.)
// and set MASTER_KEY_ENDPOINT in src/pages/CaptchaSolver.jsx to point to it.
//
// Your server is responsible for:
//   - Storing & validating the community master API key (never expose in frontend)
//   - Tracking per-user solve counts (by any identifier you choose, e.g. Discord ID)
//   - Enforcing monthly limits before forwarding to AYCD/CapSolver/etc.
//   - Returning { error, pool_empty, user_limit_reached } for limit responses
// ─────────────────────────────────────────────────────────────────────────────

// ── Provider API bases ────────────────────────────────────────────────────────
const PROVIDERS: Record<string, string> = {
  aycd:       "https://token.aycd.io",
  capsolver:  "https://api.capsolver.com",
  capmonster: "https://api.capmonster.cloud",
  "2captcha": "https://2captcha.com/in.php",
};

const TYPE_MAP: Record<string, Record<string, string>> = {
  aycd:       { recaptchav2: "recaptcha-v2",                recaptchav3: "recaptcha-v3",               hcaptcha: "hcaptcha" },
  capsolver:  { recaptchav2: "ReCaptchaV2TaskProxyless",    recaptchav3: "ReCaptchaV3TaskProxyless",   hcaptcha: "HCaptchaTaskProxyless" },
  capmonster: { recaptchav2: "NoCaptchaTaskProxyless",      recaptchav3: "RecaptchaV3TaskProxyless",   hcaptcha: "HCaptchaTaskProxyless" },
  "2captcha": { recaptchav2: "userrecaptcha",               recaptchav3: "userrecaptcha",              hcaptcha: "hcaptcha" },
};

// ── AYCD ──────────────────────────────────────────────────────────────────────
async function aycdSubmit(apiKey: string, accessToken: string, siteKey: string, pageUrl: string, captchaType: string) {
  const res = await fetch(`${PROVIDERS.aycd}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ "api-key": apiKey, "access-token": accessToken, "site-key": siteKey, "page-url": pageUrl, "captcha-type": TYPE_MAP.aycd[captchaType] ?? captchaType }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `AYCD error ${res.status}`);
  return { taskId: data.taskId ?? data.task_id ?? data.id };
}
async function aycdPoll(apiKey: string, accessToken: string, taskId: string) {
  const res = await fetch(`${PROVIDERS.aycd}/token/${taskId}`, { headers: { "api-key": apiKey, "access-token": accessToken } });
  const data = await res.json();
  return { token: data.token ?? data.solution ?? null, error: data.error ?? null };
}
async function aycdTest(apiKey: string, accessToken: string) {
  const res = await fetch(`${PROVIDERS.aycd}/token`, { method: "GET", headers: { "api-key": apiKey, "access-token": accessToken } });
  return res.ok || res.status === 404;
}

// ── CapSolver ─────────────────────────────────────────────────────────────────
async function capsolverSubmit(apiKey: string, siteKey: string, pageUrl: string, captchaType: string) {
  const res = await fetch(`${PROVIDERS.capsolver}/createTask`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: apiKey, task: { type: TYPE_MAP.capsolver[captchaType] ?? "ReCaptchaV2TaskProxyless", websiteURL: pageUrl, websiteKey: siteKey } }),
  });
  const data = await res.json();
  if (data.errorId) throw new Error(data.errorDescription || `CapSolver error ${data.errorId}`);
  return { taskId: String(data.taskId) };
}
async function capsolverPoll(apiKey: string, taskId: string) {
  const res = await fetch(`${PROVIDERS.capsolver}/getTaskResult`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: apiKey, taskId }),
  });
  const data = await res.json();
  return data.status === "ready" ? { token: data.solution?.gRecaptchaResponse ?? data.solution?.token ?? null } : { token: null };
}
async function capsolverTest(apiKey: string) {
  const res = await fetch(`${PROVIDERS.capsolver}/getBalance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientKey: apiKey }) });
  const data = await res.json();
  return data.errorId === 0;
}

// ── CapMonster ────────────────────────────────────────────────────────────────
async function capmonsterSubmit(apiKey: string, siteKey: string, pageUrl: string, captchaType: string) {
  const res = await fetch(`${PROVIDERS.capmonster}/createTask`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: apiKey, task: { type: TYPE_MAP.capmonster[captchaType] ?? "NoCaptchaTaskProxyless", websiteURL: pageUrl, websiteKey: siteKey } }),
  });
  const data = await res.json();
  if (data.errorId) throw new Error(data.errorDescription || `CapMonster error ${data.errorId}`);
  return { taskId: String(data.taskId) };
}
async function capmonsterPoll(apiKey: string, taskId: string) {
  const res = await fetch(`${PROVIDERS.capmonster}/getTaskResult`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: apiKey, taskId }),
  });
  const data = await res.json();
  return data.status === "ready" ? { token: data.solution?.gRecaptchaResponse ?? data.solution?.token ?? null } : { token: null };
}
async function capmonsterTest(apiKey: string) {
  const res = await fetch(`${PROVIDERS.capmonster}/getBalance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientKey: apiKey }) });
  const data = await res.json();
  return data.errorId === 0;
}

// ── 2Captcha ──────────────────────────────────────────────────────────────────
async function twocaptchaSubmit(apiKey: string, siteKey: string, pageUrl: string, captchaType: string) {
  const method = TYPE_MAP["2captcha"][captchaType] ?? "userrecaptcha";
  const params = new URLSearchParams({ key: apiKey, method, googlekey: siteKey, pageurl: pageUrl, json: "1" });
  const res = await fetch(`${PROVIDERS["2captcha"]}?${params}`);
  const data = await res.json();
  if (data.status !== 1) throw new Error(data.request || "2Captcha submit error");
  return { taskId: String(data.request) };
}
async function twocaptchaPoll(apiKey: string, taskId: string) {
  const params = new URLSearchParams({ key: apiKey, action: "get", id: taskId, json: "1" });
  const res = await fetch(`https://2captcha.com/res.php?${params}`);
  const data = await res.json();
  if (data.status === 1) return { token: data.request };
  return { token: null, error: data.request === "CAPCHA_NOT_READY" ? null : data.request };
}
async function twocaptchaTest(apiKey: string) {
  const params = new URLSearchParams({ key: apiKey, action: "getbalance", json: "1" });
  const res = await fetch(`https://2captcha.com/res.php?${params}`);
  const data = await res.json();
  return data.status === 1;
}

// ── Unified dispatch (for personal-key mode only) ─────────────────────────────
async function providerSubmit(provider: string, apiKey: string, accessToken: string, siteKey: string, pageUrl: string, captchaType: string) {
  if (provider === "aycd")       return aycdSubmit(apiKey, accessToken, siteKey, pageUrl, captchaType);
  if (provider === "capsolver")  return capsolverSubmit(apiKey, siteKey, pageUrl, captchaType);
  if (provider === "capmonster") return capmonsterSubmit(apiKey, siteKey, pageUrl, captchaType);
  if (provider === "2captcha")   return twocaptchaSubmit(apiKey, siteKey, pageUrl, captchaType);
  throw new Error(`Unknown provider: ${provider}`);
}
async function providerPoll(provider: string, apiKey: string, accessToken: string, taskId: string) {
  if (provider === "aycd")       return aycdPoll(apiKey, accessToken, taskId);
  if (provider === "capsolver")  return capsolverPoll(apiKey, taskId);
  if (provider === "capmonster") return capmonsterPoll(apiKey, taskId);
  if (provider === "2captcha")   return twocaptchaPoll(apiKey, taskId);
  throw new Error(`Unknown provider: ${provider}`);
}
async function providerTest(provider: string, apiKey: string, accessToken: string) {
  if (provider === "aycd")       return aycdTest(apiKey, accessToken);
  if (provider === "capsolver")  return capsolverTest(apiKey);
  if (provider === "capmonster") return capmonsterTest(apiKey);
  if (provider === "2captcha")   return twocaptchaTest(apiKey);
  return false;
}

// ── Handler (personal-key only — community pool lives on YOUR server) ─────────
Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { action, taskId, siteKey, pageUrl, captchaType, provider = "aycd", personalApiKey, personalAccessToken } = body;

    if (!personalApiKey) return Response.json({ error: "No personal API key provided. Community pool is handled by your external server." }, { status: 400 });

    if (action === "test") {
      const ok = await providerTest(provider, personalApiKey, personalAccessToken ?? "");
      return Response.json({ ok });
    }
    if (action === "submit") {
      if (!siteKey || !pageUrl || !captchaType) return Response.json({ error: "Missing siteKey, pageUrl, or captchaType" }, { status: 400 });
      const result = await providerSubmit(provider, personalApiKey, personalAccessToken ?? "", siteKey, pageUrl, captchaType);
      return Response.json(result);
    }
    if (action === "poll") {
      if (!taskId) return Response.json({ error: "Missing taskId" }, { status: 400 });
      const result = await providerPoll(provider, personalApiKey, personalAccessToken ?? "", taskId);
      return Response.json(result);
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
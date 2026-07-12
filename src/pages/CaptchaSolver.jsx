import { useState, useEffect } from "react";
import {
  ShieldCheck, Key, Wifi, Send, Copy, CheckCheck,
  Loader2, ExternalLink, RefreshCw, Gauge, Users, User, AlertTriangle
} from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";

const CAPTCHA_TYPES = [
  { value: "recaptchav2", label: "reCAPTCHA v2" },
  { value: "recaptchav3", label: "reCAPTCHA v3" },
  { value: "hcaptcha",    label: "hCaptcha" },
];

const PROVIDERS = [
  { value: "aycd",       label: "AYCD AutoSolve",  url: "https://aycd.io/account#autosolve",         hasAccessToken: true  },
  { value: "capsolver",  label: "CapSolver",        url: "https://dashboard.capsolver.com/",          hasAccessToken: false },
  { value: "capmonster", label: "CapMonster",       url: "https://capmonster.cloud/Account/Settings", hasAccessToken: false },
  { value: "2captcha",   label: "2Captcha",         url: "https://2captcha.com/setting",              hasAccessToken: false },
];

const POLL_TIERS = [
  { value: "low",    label: "Low · 1–10 instances",   ms: 800,  color: "text-sky-400",    border: "border-sky-500/30",    bg: "bg-sky-500/10" },
  { value: "medium", label: "Med · 10–50 instances",  ms: 1200, color: "text-violet-400", border: "border-violet-500/30", bg: "bg-violet-500/10" },
  { value: "high",   label: "High · 50–100 instances", ms: 1800, color: "text-amber-400",  border: "border-amber-500/30",  bg: "bg-amber-500/10" },
];

// ── Master Key Endpoint ───────────────────────────────────────────────────────
// Replace this URL with your own hosted endpoint when ready.
// It receives JSON POST requests and must respond with the same shape as before.
const MASTER_KEY_ENDPOINT = "https://your-endpoint-here.com/captcha";

async function callProxy(payload) {
  try {
    const res = await fetch(MASTER_KEY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: err.error || `Server error ${res.status}` };
    }
    return res.json();
  } catch (e) {
    return { error: "Endpoint unreachable — configure MASTER_KEY_ENDPOINT" };
  }
}

// ── Community Pool Status ─────────────────────────────────────────────────────
function CommunityStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    setLoading(true);
    const res = await callProxy({ action: "status", mode: "community" });
    setStatus(res);
    setLoading(false);
  };

  useEffect(() => { fetchStatus(); }, []);

  if (loading) return (
    <div className="flex items-center gap-2 py-3 text-gray-600 font-mono text-xs">
      <Loader2 className="w-3 h-3 animate-spin" /> Checking community pool…
    </div>
  );

  if (status?.error || !status?.pool_active) return (
    <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-sm">
      <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
      <div className="font-mono text-[10px] text-red-400">
        Community pool is currently unavailable or at monthly capacity. Switch to Personal Key.
      </div>
    </div>
  );

  const poolPct = Math.round((status.solves_used / status.monthly_budget) * 100);
  const poolBarColor = poolPct > 80 ? "bg-red-500" : poolPct > 50 ? "bg-amber-500" : "bg-emerald-500";

  const userUsed = status.user_used ?? 0;
  const userLimit = status.user_limit ?? 100;
  const userPct = Math.min(100, Math.round((userUsed / userLimit) * 100));
  const userBarColor = userPct >= 100 ? "bg-red-500" : userPct > 70 ? "bg-amber-500" : "bg-violet-500";

  return (
    <div className="space-y-3">
      {/* Pool-wide usage */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between font-mono text-[10px]">
          <span className="text-gray-500">Pool usage (shared)</span>
          <span className="text-gray-300">{status.solves_used.toLocaleString()} / {status.monthly_budget.toLocaleString()}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${poolBarColor}`} style={{ width: `${poolPct}%` }} />
        </div>
      </div>

      {/* Per-user quota */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between font-mono text-[10px]">
          <span className="text-gray-500">Your quota this month</span>
          <span className={userPct >= 100 ? "text-red-400" : "text-gray-300"}>{userUsed} / {userLimit} solves</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${userBarColor}`} style={{ width: `${userPct}%` }} />
        </div>
        {userPct >= 100 && (
          <p className="text-[10px] font-mono text-red-400">⚠ Monthly limit reached — switch to Personal Key</p>
        )}
      </div>

      <div className="flex items-center justify-between font-mono text-[10px] text-gray-600 pt-1">
        <span className="text-emerald-500">● Pool Active</span>
        <button onClick={fetchStatus} className="text-gray-600 hover:text-gray-400 flex items-center gap-1">
          <RefreshCw className="w-2.5 h-2.5" /> Refresh
        </button>
      </div>
    </div>
  );
}

// ── Personal Key Panel ────────────────────────────────────────────────────────
function PersonalKeyPanel({ config, onSaved }) {
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const provider = config?.provider || "aycd";
  const providerMeta = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];

  const setProvider = async (val) => {
    if (config?.id) {
      await db.CaptchaConfig.update(config.id, { provider: val, personal_is_connected: false });
    } else {
      await db.CaptchaConfig.create({ mode: "personal", provider: val, poll_tier: "medium" });
    }
    await onSaved();
  };

  const save = async () => {
    if (!apiKey) return;
    setSaving(true);
    let connected = false;
    try {
      const res = await callProxy({ action: "test", mode: "personal", provider, personalApiKey: apiKey, personalAccessToken: accessToken });
      connected = !!res?.ok;
      if (connected) toast.success(`✅ ${providerMeta.label} key valid`);
      else toast.error(`❌ ${providerMeta.label} rejected the key — saved anyway`);
    } catch { toast.error("❌ Could not reach provider API"); }

    const patch = { personal_api_key: apiKey, personal_is_connected: connected, provider };
    if (accessToken) patch.personal_access_token = accessToken;

    if (config?.id) {
      await db.CaptchaConfig.update(config.id, patch);
    } else {
      await db.CaptchaConfig.create({ mode: "personal", poll_tier: "medium", ...patch });
    }
    setSaving(false);
    await onSaved();
  };

  const testExisting = async () => {
    if (!config?.personal_api_key) return;
    setTesting(true);
    const res = await callProxy({ action: "test", mode: "personal", provider, personalApiKey: config.personal_api_key, personalAccessToken: config.personal_access_token ?? "" });
    const connected = !!res?.ok;
    await db.CaptchaConfig.update(config.id, { personal_is_connected: connected });
    if (connected) toast.success(`✅ ${providerMeta.label} key valid`); else toast.error(`❌ ${providerMeta.label} rejected the key`);
    setTesting(false);
    onSaved();
  };

  return (
    <div className="space-y-3">
      {/* Provider selector */}
      <div>
        <Label className="text-xs text-gray-400 font-mono">Provider</Label>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          {PROVIDERS.map((p) => (
            <button key={p.value} onClick={() => setProvider(p.value)}
              className={`px-3 py-2 rounded-sm border font-mono text-xs text-left transition-all ${provider === p.value ? "border-violet-500/40 bg-violet-500/10 text-violet-300" : "border-white/5 bg-white/[0.02] text-gray-500 hover:border-white/10 hover:text-gray-300"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {config?.personal_is_connected && (
        <div className="px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-sm">
          <p className="text-[10px] font-mono text-emerald-400">🔒 Key stored for {providerMeta.label}. Enter a new value to replace.</p>
        </div>
      )}

      <div>
        <Label className="text-xs text-gray-400 font-mono">API Key</Label>
        <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder={config?.personal_api_key ? "••••••••••••• (saved)" : `From ${providerMeta.label}`}
          className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
      </div>

      {providerMeta.hasAccessToken && (
        <div>
          <Label className="text-xs text-gray-400 font-mono">Access Token <span className="text-gray-600">(AYCD only)</span></Label>
          <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)}
            placeholder={config?.personal_access_token ? "••••••••••••• (saved)" : "From AYCD AutoSolve Dashboard"}
            className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
        </div>
      )}

      <div className="flex gap-2">
        {config?.personal_api_key && (
          <Button onClick={testExisting} disabled={testing} variant="outline" className="border-white/10 text-gray-400 hover:text-gray-200 font-mono text-xs gap-1.5">
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
            Test
          </Button>
        )}
        <Button onClick={save} disabled={saving || !apiKey} className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs gap-1.5 flex-1">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
          Save Key
        </Button>
      </div>
      <a href={providerMeta.url} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-[10px] font-mono text-blue-400 hover:text-blue-300">
        <ExternalLink className="w-3 h-3" /> Get your API key from {providerMeta.label}
      </a>
    </div>
  );
}

// ── Poll Tier Selector ────────────────────────────────────────────────────────
function PollTierPanel({ config, onSaved }) {
  const [saving, setSaving] = useState(false);
  const current = config?.poll_tier || "medium";

  const select = async (tier) => {
    if (!config?.id || tier === current || saving) return;
    setSaving(true);
    await db.CaptchaConfig.update(config.id, { poll_tier: tier });
    setSaving(false);
    onSaved();
    toast.success(`Poll tier → ${tier}`);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="w-3.5 h-3.5 text-gray-400" />
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Captcha Poll Speed</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {POLL_TIERS.map((t) => {
          const active = current === t.value;
          return (
            <button key={t.value} onClick={() => select(t.value)} disabled={saving || !config?.id}
              className={`text-left p-3 rounded-sm border transition-all font-mono ${!config?.id ? "opacity-40 cursor-not-allowed border-white/5 text-gray-700" : active ? `${t.bg} ${t.border} ${t.color}` : "border-white/5 bg-white/[0.02] text-gray-600 hover:border-white/10 hover:text-gray-400"}`}>
              <div className="text-[11px] font-semibold">{t.value.toUpperCase()}</div>
              <div className="text-[9px] mt-1 opacity-80">{t.ms}ms poll</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Solver Test Panel ─────────────────────────────────────────────────────────
function SolverPanel({ config }) {
  const [siteKey, setSiteKey] = useState("");
  const [pageUrl, setPageUrl] = useState("https://");
  const [captchaType, setCaptchaType] = useState("recaptchav2");
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [taskId, setTaskId] = useState(null);
  const [solvedToken, setSolvedToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const mode = config?.mode || "community";
  const provider = config?.provider || "aycd";
  const canSubmit = mode === "community" || (mode === "personal" && config?.personal_api_key);

  const submit = async () => {
    if (!siteKey || !pageUrl || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    setSolvedToken(null);
    setTaskId(null);

    const payload = { action: "submit", mode, provider, captchaType, siteKey, pageUrl };
    if (mode === "personal") {
      payload.personalApiKey = config.personal_api_key;
      payload.personalAccessToken = config.personal_access_token ?? "";
    }

    const data = await callProxy(payload);
    if (data?.error) {
      setError(data.error);
      if (data.pool_empty) toast.error("Community pool is full — switch to Personal Key");
      if (data.user_limit_reached) toast.error("Monthly limit of 100 solves reached — switch to Personal Key");
      setSubmitting(false);
      return;
    }
    const id = data?.taskId || data?.task_id || data?.id;
    setTaskId(id);
    toast.success("Task submitted — polling for solution…");
    setSubmitting(false);
    setPolling(true);
  };

  useEffect(() => {
    if (!polling || !taskId) return;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 60) {
        clearInterval(interval);
        setPolling(false);
        setError("Timed out waiting for solution");
        return;
      }
      const payload = { action: "poll", mode, provider, taskId };
      if (mode === "personal") {
        payload.personalApiKey = config.personal_api_key;
        payload.personalAccessToken = config.personal_access_token ?? "";
      }
      const data = await callProxy(payload);
      if (data?.token || data?.solution) {
        clearInterval(interval);
        setPolling(false);
        setSolvedToken(data.token || data.solution);
        toast.success("✅ Captcha solved!");
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [polling, taskId, config]);

  const copy = () => {
    navigator.clipboard.writeText(solvedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!canSubmit) return (
    <div className="text-center py-8 border border-dashed border-white/5 rounded-sm">
      <Key className="w-7 h-7 text-gray-700 mx-auto mb-2" />
      <p className="text-sm text-gray-500 font-mono">Add your personal AYCD key above to enable solving</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-gray-400 font-mono">Captcha Type</Label>
        <Select value={captchaType} onValueChange={setCaptchaType}>
          <SelectTrigger className="bg-white/5 border-white/10 font-mono text-sm mt-1 h-9"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#1a1a24] border-white/10">
            {CAPTCHA_TYPES.map((t) => <SelectItem key={t.value} value={t.value} className="font-mono text-xs text-gray-100">{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-gray-400 font-mono">Site Key</Label>
        <Input value={siteKey} onChange={(e) => setSiteKey(e.target.value)} placeholder="6LcXXXXXXXXXXXXXXXXXXXXXXXXXXXX" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
      </div>
      <div>
        <Label className="text-xs text-gray-400 font-mono">Page URL</Label>
        <Input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://example.com/checkout" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
      </div>
      <Button onClick={submit} disabled={submitting || polling || !siteKey || !pageUrl}
        className="w-full bg-violet-600 hover:bg-violet-700 font-mono text-xs gap-2">
        {submitting || polling
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{submitting ? "Submitting…" : "Solving…"}</>
          : <><Send className="w-3.5 h-3.5" />Submit Captcha Task</>}
      </Button>

      {polling && (
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-sm">
          <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin flex-shrink-0" />
          <p className="text-[10px] font-mono text-yellow-400">Waiting for AYCD… task: {taskId}</p>
        </div>
      )}

      {solvedToken && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">Solved Token</p>
          <div className="relative">
            <div className="px-3 py-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-sm font-mono text-[10px] text-gray-300 break-all leading-relaxed max-h-28 overflow-y-auto pr-10">
              {solvedToken}
            </div>
            <button onClick={copy} className="absolute top-2 right-2 p-1 text-gray-500 hover:text-emerald-400">
              {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <Button onClick={() => { setSolvedToken(null); setTaskId(null); }} variant="outline" className="w-full border-white/10 text-gray-500 font-mono text-xs gap-1.5 h-8">
            <RefreshCw className="w-3 h-3" /> Solve Another
          </Button>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-sm">
          <p className="text-[10px] font-mono text-red-400">⚠ {error}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CaptchaSolver() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentMode, setCurrentMode] = useState("community");

  const load = async () => {
    try {
      const configs = await db.CaptchaConfig.list();
      const c = (Array.isArray(configs) ? configs : [])[0] || null;
      setConfig(c);
      if (c?.mode) setCurrentMode(c.mode);
    } catch (_) {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setMode = async (mode) => {
    setCurrentMode(mode); // immediate UI response
    if (config?.id) {
      await db.CaptchaConfig.update(config.id, { mode });
    } else {
      await db.CaptchaConfig.create({ mode, poll_tier: "medium" });
    }
    await load();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="font-mono text-lg font-semibold text-gray-100 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-violet-400" /> Captcha Solver
        </h1>
        <p className="text-xs text-gray-500 font-mono mt-1">Powered by AYCD AutoSolve · dual-mode</p>
      </div>

      {/* Mode Switcher */}
      <div className="relative p-4 rounded-sm border border-white/5 bg-[#08080f]">
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-violet-500/20" />
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3">Solver Mode</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMode("community")}
            className={`flex items-start gap-3 p-3 rounded-sm border font-mono text-left transition-all ${currentMode === "community" ? "border-violet-500/40 bg-violet-500/10 text-violet-300" : "border-white/5 bg-white/[0.02] text-gray-600 hover:border-white/10"}`}>
            <Users className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-xs font-semibold">Community Pool</div>
              <div className="text-[9px] opacity-70 mt-0.5">Free · shared credits · monthly budget</div>
            </div>
          </button>
          <button onClick={() => setMode("personal")}
            className={`flex items-start gap-3 p-3 rounded-sm border font-mono text-left transition-all ${currentMode === "personal" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/5 bg-white/[0.02] text-gray-600 hover:border-white/10"}`}>
            <User className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-xs font-semibold">Personal Key</div>
              <div className="text-[9px] opacity-70 mt-0.5">Your AYCD key · always available</div>
            </div>
          </button>
        </div>
      </div>

      {/* Community Pool Status */}
      {currentMode === "community" && (
        <div className="relative p-4 rounded-sm border border-white/5 bg-[#08080f]">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-violet-500/20" />
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3">Community Pool Status</p>
          <CommunityStatus />
        </div>
      )}

      {/* Personal Key Config */}
      {currentMode === "personal" && (
        <div className="relative p-4 rounded-sm border border-white/5 bg-[#08080f]">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-emerald-500/20" />
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3">Personal AYCD Credentials</p>
          <PersonalKeyPanel config={config} onSaved={load} />
        </div>
      )}

      {/* Poll Tier */}
      <div className="relative p-4 rounded-sm border border-white/5 bg-[#08080f]">
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-violet-500/20" />
        <PollTierPanel config={config} onSaved={load} />
      </div>

      {/* Solver */}
      <div className="relative p-4 rounded-sm border border-white/5 bg-[#08080f]">
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-violet-500/20" />
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-4">Submit Captcha Task</p>
        <SolverPanel config={config} />
      </div>
    </div>
  );
}
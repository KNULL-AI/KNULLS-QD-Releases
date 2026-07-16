import { useState, useEffect } from "react";
import {
  ShieldCheck, Key, Wifi, CheckCheck,
  Loader2, ExternalLink, RefreshCw, Gauge, Users, User, AlertTriangle
} from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";

const TEST_DIFFICULTIES = [
  { value: "easy", label: "Easy", noise: 8, targetCount: [2, 3] },
  { value: "medium", label: "Medium", noise: 16, targetCount: [2, 4] },
  { value: "hard", label: "Hard", noise: 24, targetCount: [3, 5] },
];

const TEST_TARGETS = ["bicycle", "bus", "traffic light", "crosswalk"];

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
  } catch {
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
function SolverPanel() {
  const DATASET_KEY = "knull-test-captcha-dataset-v1";
  const [difficulty, setDifficulty] = useState("medium");
  const [challenge, setChallenge] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [result, setResult] = useState(null);
  const [stats, setStats] = useState({ attempts: 0, correct: 0 });
  const [dataset, setDataset] = useState([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DATASET_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setDataset(parsed);
    } catch {
      setDataset([]);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DATASET_KEY, JSON.stringify(dataset));
    } catch {
      // Ignore storage write failures (quota/private mode)
    }
  }, [dataset]);

  const drawIcon = (ctx, type) => {
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#f8fafc";
    ctx.fillStyle = "#f8fafc";
    if (type === "bicycle") {
      ctx.beginPath(); ctx.arc(28, 70, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(68, 70, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(28, 70); ctx.lineTo(43, 50); ctx.lineTo(58, 70); ctx.lineTo(43, 70); ctx.lineTo(33, 56); ctx.stroke();
    } else if (type === "bus") {
      ctx.strokeRect(18, 34, 60, 34);
      for (let i = 0; i < 4; i++) ctx.strokeRect(24 + i * 13, 40, 10, 10);
      ctx.beginPath(); ctx.arc(30, 72, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(66, 72, 7, 0, Math.PI * 2); ctx.fill();
    } else if (type === "traffic light") {
      ctx.strokeRect(40, 18, 16, 56);
      [30, 46, 62].forEach((y) => { ctx.beginPath(); ctx.arc(48, y, 5, 0, Math.PI * 2); ctx.stroke(); });
    } else if (type === "crosswalk") {
      for (let i = 0; i < 6; i++) ctx.fillRect(16 + i * 12, 28 + (i % 2 ? 2 : 0), 8, 40);
    }
  };

  const makeTile = (type, noise) => {
    const c = document.createElement("canvas");
    c.width = 96; c.height = 96;
    const ctx = c.getContext("2d");
    const hue = Math.floor(Math.random() * 360);
    ctx.fillStyle = `hsl(${hue} 25% 22%)`;
    ctx.fillRect(0, 0, 96, 96);
    for (let i = 0; i < noise; i++) {
      ctx.fillStyle = `hsla(${Math.floor(Math.random() * 360)} 80% 70% / 0.18)`;
      ctx.fillRect(Math.random() * 96, Math.random() * 96, Math.random() * 8 + 1, Math.random() * 8 + 1);
    }
    drawIcon(ctx, type);
    return c.toDataURL("image/png");
  };

  const generateChallenge = () => {
    const cfg = TEST_DIFFICULTIES.find((d) => d.value === difficulty) || TEST_DIFFICULTIES[1];
    const target = TEST_TARGETS[Math.floor(Math.random() * TEST_TARGETS.length)];
    const targetCount = cfg.targetCount[0] + Math.floor(Math.random() * (cfg.targetCount[1] - cfg.targetCount[0] + 1));
    const targetPositions = new Set();
    while (targetPositions.size < targetCount) targetPositions.add(Math.floor(Math.random() * 9));

    const tiles = Array.from({ length: 9 }, (_, idx) => {
      const isTarget = targetPositions.has(idx);
      const decoyOptions = TEST_TARGETS.filter((t) => t !== target);
      const tileType = isTarget ? target : decoyOptions[Math.floor(Math.random() * decoyOptions.length)];
      return {
        id: idx,
        isTarget,
        type: tileType,
        image: makeTile(tileType, cfg.noise),
      };
    });

    setChallenge({ target, tiles, answers: targetPositions, difficulty: cfg.value });
    setSelected(new Set());
    setResult(null);
  };

  const toggle = (id) => {
    if (result) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitTest = () => {
    if (!challenge) return;
    const expected = [...challenge.answers].sort((a, b) => a - b).join(",");
    const got = [...selected].sort((a, b) => a - b).join(",");
    const ok = expected === got;
    setResult({ ok, expected: challenge.answers, got: selected });
    setStats((s) => ({ attempts: s.attempts + 1, correct: s.correct + (ok ? 1 : 0) }));
    const selectedIds = [...selected].sort((a, b) => a - b);
    const answerIds = [...challenge.answers].sort((a, b) => a - b);
    const rec = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      difficulty: challenge.difficulty,
      target: challenge.target,
      selected_ids: selectedIds,
      answer_ids: answerIds,
      correct: ok,
      tiles: challenge.tiles.map((t) => ({ id: t.id, type: t.type, is_target: t.isTarget })),
    };
    setDataset((prev) => [rec, ...prev].slice(0, 5000));
    if (ok) toast.success("Test captcha solved correctly");
    else toast.error("Incorrect selection — review misses/highlights");
  };

  const downloadText = (filename, text, type = "text/plain") => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJsonl = () => {
    if (!dataset.length) return;
    const jsonl = dataset.map((r) => JSON.stringify(r)).join("\n");
    downloadText(`captcha-test-dataset-${new Date().toISOString().slice(0, 10)}.jsonl`, jsonl, "application/jsonl");
    toast.success(`Exported ${dataset.length} records (JSONL)`);
  };

  const exportCsv = () => {
    if (!dataset.length) return;
    const esc = (v) => `"${String(v).replaceAll('"', '""')}"`;
    const header = ["id", "ts", "difficulty", "target", "correct", "selected_ids", "answer_ids", "tile_types"].join(",");
    const lines = dataset.map((r) => {
      const types = (r.tiles || []).map((t) => t.type).join("|");
      return [
        esc(r.id),
        esc(r.ts),
        esc(r.difficulty),
        esc(r.target),
        esc(r.correct),
        esc((r.selected_ids || []).join("|")),
        esc((r.answer_ids || []).join("|")),
        esc(types),
      ].join(",");
    });
    downloadText(`captcha-test-dataset-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...lines].join("\n"), "text/csv");
    toast.success(`Exported ${dataset.length} records (CSV)`);
  };

  const exportHardNegativesJsonl = () => {
    const hard = dataset.filter((r) => !r.correct);
    if (!hard.length) return;
    const jsonl = hard.map((r) => JSON.stringify(r)).join("\n");
    downloadText(`captcha-test-hard-negatives-${new Date().toISOString().slice(0, 10)}.jsonl`, jsonl, "application/jsonl");
    toast.success(`Exported ${hard.length} hard negatives (JSONL)`);
  };

  const clearDataset = () => {
    setDataset([]);
    toast("Dataset cleared");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-gray-400 font-mono">Test Difficulty</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="bg-white/5 border-white/10 font-mono text-sm mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#1a1a24] border-white/10">
              {TEST_DIFFICULTIES.map((d) => <SelectItem key={d.value} value={d.value} className="font-mono text-xs text-gray-100">{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-sm border border-white/5 bg-white/[0.02] px-3 py-2 mt-6">
          <p className="text-[10px] font-mono text-gray-500">Accuracy</p>
          <p className="text-xs font-mono text-gray-300 mt-0.5">{stats.attempts ? Math.round((stats.correct / stats.attempts) * 100) : 0}% ({stats.correct}/{stats.attempts})</p>
          <p className="text-[10px] font-mono text-gray-500 mt-1">Dataset: {dataset.length} records</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Button onClick={exportJsonl} disabled={!dataset.length} variant="outline" className="border-white/10 text-gray-400 font-mono text-xs h-8">Export JSONL</Button>
        <Button onClick={exportCsv} disabled={!dataset.length} variant="outline" className="border-white/10 text-gray-400 font-mono text-xs h-8">Export CSV</Button>
        <Button onClick={exportHardNegativesJsonl} disabled={!dataset.some((r) => !r.correct)} variant="outline" className="border-amber-500/20 text-amber-400 font-mono text-xs h-8">Hard Negatives</Button>
        <Button onClick={clearDataset} disabled={!dataset.length} variant="outline" className="border-red-500/20 text-red-400 font-mono text-xs h-8">Clear</Button>
      </div>

      <Button onClick={generateChallenge} className="w-full bg-violet-600 hover:bg-violet-700 font-mono text-xs gap-2">
        <RefreshCw className="w-3.5 h-3.5" /> Generate Test Captcha
      </Button>

      {!challenge && (
        <div className="text-center py-8 border border-dashed border-white/5 rounded-sm">
          <Key className="w-7 h-7 text-gray-700 mx-auto mb-2" />
          <p className="text-sm text-gray-500 font-mono">Generate a challenge to begin internal image captcha testing</p>
        </div>
      )}

      {challenge && (
        <>
          <div className="px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-sm">
            <p className="text-[10px] font-mono text-blue-300">Select all images with <span className="text-blue-100 font-semibold">{challenge.target}</span></p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {challenge.tiles.map((tile) => {
              const isSelected = selected.has(tile.id);
              const isMissed = result && tile.isTarget && !isSelected;
              const isWrong = result && !tile.isTarget && isSelected;
              return (
                <button key={tile.id} onClick={() => toggle(tile.id)}
                  className={`relative rounded-sm overflow-hidden border transition-all ${isMissed ? "border-yellow-400" : isWrong ? "border-red-500" : isSelected ? "border-violet-400" : "border-white/10 hover:border-white/20"}`}>
                  <img src={tile.image} alt={`captcha tile ${tile.id}`} className="w-full h-24 object-cover" />
                  {isSelected && <div className="absolute inset-0 ring-2 ring-violet-400/70 pointer-events-none" />}
                  {result && tile.isTarget && <div className="absolute top-1 left-1 text-[9px] font-mono px-1 rounded bg-emerald-500/80 text-white">target</div>}
                </button>
              );
            })}
          </div>

          <Button onClick={submitTest} disabled={!!result} className="w-full bg-emerald-600 hover:bg-emerald-700 font-mono text-xs gap-2">
            <CheckCheck className="w-3.5 h-3.5" /> Test Captcha
          </Button>

          {result && (
            <div className={`px-3 py-2 rounded-sm border ${result.ok ? "bg-emerald-500/10 border-emerald-500/20" : "bg-red-500/10 border-red-500/20"}`}>
              <p className={`text-[10px] font-mono ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
                {result.ok ? "PASS — selection matched target tiles" : "FAIL — incorrect tile selection"}
              </p>
            </div>
          )}
        </>
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
    } catch {
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
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-4">Test Captcha</p>
        <SolverPanel config={config} />
      </div>
    </div>
  );
}
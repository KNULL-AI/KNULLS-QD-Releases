import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Box,
  Check,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { db } from "@/lib/db";
import { focusBrowser, injectCaptchaToken, offCaptchaEvent, onCaptchaEvent } from "@/lib/electronBridge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SERVER_SOLVER_ENDPOINT = import.meta.env.VITE_CAPTCHA_SERVER_ENDPOINT || "https://your-endpoint-here.com/captcha";
const PERF_METRICS_STORAGE_KEY = "knull_perf_metrics";
const PERF_PANEL_STORAGE_KEY = "knull_perf_panel";

const HARVESTER_TYPES = [
  { value: "pokemon_center", label: "PokemonCenter" },
  { value: "costco", label: "Costco" },
];

const SOLVER_PROVIDERS = [
  {
    value: "aycd",
    label: "AYCD",
    hasAccessToken: true,
    defaultEndpoint: "https://api.aycd.io/autosolve/v2",
    keyLabel: "API Key",
    keyPlaceholder: "Enter AYCD API key",
    endpointPlaceholder: "https://api.aycd.io/autosolve/v2",
  },
  {
    value: "capsolver",
    label: "CapSolver",
    hasAccessToken: false,
    defaultEndpoint: "https://api.capsolver.com",
    keyLabel: "Client Key",
    keyPlaceholder: "Enter CapSolver client key",
    endpointPlaceholder: "https://api.capsolver.com",
  },
  {
    value: "2captcha",
    label: "2Captcha",
    hasAccessToken: false,
    defaultEndpoint: "https://2captcha.com",
    keyLabel: "API Key",
    keyPlaceholder: "Enter 2Captcha API key",
    endpointPlaceholder: "https://2captcha.com",
  },
  {
    value: "capmonster",
    label: "CapMonster",
    hasAccessToken: false,
    defaultEndpoint: "https://api.capmonster.cloud",
    keyLabel: "Client Key",
    keyPlaceholder: "Enter CapMonster client key",
    endpointPlaceholder: "https://api.capmonster.cloud",
  },
  {
    value: "custom",
    label: "Custom Endpoint",
    hasAccessToken: false,
    defaultEndpoint: "",
    keyLabel: "API Key",
    keyPlaceholder: "Enter custom solver API key",
    endpointPlaceholder: "https://your-solver-endpoint.com/solve",
  },
];

const EMPTY_FORM = {
  name: "",
  harvester_type: "pokemon_center",
  current_proxy: "",
  open_on_demand: true,
  solver_mode: "server",
  provider: "capsolver",
  personal_solver_endpoint: "",
  personal_api_key: "",
  personal_access_token: "",
  google_logged_in: false,
  use_autosolve: true,
  is_open: false,
};

async function callSolverServer(payload, endpoint = SERVER_SOLVER_ENDPOINT) {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error || `Server error ${res.status}` };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, ...json };
  } catch {
    return { ok: false, error: "Solver endpoint unreachable" };
  }
}

function normalizeHarvester(row, idx) {
  const rawType = String(row?.harvester_type || row?.retailer || "pokemon_center");
  const allowedTypes = new Set(HARVESTER_TYPES.map((t) => t.value));
  const normalizedType = allowedTypes.has(rawType) ? rawType : "pokemon_center";

  return {
    ...EMPTY_FORM,
    ...row,
    id: row?.id || `temp-${idx}`,
    name: String(row?.name || row?.harvester_name || `t${idx + 1}`),
    harvester_type: normalizedType,
    open_on_demand: row?.open_on_demand !== false,
    solver_mode: String(row?.solver_mode || (row?.mode === "personal" ? "personal" : "server")),
    provider: String(row?.provider || "capsolver"),
    personal_solver_endpoint: String(row?.personal_solver_endpoint || ""),
    personal_api_key: String(row?.personal_api_key || ""),
    personal_access_token: String(row?.personal_access_token || ""),
    google_logged_in: !!row?.google_logged_in,
    use_autosolve: row?.use_autosolve !== false,
    is_open: !!row?.is_open,
    entity: "harvester",
  };
}

function getProviderMeta(provider) {
  return SOLVER_PROVIDERS.find((p) => p.value === provider) || SOLVER_PROVIDERS[0];
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function HarvesterDialog({ open, onOpenChange, initial, onSave, saving }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [testingProvider, setTestingProvider] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_FORM, ...(initial || {}) });
    setProviderTestResult(null);
    setTestingProvider(false);
  }, [open, initial]);

  const providerMeta = getProviderMeta(form.provider);
  const personalReady = form.solver_mode !== "personal"
    || (form.personal_api_key.trim().length > 0
      && (!providerMeta.hasAccessToken || form.personal_access_token.trim().length > 0)
      && (form.provider !== "custom" || form.personal_solver_endpoint.trim().length > 0));
  const canSubmit = form.name.trim().length > 0 && personalReady;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const setProvider = (provider) => {
    const nextMeta = getProviderMeta(provider);
    setForm((prev) => ({
      ...prev,
      provider,
      // Provider switch should immediately follow that provider's endpoint preset.
      personal_solver_endpoint: nextMeta.defaultEndpoint || "",
      personal_access_token: nextMeta.hasAccessToken ? prev.personal_access_token : "",
    }));
  };

  const applyProviderEndpointPreset = () => {
    if (!providerMeta.defaultEndpoint) return;
    set("personal_solver_endpoint", providerMeta.defaultEndpoint);
  };

  const submit = async () => {
    if (!canSubmit || saving) return;
    await onSave({ ...form, name: form.name.trim() });
  };

  const getResolvedPersonalEndpoint = () => {
    return form.personal_solver_endpoint || providerMeta.defaultEndpoint || SERVER_SOLVER_ENDPOINT;
  };

  const testProvider = async () => {
    if (testingProvider) return;

    if (!form.personal_api_key.trim()) {
      setProviderTestResult({ ok: false, message: `${providerMeta.keyLabel} is required before testing.` });
      return;
    }
    if (providerMeta.hasAccessToken && !form.personal_access_token.trim()) {
      setProviderTestResult({ ok: false, message: `Access Token is required for ${providerMeta.label}.` });
      return;
    }
    if (form.provider === "custom" && !form.personal_solver_endpoint.trim()) {
      setProviderTestResult({ ok: false, message: "Custom endpoint is required before testing." });
      return;
    }

    setTestingProvider(true);
    setProviderTestResult(null);

    const endpoint = getResolvedPersonalEndpoint();
    const result = await callSolverServer({
      action: "test",
      mode: "personal",
      provider: form.provider,
      personalApiKey: form.personal_api_key,
      personalAccessToken: form.personal_access_token,
    }, endpoint);

    if (result?.ok) {
      setProviderTestResult({ ok: true, message: `${providerMeta.label} credentials are valid and ready.` });
      toast.success(`${providerMeta.label} test passed`);
    } else {
      const message = result?.error || "Provider test failed";
      setProviderTestResult({ ok: false, message });
      toast.error(`${providerMeta.label} test failed`);
    }

    setTestingProvider(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d16] border-white/10 text-gray-100 max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm text-blue-300">
            {initial?.id ? "Edit Harvester" : "New Harvester"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label className="text-xs text-gray-400 font-mono">Harvester Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. t9"
              className="bg-white/5 border-white/10 font-mono text-sm mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-400 font-mono">Type</Label>
              <Select value={form.harvester_type} onValueChange={(v) => set("harvester_type", v)}>
                <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a24] border-white/10 text-gray-100">
                  {HARVESTER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="font-mono text-xs text-gray-100">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-gray-400 font-mono">Current Proxy</Label>
              <Input
                value={form.current_proxy}
                onChange={(e) => set("current_proxy", e.target.value)}
                placeholder="localhost"
                className="bg-white/5 border-white/10 font-mono text-sm mt-1"
              />
            </div>
          </div>

          <div className="rounded-sm border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Solver Option</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => set("solver_mode", "server")}
                className={`px-3 py-2 rounded-sm border text-left font-mono text-xs transition-all ${form.solver_mode === "server" ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
              >
                Server
                <div className="text-[9px] opacity-70 mt-0.5">Use client hosted solver pool</div>
              </button>
              <button
                onClick={() => set("solver_mode", "personal")}
                className={`px-3 py-2 rounded-sm border text-left font-mono text-xs transition-all ${form.solver_mode === "personal" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
              >
                Personal API Key
                <div className="text-[9px] opacity-70 mt-0.5">Use your own solver credentials</div>
              </button>
            </div>
          </div>

          {form.solver_mode === "personal" && (
            <div className="space-y-3 rounded-sm border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div>
                <Label className="text-xs text-gray-300 font-mono">Provider</Label>
                <Select value={form.provider} onValueChange={setProvider}>
                  <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a24] border-white/10 text-gray-100">
                    {SOLVER_PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value} className="font-mono text-xs text-gray-100">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] font-mono text-gray-500">
                  Provider preset fills endpoint and required credentials automatically.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-gray-300 font-mono">Personal Solver Endpoint</Label>
                  <button
                    type="button"
                    onClick={applyProviderEndpointPreset}
                    className="text-[10px] font-mono text-blue-300 hover:text-blue-200"
                  >
                    Use Preset
                  </button>
                </div>
                <Input
                  value={form.personal_solver_endpoint}
                  onChange={(e) => set("personal_solver_endpoint", e.target.value)}
                  placeholder={providerMeta.endpointPlaceholder}
                  className="bg-white/5 border-white/10 font-mono text-sm mt-1"
                />
              </div>

              <div>
                <Label className="text-xs text-gray-300 font-mono">{providerMeta.keyLabel}</Label>
                <Input
                  type="password"
                  value={form.personal_api_key}
                  onChange={(e) => set("personal_api_key", e.target.value)}
                  placeholder={providerMeta.keyPlaceholder}
                  className="bg-white/5 border-white/10 font-mono text-sm mt-1"
                />
              </div>

              {providerMeta.hasAccessToken && (
                <div>
                  <Label className="text-xs text-gray-300 font-mono">Access Token</Label>
                  <Input
                    type="password"
                    value={form.personal_access_token}
                    onChange={(e) => set("personal_access_token", e.target.value)}
                    placeholder="Access token"
                    className="bg-white/5 border-white/10 font-mono text-sm mt-1"
                  />
                </div>
              )}

              {!personalReady && (
                <p className="text-[10px] font-mono text-amber-300">
                  Missing required personal credentials for this provider.
                </p>
              )}

              <div className="rounded-sm border border-white/10 bg-[#0d1222] p-3 space-y-2">
                <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Connection Test</p>
                <Button
                  type="button"
                  onClick={testProvider}
                  disabled={testingProvider}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-mono text-xs"
                >
                  {testingProvider ? "Testing Provider..." : "Test Provider"}
                </Button>
                {providerTestResult && (
                  <p className={`text-[10px] font-mono ${providerTestResult.ok ? "text-emerald-300" : "text-red-300"}`}>
                    {providerTestResult.message}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between px-2 py-2 rounded-sm border border-white/10 bg-white/[0.02]">
            <span className="text-xs font-mono text-gray-400">Open on demand</span>
            <button
              onClick={() => set("open_on_demand", !form.open_on_demand)}
              className={`w-8 h-5 rounded-full transition-colors relative ${form.open_on_demand ? "bg-blue-500" : "bg-white/20"}`}
              type="button"
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${form.open_on_demand ? "translate-x-3.5" : "translate-x-0.5"}`} />
            </button>
          </div>

          <Button
            onClick={submit}
            disabled={!canSubmit || saving}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs"
          >
            {saving ? "Saving..." : initial?.id ? "Save Changes" : "Create Harvester"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CaptchaRuntimePopup({ popup, onClose, onOpenManual, onTest, testingKind }) {
  const statusText = popup.status === "solved"
    ? "Captcha Solved"
    : popup.status === "error"
      ? "Solve Error"
      : popup.status === "solving"
        ? "Solving Captcha..."
        : "Waiting For Captcha...";

  return (
    <div className="w-[360px] rounded-xl border border-white/10 bg-[#0d0f1b] text-gray-100 shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <p className="font-mono text-sm text-gray-100">{popup.harvesterName}</p>
        <div className="flex items-center gap-2">
          <p className={`font-mono text-xs ${popup.status === "error" ? "text-red-300" : popup.status === "solved" ? "text-emerald-300" : "text-blue-300"}`}>
            {statusText}
          </p>
          <button onClick={() => onClose(popup.id)} className="text-gray-500 hover:text-gray-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-6 flex items-center justify-center">
        <Box className="w-36 h-36 text-slate-500" />
      </div>

      <div className="px-4 pb-4 space-y-3">
        <Button
          onClick={() => onOpenManual(popup)}
          className="w-full bg-slate-700 hover:bg-slate-600 text-white font-mono text-xs"
        >
          Open Manual Solve Window
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={() => onTest(popup.harvesterId, "recaptcha")}
            disabled={testingKind === "recaptcha"}
            className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs"
          >
            {testingKind === "recaptcha" ? "Testing..." : "Test reCAPTCHA"}
          </Button>
          <Button
            onClick={() => onTest(popup.harvesterId, "hcaptcha")}
            disabled={testingKind === "hcaptcha"}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs"
          >
            {testingKind === "hcaptcha" ? "Testing..." : "Test hCaptcha"}
          </Button>
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${popup.googleLoggedIn ? "bg-emerald-400" : "bg-red-400"}`} />
            Google Logged In
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${popup.useAutosolve ? "bg-emerald-400" : "bg-gray-500"}`} />
            Use Autosolve
          </span>
        </div>
      </div>
    </div>
  );
}

function HarvesterCard({ harvester, onEdit, onDelete, onOpen, onPatch, onQuickTest, testing }) {
  const solverLabel = harvester.solver_mode === "personal" ? "Personal" : "Server";
  const typeLabel = HARVESTER_TYPES.find((t) => t.value === harvester.harvester_type)?.label || "Other";
  const providerMeta = getProviderMeta(harvester.provider);
  const personalReady = harvester.solver_mode !== "personal"
    || (!!harvester.personal_api_key
      && (!providerMeta.hasAccessToken || !!harvester.personal_access_token)
      && (harvester.provider !== "custom" || !!harvester.personal_solver_endpoint));

  return (
    <div className="rounded-xl border border-blue-500/20 bg-[#0c1020] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-mono text-gray-500">Harvester Name</p>
          <p className="text-sm font-mono text-gray-100 mt-0.5">{harvester.name}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onOpen(harvester)} className="p-1.5 rounded text-blue-300 hover:bg-blue-500/10" title="Open">
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onQuickTest(harvester)} className="p-1.5 rounded text-gray-300 hover:bg-white/10" title="Quick Test">
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => onDelete(harvester)} className="p-1.5 rounded text-red-400 hover:bg-red-500/10" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-mono text-gray-500">Type</p>
        <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-mono border border-blue-500/30 bg-blue-500/15 text-blue-300">
          {typeLabel}
        </span>
      </div>

      <div className="pt-1 border-t border-white/10" />

      <div>
        <p className="text-[10px] font-mono text-gray-500">Current Proxy</p>
        <div className="mt-1 h-9 rounded-md border border-white/10 bg-white/[0.03] px-3 flex items-center justify-between">
          <span className="font-mono text-xs text-gray-100 truncate">{harvester.current_proxy || "localhost"}</span>
          <button onClick={() => onEdit(harvester)} className="text-[10px] font-mono text-blue-300 hover:text-blue-200">Edit</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onPatch(harvester.id, { solver_mode: "server" })}
          className={`h-8 rounded-md border font-mono text-[10px] transition-all ${harvester.solver_mode === "server" ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
        >
          Server
        </button>
        <button
          onClick={() => onPatch(harvester.id, { solver_mode: "personal" })}
          className={`h-8 rounded-md border font-mono text-[10px] transition-all ${harvester.solver_mode === "personal" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
        >
          Personal Key
        </button>
      </div>

      <div className="h-8 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 flex items-center justify-between">
        <span className="font-mono text-xs text-blue-300">Open on demand</span>
        <button onClick={() => onPatch(harvester.id, { open_on_demand: !harvester.open_on_demand })} className="text-blue-200">
          {harvester.open_on_demand ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-gray-500">
        <span>Solver: <span className="text-gray-300">{solverLabel}</span></span>
        {!personalReady ? (
          <span className="text-amber-400">Credentials missing</span>
        ) : (
          <span className="text-emerald-400">Ready</span>
        )}
      </div>
    </div>
  );
}

export default function CaptchaSolver() {
  const [harvesters, setHarvesters] = useState([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const [runtimePopups, setRuntimePopups] = useState([]);
  const [testingById, setTestingById] = useState({});
  const [perfPanelEnabled, setPerfPanelEnabled] = useState(false);
  const [perfRows, setPerfRows] = useState([]);
  const harvestersRef = useRef([]);
  const harvesterByIdRef = useRef(new Map());
  const onDemandHarvestersRef = useRef([]);
  const popupSeqRef = useRef(0);
  const assignmentCursorRef = useRef(0);
  const sessionHarvesterRef = useRef({});
  const solveInFlightRef = useRef(new Set());
  const manualHintedRef = useRef(new Set());
  const perfStatsRef = useRef({});
  const perfMetricsEnabledRef = useRef(false);
  const perfPanelEnabledRef = useRef(false);

  const readPerfToggles = () => {
    try {
      const metricsEnabled = window.localStorage.getItem(PERF_METRICS_STORAGE_KEY) === "1";
      const panelEnabled = window.localStorage.getItem(PERF_PANEL_STORAGE_KEY) === "1";
      perfMetricsEnabledRef.current = metricsEnabled;
      perfPanelEnabledRef.current = panelEnabled;
      setPerfPanelEnabled(panelEnabled);
    } catch {
      perfMetricsEnabledRef.current = false;
      perfPanelEnabledRef.current = false;
      setPerfPanelEnabled(false);
    }
  };

  const snapshotPerfRows = () => {
    const rows = Object.entries(perfStatsRef.current)
      .map(([key, s]) => {
        const p50 = percentile(s.totalSamples, 0.5);
        const p95 = percentile(s.totalSamples, 0.95);
        const solverP50 = percentile(s.solverSamples, 0.5);
        const solverP95 = percentile(s.solverSamples, 0.95);
        const injectP50 = percentile(s.injectSamples, 0.5);
        const injectP95 = percentile(s.injectSamples, 0.95);
        return {
          key,
          count: s.count,
          p50: Math.round(p50),
          p95: Math.round(p95),
          solverP50: Math.round(solverP50),
          solverP95: Math.round(solverP95),
          injectP50: Math.round(injectP50),
          injectP95: Math.round(injectP95),
          okRate: s.count > 0 ? Math.round((s.okCount / s.count) * 100) : 0,
          lastAt: s.lastAt || 0,
        };
      })
      .sort((a, b) => (b.lastAt - a.lastAt) || (b.count - a.count))
      .slice(0, 6);
    setPerfRows(rows);
  };

  useEffect(() => {
    readPerfToggles();
    const interval = setInterval(readPerfToggles, 1200);
    return () => clearInterval(interval);
  }, []);

  const recordSolvePerf = ({ provider, mode, type, detectToSolveMs, solverMs, injectMs, totalMs, ok }) => {
    if (!perfMetricsEnabledRef.current) return;

    const key = `${provider}:${mode}:${type}`;
    const stats = perfStatsRef.current[key] || {
      count: 0,
      okCount: 0,
      totalSamples: [],
      solverSamples: [],
      injectSamples: [],
      detectSamples: [],
      lastAt: 0,
    };

    const clamp = (arr, value) => {
      if (Number.isFinite(value)) arr.push(Math.max(0, Math.round(value)));
      if (arr.length > 80) arr.splice(0, arr.length - 80);
    };

    stats.count += 1;
    if (ok) stats.okCount += 1;
    stats.lastAt = Date.now();
    clamp(stats.totalSamples, totalMs);
    clamp(stats.solverSamples, solverMs);
    clamp(stats.injectSamples, injectMs);
    clamp(stats.detectSamples, detectToSolveMs);
    perfStatsRef.current[key] = stats;

    const p50Total = percentile(stats.totalSamples, 0.5);
    const p95Total = percentile(stats.totalSamples, 0.95);
    const p50Solver = percentile(stats.solverSamples, 0.5);
    const p95Solver = percentile(stats.solverSamples, 0.95);

    // Default-off console telemetry for tuning provider speed without UI noise.
    console.info(
      `[captcha-perf] ${key} count=${stats.count} ok=${ok ? "1" : "0"} `
      + `total=${Math.round(totalMs)}ms solver=${Math.round(solverMs)}ms inject=${Math.round(injectMs)}ms `
      + `detect=${Math.round(detectToSolveMs)}ms p50=${Math.round(p50Total)}ms p95=${Math.round(p95Total)}ms `
      + `solver_p50=${Math.round(p50Solver)}ms solver_p95=${Math.round(p95Solver)}ms`
    );

    if (perfPanelEnabledRef.current) {
      snapshotPerfRows();
    }
  };

  useEffect(() => {
    harvestersRef.current = harvesters;
    harvesterByIdRef.current = new Map(harvesters.map((h) => [h.id, h]));
    onDemandHarvestersRef.current = harvesters.filter((h) => h.open_on_demand !== false);
  }, []);

  const activeCount = useMemo(() => harvesters.filter((h) => h.is_open).length, [harvesters]);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await db.CaptchaConfig.list("-created_date", 500);
      const allRows = Array.isArray(rows) ? rows : [];
      let list = allRows
        .filter((r) => r?.entity === "harvester" || r?.name || r?.harvester_name)
        .map(normalizeHarvester);

      // Backward compatibility: migrate legacy single captcha config into one harvester.
      if (!list.length && allRows.length) {
        const legacy = allRows[0] || {};
        const migrated = normalizeHarvester({
          name: "t1",
          harvester_type: legacy.retailer || "pokemon_center",
          solver_mode: legacy.mode === "personal" ? "personal" : "server",
          provider: legacy.provider || "capsolver",
          personal_api_key: legacy.personal_api_key || legacy.personalKey || "",
          personal_access_token: legacy.personal_access_token || legacy.accessToken || "",
          personal_solver_endpoint: legacy.personal_solver_endpoint || legacy.endpoint || "",
          open_on_demand: true,
          entity: "harvester",
        }, 0);

        await db.CaptchaConfig.create(migrated);
        list = [migrated];
      }

      setHarvesters(list);
    } catch {
      setHarvesters([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveHarvester = async (payload) => {
    setSaving(true);
    const data = { ...payload, entity: "harvester" };
    if (editing?.id) {
      await db.CaptchaConfig.update(editing.id, data);
      toast.success("Harvester updated");
    } else {
      await db.CaptchaConfig.create(data);
      toast.success("Harvester created");
    }
    setSaving(false);
    setDialogOpen(false);
    setEditing(null);
    await load();
  };

  const patchHarvester = async (id, patch) => {
    const current = harvesterByIdRef.current.get(id);
    if (current) {
      const keys = Object.keys(patch || {});
      if (keys.length && keys.every((k) => current[k] === patch[k])) return;
    }

    await db.CaptchaConfig.update(id, patch);
    setHarvesters((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  };

  const deleteHarvester = async (harvester) => {
    await db.CaptchaConfig.delete(harvester.id);
    toast.success(`Deleted ${harvester.name}`);
    await load();
  };

  const setAllOpenState = async (open) => {
    await Promise.all(harvesters.map((h) => db.CaptchaConfig.update(h.id, { is_open: open })));
    setHarvesters((prev) => prev.map((h) => ({ ...h, is_open: open })));
    if (!open) setRuntimePopups([]);
  };

  const deleteAll = async () => {
    if (!harvesters.length) return;
    await Promise.all(harvesters.map((h) => db.CaptchaConfig.delete(h.id)));
    setHarvesters([]);
    setRuntimePopups([]);
    toast.success("All harvesters deleted");
  };

  const quickTestHarvester = async (harvester) => {
    setTestingById((prev) => ({ ...prev, [harvester.id]: "quick" }));

    let result = null;
    if (harvester.solver_mode === "personal") {
      const endpoint = harvester.personal_solver_endpoint || SERVER_SOLVER_ENDPOINT;
      result = await callSolverServer({
        action: "test",
        mode: "personal",
        provider: harvester.provider,
        personalApiKey: harvester.personal_api_key,
        personalAccessToken: harvester.personal_access_token,
      }, endpoint);
    } else {
      result = await callSolverServer({ action: "test", mode: "server" });
    }

    if (result?.ok) toast.success(`${harvester.name} test passed`);
    else toast.error(result?.error || `${harvester.name} test failed`);

    setTestingById((prev) => {
      const next = { ...prev };
      delete next[harvester.id];
      return next;
    });
  };

  const pushRuntimePopup = (harvester, status = "waiting", event = null) => {
    setRuntimePopups((prev) => {
      const existing = prev.find((p) => p.harvesterId === harvester.id);
      if (existing) {
        return prev.map((p) => (p.harvesterId === harvester.id ? {
          ...p,
          status,
          sessionId: String(event?.sessionId || p.sessionId || ""),
          captchaType: event?.type || p.captchaType || "",
          pageUrl: event?.pageUrl || p.pageUrl || "",
        } : p));
      }

      popupSeqRef.current += 1;
      const next = {
        id: `popup-${popupSeqRef.current}`,
        harvesterId: harvester.id,
        harvesterName: harvester.name,
        googleLoggedIn: !!harvester.google_logged_in,
        useAutosolve: harvester.use_autosolve !== false,
        status,
        sessionId: String(event?.sessionId || ""),
        captchaType: event?.type || "",
        pageUrl: event?.pageUrl || "",
        createdAt: Date.now(),
      };
      return [...prev, next];
    });
  };

  const closeRuntimePopup = (popupId) => {
    setRuntimePopups((prev) => prev.filter((p) => p.id !== popupId));
  };

  const chooseOnDemandHarvester = () => {
    const candidates = onDemandHarvestersRef.current;
    if (!candidates.length) return null;
    const idx = assignmentCursorRef.current % candidates.length;
    assignmentCursorRef.current += 1;
    return candidates[idx];
  };

  const setPopupStatusByHarvester = (harvesterId, status) => {
    setRuntimePopups((prev) => prev.map((p) => (p.harvesterId === harvesterId ? { ...p, status } : p)));
  };

  const openManualSolveWindow = async (popup) => {
    if (!popup?.sessionId) {
      toast.error("No active session is linked to this captcha popup yet");
      return;
    }

    const res = await focusBrowser(popup.sessionId);
    if (res?.ok === false) {
      toast.error(res?.error || "Could not focus session window");
      return;
    }

    toast.success(`Opened ${popup.harvesterName} for manual captcha solve`);
  };

  const isPlaceholderEndpoint = (endpoint) => String(endpoint || "").includes("your-endpoint-here.com");

  const solveDetectedCaptcha = async (event, harvester) => {
    const sessionId = String(event?.sessionId || "");
    const inFlightKey = `${sessionId}:${event?.type || "unknown"}:${event?.siteKey || ""}`;
    if (!sessionId || solveInFlightRef.current.has(inFlightKey)) return;

    const type = event?.type || "recaptchav2";
    const mode = harvester.solver_mode;
    const provider = harvester.provider;
    const solveStartMs = nowMs();
    const detectedAtMs = Date.parse(String(event?.at || ""));
    const detectToSolveMs = Number.isFinite(detectedAtMs) ? Math.max(0, Date.now() - detectedAtMs) : 0;

    const notifyManual = (message) => {
      const key = `${sessionId}:${harvester.id}`;
      if (manualHintedRef.current.has(key)) return;
      manualHintedRef.current.add(key);
      toast(message);
    };

    const providerMeta = getProviderMeta(harvester.provider);
    const endpoint = harvester.solver_mode === "personal"
      ? (harvester.personal_solver_endpoint || providerMeta.defaultEndpoint || SERVER_SOLVER_ENDPOINT)
      : SERVER_SOLVER_ENDPOINT;

    if (isPlaceholderEndpoint(endpoint)) {
      setPopupStatusByHarvester(harvester.id, "waiting");
      notifyManual(`${harvester.name}: solver endpoint not configured. Use manual solve window.`);
      return;
    }

    if (harvester.solver_mode === "personal") {
      if (!harvester.personal_api_key) {
        setPopupStatusByHarvester(harvester.id, "error");
        notifyManual(`${harvester.name}: personal API key is missing. Use manual solve window.`);
        return;
      }
      if (providerMeta.hasAccessToken && !harvester.personal_access_token) {
        setPopupStatusByHarvester(harvester.id, "error");
        notifyManual(`${harvester.name}: access token required for ${providerMeta.label}. Use manual solve window.`);
        return;
      }
      if (harvester.provider === "custom" && !harvester.personal_solver_endpoint) {
        setPopupStatusByHarvester(harvester.id, "error");
        notifyManual(`${harvester.name}: custom endpoint is required. Use manual solve window.`);
        return;
      }
    }

    solveInFlightRef.current.add(inFlightKey);
    setPopupStatusByHarvester(harvester.id, "solving");

    try {
      const solverStartMs = nowMs();
      const result = await callSolverServer({
        action: "solve",
        mode,
        provider,
        type,
        siteKey: event?.siteKey || "",
        pageUrl: event?.pageUrl || "",
        personalApiKey: harvester.personal_api_key,
        personalAccessToken: harvester.personal_access_token,
        harvesterName: harvester.name,
      }, endpoint);
      const solverMs = nowMs() - solverStartMs;

      const token = result?.token || result?.solution || "";
      if (!result?.ok || !token) {
        const errorMsg = result?.error || "Solver did not return a token";
        setPopupStatusByHarvester(harvester.id, "error");
        toast.error(`${harvester.name}: ${errorMsg}`);
        recordSolvePerf({
          provider,
          mode,
          type,
          detectToSolveMs,
          solverMs,
          injectMs: 0,
          totalMs: nowMs() - solveStartMs,
          ok: false,
        });
        return;
      }

      const injectStartMs = nowMs();
      const injectRes = await injectCaptchaToken(sessionId, type, token);
      const injectMs = nowMs() - injectStartMs;
      if (injectRes?.ok === false) {
        setPopupStatusByHarvester(harvester.id, "error");
        toast.error(`${harvester.name}: ${injectRes.error || "Token injection failed"}`);
        recordSolvePerf({
          provider,
          mode,
          type,
          detectToSolveMs,
          solverMs,
          injectMs,
          totalMs: nowMs() - solveStartMs,
          ok: false,
        });
        return;
      }

      setPopupStatusByHarvester(harvester.id, "solved");
      recordSolvePerf({
        provider,
        mode,
        type,
        detectToSolveMs,
        solverMs,
        injectMs,
        totalMs: nowMs() - solveStartMs,
        ok: true,
      });
    } catch {
      setPopupStatusByHarvester(harvester.id, "error");
      toast.error(`${harvester.name}: solver request failed`);
      recordSolvePerf({
        provider,
        mode,
        type,
        detectToSolveMs,
        solverMs: 0,
        injectMs: 0,
        totalMs: nowMs() - solveStartMs,
        ok: false,
      });
    } finally {
      solveInFlightRef.current.delete(inFlightKey);
    }
  };

  const runCaptchaTest = async (harvesterOrId, kind) => {
    const harvester = typeof harvesterOrId === "string"
      ? harvesterByIdRef.current.get(harvesterOrId)
      : harvesterOrId;

    if (!harvester) return;

    setTestingById((prev) => ({ ...prev, [harvester.id]: kind }));
    setPopupStatusByHarvester(harvester.id, "solving");

    const payload = {
      action: "captcha-test",
      kind,
      mode: harvester.solver_mode,
      provider: harvester.provider,
      personalApiKey: harvester.personal_api_key,
      personalAccessToken: harvester.personal_access_token,
      endpoint: harvester.personal_solver_endpoint || "",
      harvesterName: harvester.name,
    };

    const res = await callSolverServer(payload);
    if (res?.ok) {
      toast.success(`${harvester.name} ${kind} test queued`);
      setPopupStatusByHarvester(harvester.id, "solved");
    } else {
      toast.error(res?.error || `${kind} test failed`);
      setPopupStatusByHarvester(harvester.id, "error");
    }

    setTestingById((prev) => {
      const next = { ...prev };
      delete next[harvester.id];
      return next;
    });
  };

  const openRuntime = async (harvester) => {
    if (!harvester.is_open) {
      await patchHarvester(harvester.id, { is_open: true });
    }
    pushRuntimePopup({ ...harvester, is_open: true }, "waiting");
  };

  useEffect(() => {
    const wrapper = onCaptchaEvent(async (event) => {
      const sessionId = String(event?.sessionId || "");
      const assignedHarvesterId = sessionId ? sessionHarvesterRef.current[sessionId] : null;
      let harvester = assignedHarvesterId ? harvesterByIdRef.current.get(assignedHarvesterId) : null;

      if (!harvester) {
        harvester = chooseOnDemandHarvester();
        if (harvester && sessionId) sessionHarvesterRef.current[sessionId] = harvester.id;
      }

      if (!harvester) return;

      if (!harvester.is_open) {
        patchHarvester(harvester.id, { is_open: true }).catch(() => {});
        harvester = { ...harvester, is_open: true };
      }
      if (event?.eventType === "solved") {
        pushRuntimePopup(harvester, "solved", event);
        if (sessionId) delete sessionHarvesterRef.current[sessionId];
      } else if (event?.eventType === "error") {
        pushRuntimePopup(harvester, "error", event);
        if (sessionId) delete sessionHarvesterRef.current[sessionId];
      } else {
        pushRuntimePopup(harvester, "waiting", event);
        await solveDetectedCaptcha(event, harvester);
      }
    });

    return () => {
      offCaptchaEvent(wrapper);
    };
  }, [harvesters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-xl text-gray-100">Harvesters</h1>
          <span className="text-gray-500 font-mono text-sm">({harvesters.length})</span>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditing(null);
          }}>
            <DialogTrigger asChild>
              <button
                onClick={() => setEditing(null)}
                className="w-7 h-7 rounded bg-blue-500/80 hover:bg-blue-500 text-white flex items-center justify-center"
              >
                <Plus className="w-4 h-4" />
              </button>
            </DialogTrigger>
            <HarvesterDialog
              open={dialogOpen}
              onOpenChange={(open) => {
                setDialogOpen(open);
                if (!open) setEditing(null);
              }}
              initial={editing}
              onSave={saveHarvester}
              saving={saving}
            />
          </Dialog>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => setAllOpenState(false)} variant="outline" className="h-8 border-white/10 text-gray-300 font-mono text-xs">Close All</Button>
          <Button onClick={() => setAllOpenState(true)} className="h-8 bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs">Open All</Button>
          <Button onClick={deleteAll} className="h-8 bg-red-500 hover:bg-red-600 text-white font-mono text-xs gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Delete All
          </Button>
        </div>
      </div>

      {harvesters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#080b17] p-10 text-center">
          <Bot className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="font-mono text-sm text-gray-400">No harvesters yet</p>
          <p className="font-mono text-xs text-gray-600 mt-1">Create a harvester and choose Server or Personal API Key mode.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {harvesters.map((h) => (
              <HarvesterCard
                key={h.id}
                harvester={h}
                onEdit={(harvester) => {
                  setEditing(harvester);
                  setDialogOpen(true);
                }}
                onDelete={deleteHarvester}
                onOpen={openRuntime}
                onPatch={patchHarvester}
                onQuickTest={quickTestHarvester}
                testing={!!testingById[h.id]}
              />
            ))}
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-gray-600 px-1">
            <span>Active windows: <span className="text-gray-300">{activeCount}</span></span>
            <span>Server endpoint: <span className="text-gray-400">{SERVER_SOLVER_ENDPOINT}</span></span>
          </div>
        </>
      )}

      {runtimePopups.length > 0 && (
        <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-3">
          {runtimePopups.map((popup) => (
            <CaptchaRuntimePopup
              key={popup.id}
              popup={popup}
              onClose={closeRuntimePopup}
              onOpenManual={openManualSolveWindow}
              onTest={runCaptchaTest}
              testingKind={testingById[popup.harvesterId] || ""}
            />
          ))}
        </div>
      )}

      {perfPanelEnabled && (
        <div className="fixed left-4 bottom-4 z-40 w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border border-cyan-400/30 bg-[#07111f]/95 backdrop-blur px-3 py-2 shadow-lg shadow-cyan-500/10">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[11px] text-cyan-200">Solve Performance</span>
            <span className="font-mono text-[10px] text-cyan-400">p50 / p95 ms</span>
          </div>
          {perfRows.length === 0 ? (
            <div className="font-mono text-[10px] text-cyan-300/70">Waiting for solve samples...</div>
          ) : (
            <div className="space-y-1">
              {perfRows.map((row) => (
                <div key={row.key} className="grid grid-cols-[1.8fr_1fr_1fr_1fr] gap-2 text-[10px] font-mono text-cyan-100/90">
                  <span className="truncate" title={row.key}>{row.key}</span>
                  <span title="Total">{row.p50}/{row.p95}</span>
                  <span title="Solver">{row.solverP50}/{row.solverP95}</span>
                  <span title="OK rate">{row.okRate}% ({row.count})</span>
                </div>
              ))}
              <div className="pt-1 text-[9px] font-mono text-cyan-300/70">Columns: key | total | solver | success</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

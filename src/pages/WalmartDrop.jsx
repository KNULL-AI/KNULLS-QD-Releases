import { useState, useEffect, useRef } from "react";
import { ShoppingBag, Plus, Trash2, Play, Square, Clock, Users, Globe, Flame, Edit2, ChevronDown, ChevronUp, CalendarDays } from "lucide-react";
import WarmupStatusPanel from "@/components/walmart/WarmupStatusPanel";
import { db } from "@/lib/db";
import { launchBrowser } from "@/lib/electronBridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import toast from "react-hot-toast";

const LOGIN_URL = "https://www.walmart.com/account/login";

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(ms) {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h > 0 && `${h}h`, m > 0 && `${m}m`, `${sec}s`].filter(Boolean).join(" ");
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ── Phase timeline ────────────────────────────────────────────────────────────
const PHASES = [
  { key: "idle",    label: "Scheduled",   color: "text-gray-400",    dot: "bg-gray-600" },
  { key: "warming", label: "Warmup",      color: "text-orange-400",  dot: "bg-orange-500" },
  { key: "live",    label: "Live",        color: "text-emerald-400", dot: "bg-emerald-500" },
  { key: "done",    label: "Done",        color: "text-blue-400",    dot: "bg-blue-500" },
];

function PhaseBar({ status }) {
  const idx = PHASES.findIndex((p) => p.key === status);
  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, i) => (
        <div key={p.key} className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${i <= idx ? p.dot : "bg-gray-800"}`} />
          <span className={`text-[9px] font-mono ${i === idx ? p.color : "text-gray-700"}`}>{p.label}</span>
          {i < PHASES.length - 1 && <div className={`w-4 h-px ${i < idx ? "bg-gray-500" : "bg-gray-800"}`} />}
        </div>
      ))}
    </div>
  );
}

// ── Day scheduler helpers ─────────────────────────────────────────────────────
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Given HH:MM and optional schedule_days, compute next drop timestamp in ms
function resolveDropMs(timeOfDay, scheduleDays) {
  const [hh, mm] = (timeOfDay || "21:00").split(":").map(Number);
  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(hh, mm, 0, 0);

  if (!scheduleDays || scheduleDays.length === 0) {
    // No day restriction — use today if still in the future, else tomorrow
    if (candidate.getTime() <= Date.now()) candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }

  // Find the next occurrence on one of the scheduled days
  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(now);
    d.setDate(now.getDate() + offset);
    d.setHours(hh, mm, 0, 0);
    if (scheduleDays.includes(d.getDay()) && d.getTime() > Date.now()) return d.getTime();
  }
  // Fallback — shouldn't happen but return candidate + 1 day
  return candidate.getTime() + 86400000;
}

// ── Create / Edit dialog ──────────────────────────────────────────────────────
function DropDialog({ accounts, proxyGroups, editing, onSaved }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dropTimeOfDay, setDropTimeOfDay] = useState("21:00");
  const [scheduleDays, setScheduleDays] = useState([]);
  const [productUrl, setProductUrl] = useState("https://www.walmart.com/");
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [proxyGroupId, setProxyGroupId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && editing) {
      setName(editing.name || "");
      setDropTimeOfDay(editing.drop_time_of_day || "21:00");
      setScheduleDays(editing.schedule_days || []);
      setProductUrl(editing.product_url || "https://www.walmart.com/");
      setSelectedAccounts(editing.account_ids || []);
      setProxyGroupId(editing.proxy_group_id || "");
    } else if (open && !editing) {
      setName(""); setDropTimeOfDay("21:00"); setScheduleDays([]);
      setProductUrl("https://www.walmart.com/"); setSelectedAccounts([]); setProxyGroupId("");
    }
  }, [open, editing]);

  const toggleAccount = (id) =>
    setSelectedAccounts((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const toggleDay = (d) =>
    setScheduleDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b));

  const submit = async () => {
    if (!name || !dropTimeOfDay || !productUrl) { toast.error("Name, drop time, and product URL are required"); return; }
    if (!selectedAccounts.length) { toast.error("Select at least one account"); return; }
    setSaving(true);
    const payload = {
      name,
      drop_time_of_day: dropTimeOfDay,
      schedule_days: scheduleDays,
      product_url: productUrl,
      account_ids: selectedAccounts,
      proxy_group_id: proxyGroupId || null,
    };
    if (editing) {
      await db.WalmartDrop.update(editing.id, payload);
      toast.success("Drop updated");
    } else {
      await db.WalmartDrop.create({ ...payload, status: "idle", session_ids: [] });
      toast.success("Drop scheduled");
    }
    setSaving(false);
    setOpen(false);
    onSaved();
  };

  // Preview: next fire time
  const nextMs = resolveDropMs(dropTimeOfDay, scheduleDays);
  const nextDate = new Date(nextMs);
  const nextLabel = nextDate.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <button className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-white/5 rounded" title="Edit drop"><Edit2 className="w-3.5 h-3.5" /></button>
        ) : (
          <Button className="bg-orange-600 hover:bg-orange-700 text-white font-mono text-xs gap-2"><Plus className="w-3.5 h-3.5" /> New Drop</Button>
        )}
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d16] border-white/10 text-gray-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-mono text-sm text-orange-400">{editing ? "Edit Drop" : "Schedule Walmart Drop"}</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-3">
          <div>
            <Label className="text-xs text-gray-400 font-mono">Drop Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pokemon Cards Restock" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>

          {/* Time + Day Scheduler */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400 font-mono flex items-center gap-1"><Clock className="w-3 h-3" /> Drop Time * <span className="text-gray-600">(24h)</span></Label>
            <Input
              type="time"
              value={dropTimeOfDay}
              onChange={(e) => setDropTimeOfDay(e.target.value)}
              className="bg-white/5 border-white/10 font-mono text-sm w-36"
            />
            <div>
              <p className="text-[10px] font-mono text-gray-500 flex items-center gap-1 mb-1.5">
                <CalendarDays className="w-3 h-3" /> Repeat on days <span className="text-gray-700">(optional — leave empty to run once manually)</span>
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {DAY_LABELS.map((label, i) => (
                  <button key={i} onClick={() => toggleDay(i)}
                    className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${scheduleDays.includes(i) ? "bg-orange-500/20 border-orange-500/40 text-orange-300" : "bg-white/[0.02] border-white/10 text-gray-500 hover:border-white/20"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[10px] font-mono text-emerald-500/70">
              Next fire: {nextLabel}
            </p>
            <p className="text-[10px] font-mono text-gray-600">Logins warm up 1h before · product URL pushed 10min before · queue opens at drop time</p>
          </div>

          <div>
            <Label className="text-xs text-gray-400 font-mono flex items-center gap-1"><Globe className="w-3 h-3" /> Product URL *</Label>
            <Input value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="https://www.walmart.com/ip/..." className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono flex items-center gap-1"><Users className="w-3 h-3" /> Assign Accounts * ({selectedAccounts.length} selected)</Label>
            <div className="mt-1 space-y-1 max-h-48 overflow-y-auto border border-white/5 rounded-sm p-2">
              {accounts.length === 0 && <p className="text-[10px] font-mono text-gray-600 text-center py-2">No accounts — add them in the Accounts tab</p>}
              {accounts.map((a) => (
                <button key={a.id} onClick={() => toggleAccount(a.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors ${selectedAccounts.includes(a.id) ? "bg-orange-500/15 border border-orange-500/30" : "bg-white/[0.02] border border-white/5 hover:border-white/10"}`}>
                  <div className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center ${selectedAccounts.includes(a.id) ? "bg-orange-500 border-orange-500" : "border-white/20"}`}>
                    {selectedAccounts.includes(a.id) && <span className="text-[8px] text-white">✓</span>}
                  </div>
                  <span className="font-mono text-xs text-gray-200">{a.label}</span>
                  <span className="font-mono text-[10px] text-gray-500 truncate">{a.email}</span>
                  <span className={`ml-auto text-[9px] font-mono px-1 rounded ${a.status === "signed_in" ? "text-emerald-400" : a.status === "needs_code" ? "text-yellow-400" : "text-gray-600"}`}>{a.status}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Fallback Proxy Group <span className="text-gray-600">(optional)</span></Label>
            <Select value={proxyGroupId || "none"} onValueChange={(v) => setProxyGroupId(v === "none" ? "" : v)}>
              <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent className="bg-[#1a1a24] border-white/10">
                <SelectItem value="none" className="font-mono text-xs text-gray-100">None (use per-account proxy)</SelectItem>
                {proxyGroups.map((g) => <SelectItem key={g.id} value={g.id} className="font-mono text-xs text-gray-100">{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={submit} disabled={saving} className="w-full bg-orange-600 hover:bg-orange-700 font-mono text-xs">
            {saving ? "Saving…" : editing ? "Update Drop" : "Schedule Drop"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Drop Card ─────────────────────────────────────────────────────────────────
function DropCard({ drop, accounts, proxyGroups, proxies, onUpdate, onDelete }) {
  const now = useNow();
  const dropMs = resolveDropMs(drop.drop_time_of_day, drop.schedule_days);
  const warmupMs = dropMs - 60 * 60 * 1000;   // 1 hour before
  const urlMs = dropMs - 10 * 60 * 1000;      // 10 minutes before
  const [expanded, setExpanded] = useState(false);

  // Timers — track scheduling in a ref to avoid double-firing on re-render
  const warmupFired = useRef(false);
  const urlFired = useRef(false);

  // Keep latest versions of fire functions in refs so the auto-fire effect never uses stale closures
  const fireWarmupRef = useRef(null);
  const fireUrlRef = useRef(null);

  // Resolve proxy for an account
  const resolveProxy = async (acc) => {
    if (acc.proxy_assignment_type === "single" && acc.proxy_id) {
      return proxies.find((p) => p.id === acc.proxy_id) || null;
    }
    if (acc.proxy_assignment_type === "group" && acc.proxy_group_id) {
      const pg = await db.ProxyGroup.get(acc.proxy_group_id).catch(() => null);
      if (pg?.proxy_ids?.length) {
        const all = await Promise.all(pg.proxy_ids.map((id) => db.Proxy.get(id).catch(() => null)));
        return all.find(Boolean) || null;
      }
    }
    // Fallback proxy group on the drop itself
    if (drop.proxy_group_id) {
      const pg = await db.ProxyGroup.get(drop.proxy_group_id).catch(() => null);
      if (pg?.proxy_ids?.length) {
        const all = await Promise.all(pg.proxy_ids.map((id) => db.Proxy.get(id).catch(() => null)));
        return all.find(Boolean) || null;
      }
    }
    return null;
  };

  // Phase 1: Warmup — launch login sessions for all assigned accounts
  const fireWarmup = async () => {
    if (drop.status !== "idle") return;
    const assignedAccounts = accounts.filter((a) => (drop.account_ids || []).includes(a.id));
    if (!assignedAccounts.length) return;

    const sessionRecs = [];
    for (const acc of assignedAccounts) {
      const proxy = await resolveProxy(acc);
      const nowIso = new Date().toISOString();
      const sess = await db.BrowserSession.create({
        name: `[DROP] ${drop.name} — ${acc.label}`,
        target_url: LOGIN_URL,
        proxy_id: proxy?.id || null,
        proxy_label: proxy ? `${proxy.host}:${proxy.port}` : "No proxy",
        status: "running",
        browser: "chrome",
        rotation_mode: "sticky",
        started_at: nowIso,
        walmart_account_id: acc.id,
        walmart_account_email: acc.email,
      });
      await launchBrowser({ sessionId: sess.id, url: LOGIN_URL, proxy, browser: "chrome", partitionKey: `walmart-account-${acc.id}` });
      await db.WalmartAccount.update(acc.id, { status: "needs_code", last_used: nowIso });
      sessionRecs.push(sess.id);
    }

    await db.WalmartDrop.update(drop.id, {
      status: "warming",
      session_ids: sessionRecs,
      warmup_fired_at: new Date().toISOString(),
    });
    toast.success(`🔥 Warmup started — ${assignedAccounts.length} login session${assignedAccounts.length !== 1 ? "s" : ""} launched`);
    onUpdate();
  };

  // Phase 2: Called at 10min before — arms a precise setTimeout to fire at EXACTLY drop time
  // Navigating early would show a blank/error page; sessions stay put until the queue opens
  const urlTimeoutRef = useRef(null);

  const fireUrl = async () => {
    if (drop.status !== "warming") return;

    const msUntilDrop = dropMs - Date.now();

    await db.WalmartDrop.update(drop.id, {
      status: "live",
      url_fired_at: new Date().toISOString(),
    });
    toast.success(`⏳ Sessions armed — navigating to product page in ${fmt(Math.max(msUntilDrop, 0))} at drop time`);
    onUpdate();

    // Schedule the actual navigation to fire at exact drop time
    clearTimeout(urlTimeoutRef.current);
    urlTimeoutRef.current = setTimeout(async () => {
      const sessionIds = drop.session_ids || [];
      let navigated = 0;
      for (const sessionId of sessionIds) {
        const sess = await db.BrowserSession.get(sessionId).catch(() => null);
        if (!sess || sess.status !== "running") continue;
        const proxy = sess.proxy_id ? proxies.find((p) => p.id === sess.proxy_id) : null;
        await launchBrowser({ sessionId, url: drop.product_url, proxy, browser: "chrome" });
        await db.BrowserSession.update(sessionId, { target_url: drop.product_url });
        navigated++;
      }
      toast.success(`🛒 ${navigated} session${navigated !== 1 ? "s" : ""} launched to product page — queue is live!`);
    }, Math.max(msUntilDrop, 0));
  };

  // Keep refs up to date with latest closures
  fireWarmupRef.current = fireWarmup;
  fireUrlRef.current = fireUrl;

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(urlTimeoutRef.current), []);

  // Auto-fire timers — only when drop is active
  useEffect(() => {
    if (drop.status === "cancelled" || drop.status === "done") return;

    // Warmup — 1hr before
    if (!warmupFired.current && drop.status === "idle" && now >= warmupMs && now < dropMs) {
      warmupFired.current = true;
      fireWarmupRef.current();
    }

    // Arm — 10min before drop
    if (!urlFired.current && drop.status === "warming" && now >= urlMs && now < dropMs + 60000) {
      urlFired.current = true;
      fireUrlRef.current();
    }
  }, [now, drop.status, warmupMs, urlMs, dropMs]);

  // Reset refs when drop resets
  useEffect(() => {
    if (drop.status === "idle") { warmupFired.current = false; urlFired.current = false; }
  }, [drop.status]);

  const cancel = async () => {
    await db.WalmartDrop.update(drop.id, { status: "cancelled" });
    toast("Drop cancelled");
    onUpdate();
  };

  const reset = async () => {
    await db.WalmartDrop.update(drop.id, { status: "idle", session_ids: [], warmup_fired_at: null, url_fired_at: null });
    toast.success("Drop reset to idle");
    onUpdate();
  };

  const assignedAccounts = accounts.filter((a) => (drop.account_ids || []).includes(a.id));

  // Time display
  const toWarmup = warmupMs - now;
  const toUrl = urlMs - now;
  const toDrop = dropMs - now;

  const statusColor = {
    idle: "border-white/5",
    warming: "border-orange-500/20",
    live: "border-emerald-500/20",
    done: "border-blue-500/20",
    cancelled: "border-red-500/10",
  }[drop.status] || "border-white/5";

  return (
    <div className={`relative border bg-[#08080f] rounded-sm p-4 space-y-3 transition-colors ${statusColor}`}>
      <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-orange-500/20" />

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm text-gray-100">{drop.name}</p>
          <PhaseBar status={drop.status} />
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {drop.status === "idle" && (
            <button onClick={fireWarmup} title="Force start warmup now"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors">
              <Flame className="w-3 h-3" /> Warm
            </button>
          )}
          {drop.status === "warming" && (
            <button onClick={fireUrl} title="Force push product URL now"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
              <Play className="w-3 h-3" /> Push URL
            </button>
          )}
          {(drop.status === "idle" || drop.status === "warming" || drop.status === "live") && (
            <button onClick={cancel} title="Cancel drop"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
              <Square className="w-3 h-3" /> Cancel
            </button>
          )}
          {(drop.status === "done" || drop.status === "cancelled") && (
            <button onClick={reset} title="Reset drop"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 transition-colors">
              <Clock className="w-3 h-3" /> Reset
            </button>
          )}
          <DropDialog accounts={accounts} proxyGroups={proxyGroups} editing={drop} onSaved={onUpdate} />
          <button onClick={() => onDelete(drop.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Countdown timers */}
      <div className="grid grid-cols-3 gap-2">
        <div className={`rounded-sm border px-2 py-1.5 text-center ${toWarmup > 0 ? "border-orange-500/20 bg-orange-500/5" : "border-white/5 bg-white/[0.01]"}`}>
          <p className="text-[8px] font-mono text-gray-600 uppercase tracking-widest">Warmup In</p>
          <p className={`text-xs font-mono font-bold ${toWarmup > 0 ? "text-orange-400" : "text-gray-600"}`}>
            {toWarmup > 0 ? fmt(toWarmup) : drop.warmup_fired_at ? "✓ Fired" : "—"}
          </p>
        </div>
        <div className={`rounded-sm border px-2 py-1.5 text-center ${toUrl > 0 ? "border-blue-500/20 bg-blue-500/5" : "border-white/5 bg-white/[0.01]"}`}>
          <p className="text-[8px] font-mono text-gray-600 uppercase tracking-widest">Arm In</p>
          <p className={`text-xs font-mono font-bold ${toUrl > 0 ? "text-blue-400" : "text-gray-600"}`}>
            {toUrl > 0 ? fmt(toUrl) : drop.url_fired_at ? "✓ Armed" : "—"}
          </p>
        </div>
        <div className={`rounded-sm border px-2 py-1.5 text-center ${toDrop > 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-white/5 bg-white/[0.01]"}`}>
          <p className="text-[8px] font-mono text-gray-600 uppercase tracking-widest">Navigate In</p>
          <p className={`text-xs font-mono font-bold ${toDrop > 0 ? "text-emerald-400" : "text-gray-600"}`}>
            {toDrop > 0 ? fmt(toDrop) : drop.url_fired_at ? "🟢 Fired" : "—"}
          </p>
        </div>
      </div>

      {/* Schedule + Product URL */}
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-500">
        <Clock className="w-3 h-3 text-orange-400 flex-shrink-0" />
        <span className="text-gray-300">{drop.drop_time_of_day}</span>
        {drop.schedule_days && drop.schedule_days.length > 0 ? (
          <span className="flex gap-0.5">
            {drop.schedule_days.map((d) => (
              <span key={d} className="px-1 bg-orange-500/10 border border-orange-500/20 rounded text-orange-400 text-[9px]">{DAY_LABELS[d]}</span>
            ))}
          </span>
        ) : (
          <span className="text-gray-700">manual trigger</span>
        )}
        <span className="text-gray-700 ml-auto">next: {new Date(dropMs).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-500">
        <Globe className="w-3 h-3 text-orange-400 flex-shrink-0" />
        <span className="truncate">{drop.product_url}</span>
      </div>

      {/* Accounts summary */}
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between text-[10px] font-mono text-gray-500 hover:text-gray-300 transition-colors pt-1 border-t border-white/5">
        <span className="flex items-center gap-1.5">
          <Users className="w-3 h-3 text-orange-400" />
          {assignedAccounts.length} account{assignedAccounts.length !== 1 ? "s" : ""} assigned
          {(drop.session_ids || []).length > 0 && <span className="text-violet-400">· {(drop.session_ids || []).length} sessions running</span>}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (drop.status === "warming" || drop.status === "live") && (
        <WarmupStatusPanel drop={drop} accounts={accounts} />
      )}

      {expanded && drop.status !== "warming" && drop.status !== "live" && (
        <div className="space-y-1 pt-2 border-t border-white/5">
          {assignedAccounts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 px-2 py-1 bg-white/[0.02] border border-white/5 rounded-sm">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.status === "signed_in" ? "bg-emerald-400" : a.status === "needs_code" ? "bg-yellow-400 animate-pulse" : a.status === "failed" ? "bg-red-400" : "bg-gray-600"}`} />
              <span className="font-mono text-xs text-gray-200">{a.label}</span>
              <span className="font-mono text-[10px] text-gray-500 truncate">{a.email}</span>
              <span className={`ml-auto text-[9px] font-mono ${a.status === "signed_in" ? "text-emerald-400" : a.status === "needs_code" ? "text-yellow-400" : "text-gray-600"}`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function WalmartDropPage() {
  const [drops, setDrops] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [proxyGroups, setProxyGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [d, a, p, pg] = await Promise.all([
      db.WalmartDrop.list("-created_date"),
      db.WalmartAccount.list(),
      db.Proxy.list("-created_date", 500),
      db.ProxyGroup.list(),
    ]);
    setDrops(Array.isArray(d) ? d : []);
    setAccounts(Array.isArray(a) ? a : []);
    setProxies(Array.isArray(p) ? p : []);
    setProxyGroups(Array.isArray(pg) ? pg : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const del = async (id) => {
    await db.WalmartDrop.delete(id);
    toast.success("Drop deleted");
    load();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-orange-500/30 border-t-orange-400 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-orange-400" /> Walmart Drop Manager
          </h1>
          <p className="text-xs text-gray-500 font-mono mt-1">
            {drops.length} drop{drops.length !== 1 ? "s" : ""} · set a drop time · optional day scheduler for recurring drops
          </p>
        </div>
        <DropDialog accounts={accounts} proxyGroups={proxyGroups} onSaved={load} />
      </div>

      {/* Info banner */}
      <div className="rounded-sm border border-orange-500/20 bg-orange-500/5 px-4 py-3 space-y-1">
        <p className="text-xs font-mono text-orange-400 font-semibold">How it works</p>
        <p className="text-[11px] font-mono text-gray-400">
          <span className="text-orange-300">1h before drop</span> — Login sessions launch for all assigned accounts. IMAP monitor auto-fills verification codes.
        </p>
        <p className="text-[11px] font-mono text-gray-400">
          <span className="text-blue-300">10min before drop</span> — Sessions are armed with a precise timer. They stay on their current page until drop time.
        </p>
        <p className="text-[11px] font-mono text-gray-400">
          <span className="text-emerald-300">At exact drop time</span> — All sessions simultaneously navigate to the product URL the moment the queue opens.
        </p>
      </div>

      {drops.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/5 rounded-sm">
          <ShoppingBag className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 font-mono">No drops scheduled</p>
          <p className="text-xs text-gray-700 font-mono mt-1">Create a drop to orchestrate your Walmart sessions</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {drops.map((d) => (
            <DropCard key={d.id} drop={d} accounts={accounts} proxyGroups={proxyGroups} proxies={proxies} onUpdate={load} onDelete={del} />
          ))}
        </div>
      )}
    </div>
  );
}
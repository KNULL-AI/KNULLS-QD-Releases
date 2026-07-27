import { useState, useEffect, useRef } from "react";
import { Radio, Plus, Trash2, Play, Square, ChevronUp, ChevronDown, X, ShoppingCart, RefreshCw, Edit2, ScrollText, Zap, AlertTriangle, Clock, Swords } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { launchBrowser } from "@/lib/electronBridge";

// ── Global in-memory event log (shared across all MonitorCards) ───────────────
// Using a module-level array + subscriber list so cards can push without prop drilling
const _discordLog = [];
const _logSubs = new Set();
function pushLog(entry) {
  _discordLog.unshift({ ...entry, ts: new Date() });
  if (_discordLog.length > 500) _discordLog.length = 500;
  _logSubs.forEach((cb) => cb([..._discordLog]));
}
function useDiscordLog() {
  const [log, setLog] = useState([..._discordLog]);
  useEffect(() => {
    const cb = (l) => setLog(l);
    _logSubs.add(cb);
    return () => {
      _logSubs.delete(cb);
    };
  }, []);
  return log;
}

/** Normalize a URL for comparison: strip query params and trailing slash */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

function pickProxy(proxies, mode, index) {
  if (!proxies.length) return null;
  if (mode === "random") return proxies[Math.floor(Math.random() * proxies.length)];
  return proxies[index % proxies.length]; // round_robin or sticky
}

const normalizeId = (id) => id == null ? "" : String(id);
const resolveAssignedAccounts = (tg, allAccounts) => {
  const rawIds = Array.isArray(tg.account_ids)
    ? tg.account_ids
    : typeof tg.account_ids === "string"
      ? (() => { try { return JSON.parse(tg.account_ids); } catch { return []; } })()
      : [];
  const desiredIds = Array.isArray(rawIds) ? rawIds.map(normalizeId) : [];
  return (Array.isArray(allAccounts) ? allAccounts : []).filter((a) => desiredIds.includes(normalizeId(a.id)));
};

async function resolveProxyForAccount(acc, groupProxies) {
  if (acc.proxy_assignment_type === "single" && acc.proxy_id) {
    const p = await db.Proxy.get(acc.proxy_id).catch(() => null);
    if (p) return p;
  }
  if (acc.proxy_assignment_type === "group" && acc.proxy_group_id) {
    const pg = await db.ProxyGroup.get(acc.proxy_group_id).catch(() => null);
    if (pg?.proxy_ids?.length) {
      const all = await Promise.all(pg.proxy_ids.map((id) => db.Proxy.get(id).catch(() => null)));
      const found = all.find(Boolean);
      if (found) return found;
    }
  }
  return groupProxies.length ? groupProxies[0] : null;
}

async function runTaskGroup(tg) {
  let proxies = [];
  if (tg.proxy_group_id) {
    const pg = await db.ProxyGroup.get(tg.proxy_group_id);
    if (pg?.proxy_ids?.length) {
      const fetched = await Promise.all(pg.proxy_ids.map((id) => db.Proxy.get(id).catch(() => null)));
      proxies = fetched.filter(Boolean);
    }
  }
  // No proxy group set = direct connection (no proxy)

  const isWalmart = (tg.retailer || "").toLowerCase() === "walmart";
  let assignedAccounts = [];
  if (isWalmart && tg.account_ids?.length) {
    const allAccounts = await db.WalmartAccount.list().catch(() => []);
    assignedAccounts = resolveAssignedAccounts(tg, allAccounts);
    if (tg.account_ids.length && !assignedAccounts.length) {
      console.warn(`[DiscordMonitor] Walmart task group ${tg.name} has account_ids set, but no matching accounts were found`);
    }
  }

  const now = new Date().toISOString();

  if (assignedAccounts.length) {
    // Account-driven trigger: one session per assigned account. For Walmart,
    // Discord-triggered runs should reuse the warmed account cookies and go
    // directly to the target URL (do not force re-login every trigger).
    const launchUrl = tg.target_url;
    const sessions = [];
    for (const acc of assignedAccounts) {
      const proxy = await resolveProxyForAccount(acc, proxies);
      const sess = await db.BrowserSession.create({
        name: `[AUTO] ${tg.name} — ${acc.label}`,
        target_url: tg.target_url,
        proxy_id: proxy?.id || null,
        proxy_label: proxy ? `${proxy.host}:${proxy.port}` : "No proxy",
        status: "running",
        rotation_mode: tg.rotation_mode || "round_robin",
        user_agent: tg.user_agent || null,
        browser: tg.browser || "chrome",
        started_at: now,
        walmart_account_id: acc.id,
        walmart_account_email: acc.email,
      });
      await launchBrowser({
        sessionId: sess.id, url: launchUrl, proxy,
        userAgent: tg.user_agent || null,
        browser: tg.browser || "chrome",
        manualOpen: true,
        credentials: null,
        partitionKey: `walmart-account-${acc.id}`,
      });
      sessions.push(sess);
      await db.WalmartAccount.update(acc.id, { last_used: now }).catch(() => {});
      if (tg.delay_ms > 0 && sessions.length < assignedAccounts.length) await new Promise((r) => setTimeout(r, tg.delay_ms));
    }
    return sessions.length;
  }

  const count = tg.instance_count || 1;
  const mode = tg.rotation_mode || "round_robin";

  const assignedProxies = Array.from({ length: count }, (_, i) => pickProxy(proxies, mode, i));

  // Bulk-create all session records in one IPC call
  const sessions = await db.BrowserSession.bulkCreate(
    assignedProxies.map((proxy, i) => ({
      name: `[AUTO] ${tg.name} #${i + 1}`,
      target_url: tg.target_url,
      proxy_id: proxy?.id || null,
      proxy_label: proxy ? `${proxy.host}:${proxy.port}` : "No proxy",
      status: "running",
      rotation_mode: mode,
      user_agent: tg.user_agent || null,
      browser: tg.browser || "chrome",
      started_at: now,
    }))
  );

  for (let i = 0; i < sessions.length; i++) {
    launchBrowser({ sessionId: sessions[i].id, url: tg.target_url, proxy: assignedProxies[i], userAgent: tg.user_agent || null, browser: tg.browser || "chrome" });
    if (tg.delay_ms > 0 && i < sessions.length - 1) await new Promise((r) => setTimeout(r, tg.delay_ms));
  }
  return count;
}

// ── Walmart Item Panel ────────────────────────────────────────────────────────
function WalmartItemPanel({ assignedGroups, onManualLaunch, launchedIds }) {
  const [manualUrl, setManualUrl] = useState("");

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Walmart Item Pool — Manual Pre-Launch</p>

      {/* Manual URL launcher */}
      <div className="flex gap-2">
        <Input
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          placeholder="Paste item URL to launch matching task group…"
          className="bg-white/5 border-white/10 font-mono text-[11px] h-7 flex-1"
        />
        <button
          onClick={() => {
            if (!manualUrl.trim()) return;
            const norm = normalizeUrl(manualUrl.trim());
            const match = assignedGroups.find((tg) => normalizeUrl(tg.target_url) === norm);
            if (!match) {
              toast.error(`No task group matches: ${manualUrl.trim()}`);
            } else {
              onManualLaunch(match);
              setManualUrl("");
            }
          }}
          className="px-2.5 py-1 rounded-sm border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-[10px] font-mono hover:bg-yellow-500/20 transition-all whitespace-nowrap"
        >
          ▶ Launch
        </button>
      </div>

      {/* Per-item status rows */}
      {assignedGroups.map((tg) => {
        const launched = launchedIds.has(tg.id);
        return (
          <div key={tg.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-sm border ${launched ? "border-green-500/20 bg-green-500/5" : "border-white/5 bg-white/[0.02]"}`}>
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${launched ? "bg-green-400" : "bg-gray-700"}`} />
            <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
            <span className="text-[9px] font-mono text-gray-600 truncate max-w-[130px]">{tg.target_url}</span>
            {launched
              ? <span className="text-[9px] font-mono text-green-400 flex-shrink-0">launched</span>
              : <button onClick={() => onManualLaunch(tg)} className="text-[9px] font-mono text-yellow-400 hover:text-yellow-300 border border-yellow-500/20 px-1.5 py-0.5 rounded-sm hover:bg-yellow-500/10 transition-all flex-shrink-0">▶ Start</button>
            }
          </div>
        );
      })}
    </div>
  );
}

// ── Costco Manual URL Panel ───────────────────────────────────────────────────
function CostcoManualPanel({ assignedGroups, onManualLaunch }) {
  const [manualUrl, setManualUrl] = useState("");

  const launch = async () => {
    if (!manualUrl.trim() || !assignedGroups.length) return;
    for (const tg of assignedGroups) {
      await db.TaskGroup.update(tg.id, { target_url: manualUrl.trim() });
      await onManualLaunch({ ...tg, target_url: manualUrl.trim() });
    }
    setManualUrl("");
    toast.success(`🛒 Costco manual launch — ${assignedGroups.length} group(s) updated & fired`);
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Costco Drop Groups — auto-updated on trigger</p>
      {assignedGroups.map((tg) => (
        <div key={tg.id} className="flex items-center gap-2 px-2 py-1.5 bg-orange-500/5 border border-orange-500/10 rounded-sm">
          <RefreshCw className="w-3 h-3 text-orange-400 flex-shrink-0" />
          <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
          <span className="text-[10px] font-mono text-gray-600">{tg.instance_count} inst</span>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Input
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          placeholder="Manual URL if polling fails…"
          className="bg-white/5 border-white/10 font-mono text-[11px] h-7 flex-1"
        />
        <button
          onClick={launch}
          disabled={!manualUrl.trim()}
          className="px-2.5 py-1 rounded-sm border border-orange-500/30 bg-orange-500/10 text-orange-300 text-[10px] font-mono hover:bg-orange-500/20 transition-all whitespace-nowrap disabled:opacity-40"
        >
          ▶ Launch
        </button>
      </div>
    </div>
  );
}

// ── Edit Monitor Dialog ───────────────────────────────────────────────────────
function EditMonitorDialog({ monitor, taskGroups, onSaved }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pollInterval, setPollInterval] = useState(String(monitor.poll_interval_seconds || 5));
  const [cooldownSeconds, setCooldownSeconds] = useState(String(monitor.cooldown_seconds ?? 600));
  const [selectedTaskGroupIds, setSelectedTaskGroupIds] = useState(monitor.task_group_ids || []);

  const addTG = (id) => { if (id && !selectedTaskGroupIds.includes(id)) setSelectedTaskGroupIds((p) => [...p, id]); };
  const removeTG = (id) => setSelectedTaskGroupIds((p) => p.filter((x) => x !== id));

  const submit = async () => {
    setLoading(true);
    await db.DiscordMonitor.update(monitor.id, {
      poll_interval_seconds: Number(pollInterval),
      cooldown_seconds: Number(cooldownSeconds),
      task_group_ids: selectedTaskGroupIds,
    });
    toast.success("Monitor updated");
    setOpen(false);
    setLoading(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-1.5 text-gray-500 hover:text-violet-400 hover:bg-violet-500/10 rounded transition-colors" title="Edit monitor">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d16] border-white/10 text-gray-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-mono text-sm text-violet-400">Edit — {monitor.name}</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-3">
          <div className="rounded-sm border border-cyan-500/20 bg-cyan-500/5 px-3 py-2.5 text-[10px] font-mono text-cyan-300">
            Discord discovery is now global and backend-managed. Add the task groups this monitor should fire, and set timing here only.
          </div>

          {/* Task groups */}
          <div>
            <Label className="text-xs text-gray-400 font-mono">Task Groups</Label>
            {/* Retailer bundle quick-add */}
            {(() => {
              const retailers = [...new Set(taskGroups.map((t) => t.retailer).filter(Boolean))];
              if (!retailers.length) return null;
              return (
                <div className="flex flex-wrap gap-1 mt-1 mb-1">
                  {retailers.map((r) => {
                    const ids = taskGroups.filter((t) => t.retailer === r).map((t) => t.id);
                    const allAdded = ids.every((id) => selectedTaskGroupIds.includes(id));
                    return (
                      <button
                        key={r}
                        onClick={() => {
                          if (allAdded) {
                            setSelectedTaskGroupIds((prev) => prev.filter((id) => !ids.includes(id)));
                          } else {
                            setSelectedTaskGroupIds((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
                          }
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-mono transition-all ${allAdded ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-white/10 bg-white/5 text-gray-400 hover:border-blue-500/30 hover:text-blue-300"}`}
                      >
                        {allAdded ? "✓" : "+"} {r} <span className="text-gray-600">({ids.length})</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <Select onValueChange={addTG} value="">
              <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue placeholder="+ Add task group…" /></SelectTrigger>
              <SelectContent className="bg-[#1a1a24] border-white/10">
                {taskGroups.filter((t) => !selectedTaskGroupIds.includes(t.id)).map((t) => (
                <SelectItem key={t.id} value={t.id} className="font-mono text-xs text-gray-100">{t.retailer ? `[${t.retailer}] ` : ""}{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTaskGroupIds.map((id) => {
              const tg = taskGroups.find((t) => t.id === id);
              if (!tg) return null;
              return (
                <div key={id} className="flex items-center gap-2 px-2 py-1.5 mt-1 bg-blue-500/5 border border-blue-500/10 rounded-sm">
                  <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
                  <button onClick={() => removeTG(id)} className="text-gray-600 hover:text-red-400"><X className="w-3 h-3" /></button>
                </div>
              );
            })}
          </div>

          {/* Timing */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-400 font-mono">Trigger Cadence (seconds)</Label>
              <Input type="number" min="0.1" step="0.1" max="60" value={pollInterval} onChange={(e) => setPollInterval(e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              <p className="text-[9px] font-mono text-gray-600 mt-1">Backend worker checks this monitor on this cadence.</p>
            </div>
            <div>
              <Label className="text-xs text-gray-400 font-mono">Cooldown (seconds)</Label>
              <Input type="number" min="5" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
            </div>
          </div>

          <Button onClick={submit} disabled={loading} className="w-full bg-violet-600 hover:bg-violet-700 font-mono text-xs">
            {loading ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Monitor Card ──────────────────────────────────────────────────────────────
function MonitorCard({ monitor, taskGroups, onUpdate, onDelete }) {
  const [active, setActive] = useState(monitor.is_active);
  const [lastEvents, setLastEvents] = useState([]); // [{channelLabel, time, instances}]
  const [launchedIds, setLaunchedIds] = useState(new Set()); // tracks manually/auto launched TG ids this session
  const launchedIdsRef = useRef(new Set());
  const syncLaunchedIds = (newSet) => { launchedIdsRef.current = newSet; setLaunchedIds(newSet); };

  const toggle = async () => {
    const next = !active;
    setActive(next);
    await db.DiscordMonitor.update(monitor.id, { is_active: next });
    if (next) {
      pushLog({ type: "info", monitor: monitor.name, channel: "—", msg: "Monitor armed for backend global triggers" });
      toast.success(`"${monitor.name}" monitor armed`);
    } else {
      syncLaunchedIds(new Set());
      pushLog({ type: "info", monitor: monitor.name, channel: "—", msg: "Monitor stopped" });
      toast(`"${monitor.name}" monitor stopped`);
    }
    onUpdate();
  };

  const isWalmartMode = monitor.retailer_type === "walmart";

  const handleManualLaunch = async (tg) => {
    if (launchedIdsRef.current.has(tg.id)) {
      toast(`${tg.name} already launched this session`);
      return;
    }
    await runTaskGroup(tg);
    syncLaunchedIds(new Set([...launchedIdsRef.current, tg.id]));
    setLastEvents((prev) => [{ channelLabel: "Manual", time: new Date().toLocaleTimeString(), instances: tg.instance_count || 1 }, ...prev].slice(0, 3));
    toast.success(`🚀 ${tg.name} — ${tg.instance_count || 1} instances launched`);
  };

  const assignedGroups = (monitor.task_group_ids || []).map((id) => taskGroups.find((t) => t.id === id)).filter(Boolean);

  return (
    <div className={`relative p-4 rounded-sm border transition-all space-y-3 ${active ? "border-violet-500/30 bg-violet-500/5" : "border-white/5 bg-[#08080f]"}`}>
      <div className={`absolute top-0 left-0 w-3 h-3 border-t border-l ${active ? "border-violet-400/50" : "border-white/10"}`} />

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Radio className={`w-3.5 h-3.5 flex-shrink-0 ${active ? "text-violet-400 animate-pulse" : "text-gray-600"}`} />
            <p className="font-mono text-sm text-gray-100">{monitor.name}</p>
            <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-sm border border-gray-500/30 bg-gray-500/10 text-gray-400">
              <Radio className="w-2.5 h-2.5" />
              Global
            </span>
            {monitor.retailer_type === "walmart" && (
              <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-sm border border-yellow-500/30 bg-yellow-500/10 text-yellow-400">
                <ShoppingCart className="w-2.5 h-2.5" /> Walmart Mode
              </span>
            )}
            {monitor.retailer_type === "costco" && (
              <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-sm border border-orange-500/30 bg-orange-500/10 text-orange-400">
                <RefreshCw className="w-2.5 h-2.5" /> Costco Mode
              </span>
            )}
            {monitor.retailer_type === "pokemon_center" && (
              <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-sm border border-red-500/30 bg-red-500/10 text-red-400">
                <Swords className="w-2.5 h-2.5" /> Pokemon Center
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-gray-600 mt-0.5">Backend-managed global monitor · worker cadence {monitor.poll_interval_seconds || 5}s</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={toggle} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-mono border transition-all ${active ? "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20" : "bg-violet-500/10 border-violet-500/20 text-violet-400 hover:bg-violet-500/20"}`}>
            {active ? <><Square className="w-3 h-3" />Stop</> : <><Play className="w-3 h-3" />Start</>}
          </button>
          <EditMonitorDialog monitor={monitor} taskGroups={taskGroups} onSaved={onUpdate} />
          <button onClick={() => onDelete(monitor.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Task queue / mode-specific panels */}
      {assignedGroups.length > 0 && (
        isWalmartMode
          ? <WalmartItemPanel
              assignedGroups={assignedGroups}
              onManualLaunch={handleManualLaunch}
              launchedIds={launchedIds}
            />
          : monitor.retailer_type === "costco"
          ? <CostcoManualPanel
              assignedGroups={assignedGroups}
              onManualLaunch={handleManualLaunch}
            />
          : monitor.retailer_type === "pokemon_center"
          ? <div className="space-y-1">
              <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Pokemon Center Tasks — fire on keyword match</p>
              <p className="text-[9px] font-mono text-red-400/60">Triggers on: "Security Change Detected" · "Queue Detected"</p>
              {assignedGroups.map((tg) => (
                <div key={tg.id} className="flex items-center gap-2 px-2 py-1 bg-red-500/5 border border-red-500/10 rounded-sm">
                  <Swords className="w-3 h-3 text-red-400 flex-shrink-0" />
                  <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
                  <span className="text-[10px] font-mono text-gray-600">{tg.instance_count} inst</span>
                </div>
              ))}
            </div>
          : <div className="space-y-1">
              <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Task Queue ({assignedGroups.length})</p>
              {assignedGroups.map((tg, i) => (
                <div key={tg.id} className="flex items-center gap-2 px-2 py-1 bg-blue-500/5 border border-blue-500/10 rounded-sm">
                  <span className="text-[10px] font-mono text-blue-400 w-4">{i + 1}.</span>
                  <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
                  <span className="text-[10px] font-mono text-gray-600">{tg.instance_count} inst · {tg.delay_ms || 0}ms</span>
                </div>
              ))}
            </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-[10px] font-mono text-gray-600 flex-wrap">
        <span>triggered: <span className="text-gray-400">{monitor.trigger_count || 0}×</span></span>
        {monitor.last_triggered && <span>last: <span className="text-gray-400">{new Date(monitor.last_triggered).toLocaleTimeString()}</span></span>}
        <span>cooldown: <span className="text-gray-400">{monitor.cooldown_seconds ?? 600}s</span></span>
      </div>

      {/* Recent events */}
      {lastEvents.map((ev, i) => (
        <div key={i} className="px-2 py-1.5 rounded-sm bg-violet-500/10 border border-violet-500/20 text-[10px] font-mono text-violet-300">
          ▶ {ev.time} — {ev.channelLabel} fired · {ev.instances} instances launched
        </div>
      ))}

      {active && <div className="h-px w-full bg-gradient-to-r from-transparent via-violet-500/50 to-transparent animate-pulse" />}
    </div>
  );
}

// ── Add Monitor Dialog ────────────────────────────────────────────────────────
function AddMonitorDialog({ taskGroups, onAdded }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retailerType, setRetailerType] = useState("standard");
  const [name, setName] = useState("");
  const [pollInterval, setPollInterval] = useState("5");
  const [cooldownSeconds, setCooldownSeconds] = useState("600");
  const [selectedTaskGroupIds, setSelectedTaskGroupIds] = useState([]);

  const addTG = (id) => { if (id && !selectedTaskGroupIds.includes(id)) setSelectedTaskGroupIds((p) => [...p, id]); };
  const removeTG = (id) => setSelectedTaskGroupIds((p) => p.filter((x) => x !== id));
  const moveUp = (i) => { const a = [...selectedTaskGroupIds]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setSelectedTaskGroupIds(a); };
  const moveDown = (i) => { const a = [...selectedTaskGroupIds]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setSelectedTaskGroupIds(a); };

  const canSubmit = name.trim() && selectedTaskGroupIds.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    await db.DiscordMonitor.create({
      name,
      retailer_type: retailerType,
      poll_interval_seconds: Number(pollInterval),
      cooldown_seconds: Number(cooldownSeconds),
      task_group_ids: selectedTaskGroupIds,
      is_active: false,
      trigger_count: 0,
    });
    toast.success("Monitor created");
    setOpen(false); setLoading(false);
    setName(""); setSelectedTaskGroupIds([]);
    setCooldownSeconds("600"); setRetailerType("standard");
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-violet-600 hover:bg-violet-700 text-white font-mono text-xs gap-2"><Plus className="w-3.5 h-3.5" />Add Monitor</Button>
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d16] border-white/10 text-gray-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-mono text-sm text-violet-400">New Global Monitor</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-3">

          {/* Retailer type */}
          <div>
            <Label className="text-xs text-gray-400 font-mono">Retailer Type *</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button onClick={() => setRetailerType("standard")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${retailerType === "standard" ? "border-violet-500/50 bg-violet-500/10 text-violet-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <Radio className="w-3.5 h-3.5" /> Standard
              </button>
              <button onClick={() => setRetailerType("walmart")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${retailerType === "walmart" ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <ShoppingCart className="w-3.5 h-3.5" /> Walmart
              </button>
              <button onClick={() => setRetailerType("costco")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${retailerType === "costco" ? "border-orange-500/50 bg-orange-500/10 text-orange-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <RefreshCw className="w-3.5 h-3.5" /> Costco
              </button>
              <button onClick={() => setRetailerType("pokemon_center")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${retailerType === "pokemon_center" ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <Swords className="w-3.5 h-3.5" /> Pokemon Center
              </button>
            </div>
            {retailerType === "walmart" && (
              <div className="mt-2 rounded-sm border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-[10px] font-mono text-yellow-400 space-y-1">
                <p className="font-semibold">Walmart mode — URL-matched launching</p>
                <p className="text-yellow-400/70">When a drop is detected, the item URL is parsed from the trigger payload. Only the TaskGroup whose <strong>Target URL</strong> matches that item URL will be launched. Add one TaskGroup per Walmart item.</p>
              </div>
            )}
            {retailerType === "costco" && (
              <div className="mt-2 rounded-sm border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-[10px] font-mono text-orange-400 space-y-1">
                <p className="font-semibold">Costco mode — URL auto-update & launch</p>
                <p className="text-orange-400/70">Extracts the drop URL from trigger content and writes it to all assigned TaskGroups, then fires. Falls back to manual URL input if no URL is present.</p>
              </div>
            )}
            {retailerType === "pokemon_center" && (
              <div className="mt-2 rounded-sm border border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] font-mono text-red-400 space-y-1">
                <p className="font-semibold">Pokemon Center mode — keyword trigger</p>
                <p className="text-red-400/70">Fires all assigned TaskGroups the moment any message containing <strong>"Security Change Detected"</strong> or <strong>"Queue Detected"</strong> is seen. No URL parsing, no warmup, no login required.</p>
              </div>
            )}
          </div>

          <div className="rounded-sm border border-cyan-500/20 bg-cyan-500/5 px-3 py-2.5 text-[10px] font-mono text-cyan-300">
            Discord discovery is now global and backend-managed. Add the task groups this monitor should fire, and set timing here only.
          </div>

          <div>
            <Label className="text-xs text-gray-400 font-mono">Retailer / Monitor Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Walmart, PokemonCenter, Costco" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-400 font-mono">Trigger Cadence (seconds)</Label>
              <Input type="number" min="0.1" step="0.1" max="60" value={pollInterval} onChange={(e) => setPollInterval(e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              <p className="text-[9px] font-mono text-gray-600 mt-1">Sets how often backend trigger matching runs for this monitor.</p>
            </div>
            <div>
              <Label className="text-xs text-gray-400 font-mono">Cooldown (seconds)</Label>
              <Input type="number" min="5" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} placeholder="60" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              <p className="text-[9px] font-mono text-gray-600 mt-1">Silence re-triggers after first fire</p>
            </div>
          </div>

          {/* Task group queue */}
          <div>
            <Label className="text-xs text-gray-400 font-mono">
              {retailerType === "walmart"
                ? <>Item Pool <span className="text-gray-600">(each TaskGroup matched by its Target URL)</span></>
                : retailerType === "costco"
                ? <>Drop Groups <span className="text-gray-600">(URL auto-updated from Discord message; manual fallback available)</span></>
                : retailerType === "pokemon_center"
                ? <>Task Groups <span className="text-gray-600">(all fire instantly on keyword detection)</span></>
                : <>Task Queue <span className="text-gray-600">(backend-managed global source)</span></>
              }
            </Label>
            {/* Retailer bundle quick-add */}
            {(() => {
              const retailers = [...new Set(taskGroups.map((t) => t.retailer).filter(Boolean))];
              if (!retailers.length) return null;
              return (
                <div className="flex flex-wrap gap-1 mt-1 mb-1">
                  {retailers.map((r) => {
                    const ids = taskGroups.filter((t) => t.retailer === r).map((t) => t.id);
                    const allAdded = ids.every((id) => selectedTaskGroupIds.includes(id));
                    return (
                      <button
                        key={r}
                        onClick={() => {
                          if (allAdded) {
                            setSelectedTaskGroupIds((prev) => prev.filter((id) => !ids.includes(id)));
                          } else {
                            setSelectedTaskGroupIds((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
                          }
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-mono transition-all ${allAdded ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-white/10 bg-white/5 text-gray-400 hover:border-blue-500/30 hover:text-blue-300"}`}
                      >
                        {allAdded ? "✓" : "+"} {r} <span className="text-gray-600">({ids.length})</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <Select onValueChange={addTG} value="">
              <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue placeholder="+ Add task group…" /></SelectTrigger>
              <SelectContent className="bg-[#1a1a24] border-white/10">
                {taskGroups.filter((t) => !selectedTaskGroupIds.includes(t.id)).map((t) => (
                  <SelectItem key={t.id} value={t.id} className="font-mono text-xs text-gray-100">{t.retailer ? `[${t.retailer}] ` : ""}{t.name} ({t.instance_count} inst)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTaskGroupIds.length > 0 && (
              <div className="mt-2 space-y-1">
                {selectedTaskGroupIds.map((id, i) => {
                  const tg = taskGroups.find((t) => t.id === id);
                  if (!tg) return null;
                  return (
                    <div key={id} className="flex items-center gap-2 px-2 py-1.5 bg-blue-500/5 border border-blue-500/10 rounded-sm">
                      <span className="text-[10px] font-mono text-blue-400 w-4">{i + 1}.</span>
                      <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
                      <span className="text-[10px] font-mono text-gray-600">{tg.instance_count} inst</span>
                      <div className="flex gap-0.5">
                        <button disabled={i === 0} onClick={() => moveUp(i)} className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20"><ChevronUp className="w-3 h-3" /></button>
                        <button disabled={i === selectedTaskGroupIds.length - 1} onClick={() => moveDown(i)} className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20"><ChevronDown className="w-3 h-3" /></button>
                        <button onClick={() => removeTG(id)} className="p-0.5 text-gray-600 hover:text-red-400 ml-1"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Button onClick={submit} disabled={loading || !canSubmit} className="w-full bg-violet-600 hover:bg-violet-700 font-mono text-xs">
            {loading ? "Creating..." : "Create Monitor"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Event Log Panel ───────────────────────────────────────────────────────────
function EventLogPanel() {
  const log = useDiscordLog();

  const typeStyle = {
    trigger:  { icon: Zap,           color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
    launched: { icon: Play,          color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    error:    { icon: AlertTriangle, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
    cooldown: { icon: Clock,         color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/20" },
    info:     { icon: Radio,         color: "text-gray-400",    bg: "bg-white/5 border-white/10" },
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">{log.length} events (session only — clears on reload)</p>
        {log.length > 0 && (
          <button
            onClick={() => { _discordLog.length = 0; _logSubs.forEach((cb) => cb([])); }}
            className="text-[10px] font-mono text-gray-600 hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {log.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/5 rounded-sm">
          <ScrollText className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 font-mono">No events yet</p>
          <p className="text-xs text-gray-700 font-mono mt-1">Start a monitor to begin recording events</p>
        </div>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
          {log.map((entry, i) => {
            const cfg = typeStyle[entry.type] || typeStyle.info;
            const Icon = cfg.icon;
            const timeStr = entry.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
            return (
              <div key={i} className={`flex items-start gap-2 px-2.5 py-1.5 rounded-sm border text-[10px] font-mono ${cfg.bg}`}>
                <Icon className={`w-3 h-3 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                <span className="text-gray-600 flex-shrink-0 tabular-nums">{timeStr}</span>
                <span className={`flex-shrink-0 ${cfg.color}`}>[{entry.monitor}]</span>
                {entry.channel !== "—" && <span className="text-gray-600 flex-shrink-0">#{entry.channel}</span>}
                <span className="text-gray-300 flex-1 min-w-0 truncate">{entry.msg}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DiscordMonitor() {
  const [monitors, setMonitors] = useState([]);
  const [taskGroups, setTaskGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("monitors");

  const load = async () => {
    const [m, t] = await Promise.all([
      db.DiscordMonitor.list("-created_date"),
      db.TaskGroup.list(),
    ]);
    setMonitors(Array.isArray(m) ? m : []);
    setTaskGroups(t);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const del = async (id) => {
    await db.DiscordMonitor.update(id, { is_active: false });
    await db.DiscordMonitor.delete(id);
    toast.success("Monitor deleted");
    load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" /></div>;

  const activeCount = monitors.filter((m) => m.is_active).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Radio className={`w-4 h-4 ${activeCount > 0 ? "text-violet-400 animate-pulse" : "text-gray-600"}`} />
            Discord Monitor
          </h1>
          <p className="text-xs text-gray-500 font-mono mt-1">{monitors.length} monitor{monitors.length !== 1 ? "s" : ""} · {activeCount} active</p>
        </div>
        {tab === "monitors" && <AddMonitorDialog taskGroups={taskGroups} onAdded={load} />}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/5 pb-0 overflow-x-auto">
        <button
          onClick={() => setTab("monitors")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border-b-2 transition-colors -mb-px whitespace-nowrap ${tab === "monitors" ? "border-violet-400 text-violet-300" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <Radio className="w-3 h-3" /> Monitors
        </button>
        <button
          onClick={() => setTab("log")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border-b-2 transition-colors -mb-px whitespace-nowrap ${tab === "log" ? "border-violet-400 text-violet-300" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <ScrollText className="w-3 h-3" /> Event Log
          {_discordLog.length > 0 && <span className="ml-1 px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[9px]">{_discordLog.length}</span>}
        </button>
      </div>

      {/* Monitors tab */}
      {tab === "monitors" && (
        <>
          {taskGroups.length === 0 && (
            <div className="rounded-sm border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
              <p className="text-xs font-mono text-yellow-400">No task groups found — create some in the <strong>Task Groups</strong> tab first.</p>
            </div>
          )}
          {monitors.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-white/5 rounded-sm">
              <Radio className="w-8 h-8 text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-500 font-mono">No monitors configured</p>
              <p className="text-xs text-gray-700 font-mono mt-1">Create a monitor per retailer and attach task groups for backend global triggers</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {monitors.map((m) => <MonitorCard key={m.id} monitor={m} taskGroups={taskGroups} onUpdate={load} onDelete={del} />)}
            </div>
          )}
        </>
      )}

      {/* Event Log tab */}
      {tab === "log" && <EventLogPanel />}
    </div>
  );
}
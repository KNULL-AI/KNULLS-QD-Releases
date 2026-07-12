import { useState, useEffect } from "react";
import { ListChecks, Plus, Trash2, Edit2, Play, Globe, Users, Timer, Shuffle, Copy, Clock, Bell, Flame, ShoppingBag, Zap } from "lucide-react";
import { db } from "@/lib/db";
import { launchBrowser, sendDiscordWebhook } from "@/lib/electronBridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import toast from "react-hot-toast";

// ── Shared form blank ─────────────────────────────────────────────────────────
const makeBlank = (section) => ({
  name: "",
  retailer: section === "walmart" ? "Walmart" : "",
  target_url: "https://",
  instance_count: 5,
  delay_ms: 0,
  proxy_group_id: "",
  user_agent: "",
  rotation_mode: "round_robin",
  session_profile_id: "",
  warmup_minutes: 0,
  webhook_url: "",
  browser: "chrome",
});

// ── Task Group Form ───────────────────────────────────────────────────────────
function TaskGroupForm({ initial, proxyGroups, profiles, onSave, onCancel, loading, section }) {
  const [form, setForm] = useState(initial || makeBlank(section));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = () => {
    const pg = proxyGroups.find((g) => g.id === form.proxy_group_id);
    onSave({ ...form, proxy_group_name: pg?.name || "" });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-xs text-gray-400 font-mono">Task Group Name *</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Supreme Drop" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-gray-400 font-mono">Target URL *</Label>
          <Input value={form.target_url} onChange={(e) => set("target_url", e.target.value)} placeholder="https://example.com/product" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono">Instances</Label>
          <Input type="number" min="1" max="100" value={form.instance_count} onChange={(e) => set("instance_count", Number(e.target.value))} className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono">Delay between launches (ms)</Label>
          <Input type="number" min="0" value={form.delay_ms} onChange={(e) => set("delay_ms", Number(e.target.value))} placeholder="0 = no delay" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono">Proxy Group</Label>
          <Select value={form.proxy_group_id || "none"} onValueChange={(v) => set("proxy_group_id", v === "none" ? "" : v)}>
            <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent className="bg-[#1a1a24] border-white/10">
              <SelectItem value="none" className="font-mono text-xs text-gray-100">None (direct)</SelectItem>
              {proxyGroups.map((g) => <SelectItem key={g.id} value={g.id} className="font-mono text-xs text-gray-100">{g.name} ({(g.proxy_ids || []).length})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono">Rotation Mode</Label>
          <Select value={form.rotation_mode} onValueChange={(v) => set("rotation_mode", v)}>
            <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#1a1a24] border-white/10">
              <SelectItem value="round_robin" className="font-mono text-xs text-gray-100">Round Robin</SelectItem>
              <SelectItem value="random" className="font-mono text-xs text-gray-100">Random</SelectItem>
              <SelectItem value="sticky" className="font-mono text-xs text-gray-100">Sticky</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono">Session Profile</Label>
          <Select value={form.session_profile_id || "none"} onValueChange={(v) => set("session_profile_id", v === "none" ? "" : v)}>
            <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent className="bg-[#1a1a24] border-white/10">
              <SelectItem value="none" className="font-mono text-xs text-gray-100">None</SelectItem>
              {profiles.map((p) => <SelectItem key={p.id} value={p.id} className="font-mono text-xs text-gray-100">{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono flex items-center gap-1"><Bell className="w-3 h-3 text-blue-400" /> Discord Webhook <span className="text-gray-600">(opt)</span></Label>
          <Input value={form.webhook_url || ""} onChange={(e) => set("webhook_url", e.target.value)} placeholder="https://discord.com/api/webhooks/..." className="bg-white/5 border-white/10 font-mono text-xs mt-1" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-gray-400 font-mono">User Agent <span className="text-gray-600">(optional)</span></Label>
          <Input value={form.user_agent} onChange={(e) => set("user_agent", e.target.value)} placeholder="leave blank for default" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
        </div>

        {/* Warmup — Walmart only */}
        {section === "walmart" && (
          <div>
            <Label className="text-xs text-gray-400 font-mono flex items-center gap-1"><Flame className="w-3 h-3 text-orange-400" /> Warmup (minutes)</Label>
            <Input type="number" min="0" value={form.warmup_minutes || 0} onChange={(e) => set("warmup_minutes", Number(e.target.value))} placeholder="0 = off" className="bg-white/5 border-white/10 font-mono text-xs mt-1" />
          </div>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} disabled={loading || !form.name || !form.target_url} className="flex-1 bg-blue-600 hover:bg-blue-700 font-mono text-xs">
          {loading ? "Saving..." : "Save Task Group"}
        </Button>
        {onCancel && <Button onClick={onCancel} variant="outline" className="border-white/10 text-gray-400 font-mono text-xs">Cancel</Button>}
      </div>
    </div>
  );
}

// ── Run logic ─────────────────────────────────────────────────────────────────
async function runTaskGroupNow(group) {
  let proxies = [];
  if (group.proxy_group_id) {
    const pg = await db.ProxyGroup.get(group.proxy_group_id).catch(() => null);
    if (pg?.proxy_ids?.length) {
      const fetched = await Promise.all(pg.proxy_ids.map((id) => db.Proxy.get(id).catch(() => null)));
      proxies = fetched.filter(Boolean);
    }
  }
  let profile = null;
  if (group.session_profile_id) profile = await db.SessionProfile.get(group.session_profile_id).catch(() => null);

  const count = group.instance_count || 1;
  const mode = group.rotation_mode || "round_robin";
  const now = new Date().toISOString();
  const assignedProxies = Array.from({ length: count }, (_, i) => {
    if (!proxies.length) return null;
    if (mode === "random") return proxies[Math.floor(Math.random() * proxies.length)];
    return proxies[i % proxies.length];
  });

  const sessions = await db.BrowserSession.bulkCreate(
    assignedProxies.map((proxy, i) => ({
      name: `[RUN] ${group.name} #${i + 1}`,
      target_url: group.target_url,
      proxy_id: proxy?.id || null,
      proxy_label: proxy ? `${proxy.host}:${proxy.port}` : "No proxy",
      status: "running",
      rotation_mode: mode,
      user_agent: group.user_agent || profile?.user_agent || null,
      browser: group.browser || "chrome",
      started_at: now,
    }))
  );

  for (let i = 0; i < sessions.length; i++) {
    launchBrowser({ sessionId: sessions[i].id, url: group.target_url, proxy: assignedProxies[i], userAgent: group.user_agent || profile?.user_agent || null, browser: group.browser || "chrome", profile, manualOpen: false });
    if (group.delay_ms > 0 && i < sessions.length - 1) await new Promise((r) => setTimeout(r, group.delay_ms));
  }

  await db.ActivityEvent.create({ type: "task_group_run", message: `Task group "${group.name}" fired — ${count} instance${count !== 1 ? "s" : ""} launched` });
  if (group.webhook_url) sendDiscordWebhook(group.webhook_url, `🚀 **${group.name}** triggered — ${count} instance${count !== 1 ? "s" : ""} launched`).catch(() => {});
}

// ── Task Group Card ───────────────────────────────────────────────────────────
function TaskGroupCard({ group, proxyGroups, profiles, onUpdate, onDelete, onDuplicate, section }) {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(group.target_url);

  useEffect(() => { if (!editingUrl) setUrlDraft(group.target_url); }, [group.target_url, editingUrl]);

  const save = async (data) => {
    setLoading(true);
    await db.TaskGroup.update(group.id, data);
    setLoading(false);
    setEditing(false);
    onUpdate();
  };

  const handleRunNow = async () => {
    setRunning(true);
    await runTaskGroupNow(group);
    toast.success(`🚀 "${group.name}" — ${group.instance_count} instance${group.instance_count !== 1 ? "s" : ""} launched`);
    setRunning(false);
  };

  return (
    <div className="relative border border-white/5 bg-[#08080f] rounded-sm p-4 space-y-3 hover:border-blue-500/15 transition-colors">
      <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-blue-500/20" />
      {!editing ? (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-sm text-gray-100">{group.name}</p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={handleRunNow} disabled={running} title="Run now"
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors">
                <Play className="w-3 h-3" />{running ? "…" : "Run"}
              </button>
              <button onClick={() => onDuplicate(group)} title="Duplicate" className="p-1.5 text-gray-600 hover:text-blue-300 hover:bg-blue-500/10 rounded"><Copy className="w-3.5 h-3.5" /></button>
              <button onClick={() => setEditing(true)} className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-white/5 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
              <button onClick={() => onDelete(group.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono col-span-2">
              <Globe className="w-3 h-3 text-blue-400 flex-shrink-0" />
              {editingUrl ? (
                <input autoFocus value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)}
                  onBlur={async () => {
                    if (urlDraft && urlDraft !== group.target_url) { await db.TaskGroup.update(group.id, { target_url: urlDraft }); onUpdate(); toast.success("URL updated"); }
                    setEditingUrl(false);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setUrlDraft(group.target_url); setEditingUrl(false); } }}
                  className="flex-1 bg-white/5 border border-blue-500/40 rounded px-1.5 py-0.5 text-[10px] font-mono text-blue-200 outline-none min-w-0" />
              ) : (
                <span className="text-gray-500 truncate cursor-pointer hover:text-blue-300 transition-colors" title="Click to edit URL" onClick={() => { setUrlDraft(group.target_url); setEditingUrl(true); }}>{group.target_url}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-500"><Users className="w-3 h-3 text-blue-400" />{group.instance_count} instances</div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-500"><Timer className="w-3 h-3" />{group.delay_ms || 0}ms delay</div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-500"><Shuffle className="w-3 h-3" />{group.rotation_mode}</div>
            {section === "walmart" && group.warmup_minutes > 0 && <div className="flex items-center gap-1.5 text-[10px] font-mono text-orange-400"><Flame className="w-3 h-3" />{group.warmup_minutes}m warmup</div>}
            {group.webhook_url && <div className="flex items-center gap-1.5 text-[10px] font-mono text-blue-400"><Bell className="w-3 h-3" />Webhook</div>}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-white/5 mt-1">
            <span className="text-[10px] font-mono text-gray-600 flex-shrink-0">⬡ Proxy Group</span>
            <Select value={group.proxy_group_id || "none"} onValueChange={async (v) => {
              const pg = proxyGroups.find((g) => g.id === v);
              await db.TaskGroup.update(group.id, { proxy_group_id: v === "none" ? "" : v, proxy_group_name: pg?.name || "" });
              onUpdate();
            }}>
              <SelectTrigger className="h-6 text-[10px] font-mono bg-white/5 border-white/10 text-emerald-400 px-2 flex-1">
                <SelectValue placeholder="None (direct connection)" />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a24] border-white/10">
                <SelectItem value="none" className="font-mono text-xs text-gray-100">None (direct connection)</SelectItem>
                {proxyGroups.map((pg) => <SelectItem key={pg.id} value={pg.id} className="font-mono text-xs text-gray-100">{pg.name} ({(pg.proxy_ids || []).length} proxies)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : (
        <TaskGroupForm initial={group} proxyGroups={proxyGroups} profiles={profiles} onSave={save} onCancel={() => setEditing(false)} loading={loading} section={section} />
      )}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
function TaskGroupSection({ title, icon: SectionIcon, accentColor, section, groups, proxyGroups, profiles, onUpdate, onDelete, onDuplicate }) {
  const Icon = SectionIcon;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const create = async (data) => {
    setLoading(true);
    await db.TaskGroup.create({ ...data, retailer: section === "walmart" ? "Walmart" : data.retailer });
    setLoading(false);
    setDialogOpen(false);
    toast.success("Task group created");
    onUpdate();
  };

  const deleteSelected = async () => {
    await Promise.all([...selected].map((id) => db.TaskGroup.delete(id)));
    toast.success(`${selected.size} deleted`);
    setSelected(new Set());
    onUpdate();
  };

  const toggleSelect = (id) => setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const accentBtn = section === "walmart"
    ? "bg-orange-600 hover:bg-orange-700"
    : "bg-blue-600 hover:bg-blue-700";

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${accentColor}`} />
          <h2 className={`font-mono text-sm font-semibold ${accentColor}`}>{title}</h2>
          <span className="text-[10px] font-mono text-gray-600">{groups.length} group{groups.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={deleteSelected} className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 font-mono text-[10px]">
              <Trash2 className="w-3 h-3" /> Delete {selected.size}
            </button>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className={`${accentBtn} text-white font-mono text-xs gap-1.5 h-8`}><Plus className="w-3.5 h-3.5" /> New Task Group</Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0d0d16] border-white/10 text-gray-100 max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle className={`font-mono text-sm ${accentColor}`}>New Task Group — {title}</DialogTitle></DialogHeader>
              <div className="mt-3">
                <TaskGroupForm proxyGroups={proxyGroups} profiles={profiles} onSave={create} loading={loading} section={section} />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-white/5 rounded-sm">
          <Icon className="w-6 h-6 text-gray-700 mx-auto mb-2" />
          <p className="text-xs text-gray-600 font-mono">No {title} task groups yet</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(selected.size === groups.length ? new Set() : new Set(groups.map((g) => g.id)))}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm border border-white/10 bg-white/5 text-gray-400 hover:text-gray-200 font-mono text-[10px]">
              {selected.size === groups.length ? "✓ Deselect All" : "Select All"}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.id} className="relative">
                <button onClick={() => toggleSelect(g.id)}
                  className={`absolute top-2 right-2 z-10 w-4 h-4 rounded-sm border transition-all ${selected.has(g.id) ? "bg-red-500 border-red-500" : "bg-white/5 border-white/20 hover:border-red-400"}`}>
                  {selected.has(g.id) && <span className="text-white text-[9px] leading-none flex items-center justify-center w-full h-full">✓</span>}
                </button>
                <TaskGroupCard group={g} proxyGroups={proxyGroups} profiles={profiles} onUpdate={onUpdate} onDelete={onDelete} onDuplicate={onDuplicate} section={section} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TaskGroups() {
  const [groups, setGroups] = useState([]);
  const [proxyGroups, setProxyGroups] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);

  const load = async () => {
    const [tg, pg, sp] = await Promise.all([
      db.TaskGroup.list("-created_date"),
      db.ProxyGroup.list(),
      db.SessionProfile.list(),
    ]);
    setGroups(tg);
    setProxyGroups(pg);
    setProfiles(sp);
    setPageLoading(false);
  };

  const duplicate = async (group) => {
    const { id, created_date, updated_date, created_by_id, ...rest } = group;
    await db.TaskGroup.create({ ...rest, name: `${rest.name} (copy)` });
    toast.success("Duplicated");
    load();
  };

  const del = async (id) => {
    await db.TaskGroup.delete(id);
    toast.success("Deleted");
    load();
  };

  useEffect(() => { load(); }, []);

  if (pageLoading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin" /></div>;

  const walmartGroups = groups.filter((g) => (g.retailer || "").toLowerCase() === "walmart");
  const ungrouped = groups.filter((g) => !g.retailer);
  const otherGroups = groups.filter((g) => g.retailer && (g.retailer || "").toLowerCase() !== "walmart");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-mono text-lg font-semibold text-gray-100 flex items-center gap-2"><ListChecks className="w-4 h-4 text-blue-400" /> Task Groups</h1>
        <p className="text-xs text-gray-500 font-mono mt-1">{groups.length} total · organized by retailer</p>
      </div>

      {/* Walmart section */}
      <TaskGroupSection
        title="Walmart"
        icon={ShoppingBag}
        accentColor="text-orange-400"
        section="walmart"
        groups={walmartGroups}
        proxyGroups={proxyGroups}
        profiles={profiles}
        onUpdate={load}
        onDelete={del}
        onDuplicate={duplicate}
      />

      <div className="border-t border-white/5" />

      {/* Costco / PokemonCenter / Ungrouped section */}
      <TaskGroupSection
        title="Costco / PokemonCenter"
        icon={Zap}
        accentColor="text-blue-400"
        section="other"
        groups={[...otherGroups, ...ungrouped]}
        proxyGroups={proxyGroups}
        profiles={profiles}
        onUpdate={load}
        onDelete={del}
        onDuplicate={duplicate}
      />
    </div>
  );
}
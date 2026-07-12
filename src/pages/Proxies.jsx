import { useState, useEffect } from "react";
import { Activity, Trash2, Filter, ArrowUpDown, CheckSquare, Layers, X, ChevronDown, ChevronRight, FolderOpen, Zap } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AddProxyDialog from "@/components/proxy/AddProxyDialog";
import AddProxyToGroupDialog from "@/components/proxy/AddProxyToGroupDialog";
import ProxyRow from "@/components/proxy/ProxyRow";
import ProxyHealthChart from "@/components/proxy/ProxyHealthChart";
import ProxyDiagnosticDialog from "@/components/proxy/ProxyDiagnosticDialog";
import toast from "react-hot-toast";
import { checkProxy } from "@/lib/electronBridge";

export default function Proxies() {
  const [proxies, setProxies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [checkingAll, setCheckingAll] = useState(false);
  const [sortByLatency, setSortByLatency] = useState(false);
  // Selection + group assignment
  const [selected, setSelected] = useState(new Set());
  const [proxyGroups, setProxyGroups] = useState([]);
  const [assignGroupId, setAssignGroupId] = useState("none");
  const [newGroupName, setNewGroupName] = useState("");
  const [assigning, setAssigning] = useState(false);

  const loadProxies = async () => {
    try {
      const data = await db.Proxy.list("-created_date", 200);
      setProxies(data);
    } catch (err) {
      toast.error("Failed to load proxies");
    }
    setLoading(false);
  };

  useEffect(() => { loadProxies(); }, []);

  const loadGroups = () => db.ProxyGroup.list().then(setProxyGroups);
  useEffect(() => { loadGroups(); }, []);

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const toggleGroupExpand = (id) => setExpandedGroups((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const [checkingGroup, setCheckingGroup] = useState(null); // group id being checked

  const handleCheckGroup = async (e, group, groupProxies) => {
    e.stopPropagation();
    setCheckingGroup(group.id);
    await Promise.all(groupProxies.map(async (proxy) => {
      const result = await checkProxy(proxy);
      await db.Proxy.update(proxy.id, {
        status: result.ok ? "healthy" : "unhealthy",
        response_time_ms: result.ok ? result.responseTime : null,
        last_checked: new Date().toISOString(),
        fail_count: result.ok ? 0 : (proxy.fail_count || 0) + 1,
      });
    }));
    toast.success(`Checked ${groupProxies.length} proxies in "${group.name}"`);
    setCheckingGroup(null);
    loadProxies();
  };

  const handleAssignToGroup = async () => {
    if (!selected.size) return;
    setAssigning(true);
    const ids = [...selected];

    if (assignGroupId === "new") {
      if (!newGroupName.trim()) { setAssigning(false); return; }
      await db.ProxyGroup.create({ name: newGroupName.trim(), proxy_ids: ids });
      toast.success(`Created group "${newGroupName.trim()}" with ${ids.length} proxies`);
    } else if (assignGroupId !== "none") {
      const group = proxyGroups.find((g) => g.id === assignGroupId);
      if (group) {
        const merged = [...new Set([...(group.proxy_ids || []), ...ids])];
        await db.ProxyGroup.update(group.id, { proxy_ids: merged });
        toast.success(`Added ${ids.length} proxies to "${group.name}"`);
      }
    }

    setSelected(new Set());
    setAssignGroupId("none");
    setNewGroupName("");
    setAssigning(false);
    loadGroups();
  };

  // Proxies already assigned to any group are shown in Proxy Groups page, not here
  const groupedIds = new Set(proxyGroups.flatMap((g) => g.proxy_ids || []));
  const ungroupedProxies = proxies.filter((p) => !groupedIds.has(p.id));

  const filtered = (filter === "all" ? ungroupedProxies : ungroupedProxies.filter((p) => p.status === filter))
    .slice()
    .sort((a, b) => sortByLatency
      ? ((a.response_time_ms ?? Infinity) - (b.response_time_ms ?? Infinity))
      : 0);

  const handleCheckAll = async () => {
    setCheckingAll(true);
    const activeProxies = proxies.filter((p) => p.is_active);
    await Promise.all(
      activeProxies.map(async (proxy) => {
        const result = await checkProxy(proxy);
        await db.Proxy.update(proxy.id, {
          status: result.ok ? "healthy" : "unhealthy",
          response_time_ms: result.ok ? result.responseTime : null,
          last_checked: new Date().toISOString(),
          fail_count: result.ok ? 0 : (proxy.fail_count || 0) + 1,
        });
      })
    );
    toast.success(`Checked ${activeProxies.length} proxies`);
    setCheckingAll(false);
    loadProxies();
  };

  const handleDeleteUnhealthy = async () => {
    const unhealthy = proxies.filter((p) => p.status === "unhealthy");
    if (unhealthy.length === 0) return;
    await Promise.all(unhealthy.map((p) => db.Proxy.delete(p.id)));
    toast.success(`Removed ${unhealthy.length} unhealthy proxies`);
    loadProxies();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100">Proxy Pool</h1>
          <p className="text-xs text-gray-500 font-mono mt-1">{proxies.length} proxies · {proxies.filter((p) => p.status === "healthy").length} healthy · {groupedIds.size} in groups</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <AddProxyDialog onAdded={loadProxies} />
          <Button
            onClick={handleCheckAll}
            disabled={checkingAll || proxies.length === 0}
            variant="outline"
            className="bg-transparent border-white/10 text-gray-400 hover:text-emerald-400 hover:border-emerald-500/30 font-mono text-xs gap-2"
          >
            <Activity className={`w-3.5 h-3.5 ${checkingAll ? "animate-pulse" : ""}`} />
            {checkingAll ? "Checking..." : "Check All"}
          </Button>
          <ProxyDiagnosticDialog proxies={selected.size > 0 ? proxies.filter((p) => selected.has(p.id)) : proxies} />
          <Button
            onClick={handleDeleteUnhealthy}
            disabled={proxies.filter((p) => p.status === "unhealthy").length === 0}
            variant="outline"
            className="bg-transparent border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/30 font-mono text-xs gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" /> Purge Dead
          </Button>
        </div>
      </div>

      {/* Health chart */}
      {proxies.some((p) => p.status !== "untested") && (
        <ProxyHealthChart proxies={proxies} />
      )}

      {/* Filter + Sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-gray-600" />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-36 bg-white/5 border-white/10 font-mono text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#1a1a24] border-white/10">
            <SelectItem value="all" className="font-mono text-xs text-gray-100">All</SelectItem>
            <SelectItem value="healthy" className="font-mono text-xs text-gray-100">Healthy</SelectItem>
            <SelectItem value="unhealthy" className="font-mono text-xs text-gray-100">Unhealthy</SelectItem>
            <SelectItem value="untested" className="font-mono text-xs text-gray-100">Untested</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => setSortByLatency((v) => !v)}
          className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border transition-colors ${sortByLatency ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
        >
          <ArrowUpDown className="w-3 h-3" /> Sort by Speed
        </button>
        {filtered.length > 0 && (
          <button
            onClick={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id)))}
            className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border border-white/10 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <CheckSquare className="w-3 h-3" />
            {selected.size === filtered.length ? "Deselect All" : "Select All"}
          </button>
        )}
      </div>

      {/* Group assignment action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-sm border border-emerald-500/30 bg-emerald-500/5">
          <Layers className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span className="text-[11px] font-mono text-emerald-400 flex-shrink-0">{selected.size} selected</span>
          <Select value={assignGroupId} onValueChange={setAssignGroupId}>
            <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs h-7 w-48"><SelectValue placeholder="Assign to group…" /></SelectTrigger>
            <SelectContent className="bg-[#1a1a24] border-white/10">
              <SelectItem value="none" className="font-mono text-xs text-gray-100">Choose group…</SelectItem>
              <SelectItem value="new" className="font-mono text-xs text-emerald-400">+ Create new group</SelectItem>
              {proxyGroups.map((g) => <SelectItem key={g.id} value={g.id} className="font-mono text-xs text-gray-100">{g.name} ({(g.proxy_ids || []).length})</SelectItem>)}
            </SelectContent>
          </Select>
          {assignGroupId === "new" && (
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="New group name…"
              className="bg-white/5 border-white/10 font-mono text-xs h-7 w-40"
            />
          )}
          <Button
            onClick={handleAssignToGroup}
            disabled={assigning || assignGroupId === "none" || (assignGroupId === "new" && !newGroupName.trim())}
            className="bg-emerald-600 hover:bg-emerald-700 font-mono text-xs h-7 px-3"
          >
            {assigning ? "Saving…" : "Assign"}
          </Button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-gray-600 hover:text-gray-300 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Proxy list — groups as folder cards, then ungrouped */}
      {proxies.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 font-mono text-sm">No proxies added yet. Click "Add Proxies" to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Group folder cards */}
          {proxyGroups.map((group) => {
            const groupProxies = proxies.filter((p) => (group.proxy_ids || []).includes(p.id));
            if (groupProxies.length === 0) return null;
            const isOpen = expandedGroups.has(group.id);
            const healthyCount = groupProxies.filter((p) => p.status === "healthy").length;
            const avgLatency = groupProxies.filter((p) => p.response_time_ms).reduce((sum, p, _, arr) => sum + p.response_time_ms / arr.length, 0);
            return (
              <div key={group.id} className="border border-white/10 rounded-sm overflow-hidden">
                {/* Folder header — click to expand */}
                <div className="flex items-center gap-1 px-3 py-2.5 bg-white/[0.03]">
                  {/* Select all in group */}
                  <input
                    type="checkbox"
                    checked={groupProxies.length > 0 && groupProxies.every((p) => selected.has(p.id))}
                    onChange={(e) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        groupProxies.forEach((p) => e.target.checked ? next.add(p.id) : next.delete(p.id));
                        return next;
                      });
                    }}
                    className="w-3.5 h-3.5 accent-emerald-500 flex-shrink-0 cursor-pointer"
                    title="Select all in group"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={() => toggleGroupExpand(group.id)}
                    className="flex-1 flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
                  >
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />}
                    <FolderOpen className="w-3.5 h-3.5 text-emerald-400/70 flex-shrink-0" />
                    <span className="font-mono text-sm text-gray-100 font-medium">{group.name}</span>
                    <span className="font-mono text-xs text-gray-500 ml-1">{groupProxies.length} proxies</span>
                    <span className="font-mono text-xs text-emerald-400 ml-auto">{healthyCount} healthy</span>
                    {avgLatency > 0 && <span className="font-mono text-xs text-gray-500 ml-3">{Math.round(avgLatency)}ms avg</span>}
                  </button>
                  {/* Health check button */}
                  <button
                    onClick={(e) => handleCheckGroup(e, group, groupProxies)}
                    disabled={checkingGroup === group.id}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors flex-shrink-0"
                    title="Health check all in group"
                  >
                    <Zap className={`w-3 h-3 ${checkingGroup === group.id ? "animate-pulse" : ""}`} />
                    {checkingGroup === group.id ? "Checking…" : "Check"}
                  </button>
                  <div onClick={(e) => e.stopPropagation()}>
                    <AddProxyToGroupDialog group={group} onAdded={loadProxies} />
                  </div>
                </div>
                {/* Expanded proxy rows */}
                {isOpen && (
                  <div className="divide-y divide-white/5 border-t border-white/5">
                    {groupProxies.map((proxy) => (
                      <div key={proxy.id} className="flex items-center gap-2 pl-8 pr-2">
                        <input
                          type="checkbox"
                          checked={selected.has(proxy.id)}
                          onChange={() => toggleSelect(proxy.id)}
                          className="w-3.5 h-3.5 accent-emerald-500 flex-shrink-0 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <ProxyRow proxy={proxy} onUpdate={loadProxies} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ungrouped proxies */}
          {filtered.length > 0 && (
            <>
              {proxyGroups.some((g) => (g.proxy_ids || []).length > 0) && (
                <p className="text-[10px] font-mono text-gray-600 pt-1">UNGROUPED</p>
              )}
              {filtered.map((proxy) => (
                <div key={proxy.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(proxy.id)}
                    onChange={() => toggleSelect(proxy.id)}
                    className="w-3.5 h-3.5 accent-emerald-500 flex-shrink-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <ProxyRow proxy={proxy} onUpdate={loadProxies} />
                  </div>
                </div>
              ))}
            </>
          )}

          {/* All proxies are grouped and filter has no ungrouped matches */}
          {filtered.length === 0 && ungroupedProxies.length === 0 && proxies.length > 0 && (
            <p className="text-center text-gray-600 font-mono text-xs py-4">All proxies are organized into groups above.</p>
          )}
        </div>
      )}
    </div>
  );
}
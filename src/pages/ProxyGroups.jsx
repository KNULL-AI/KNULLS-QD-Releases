import { useState, useEffect } from "react";
import { Layers, Plus, Trash2, Edit2, Check, X, Zap } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

function ProxyGroupRow({ group, allProxies, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [selected, setSelected] = useState(group.proxy_ids || []);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState(null); // { healthy, unhealthy }

  const runHealthCheck = async () => {
    const ids = group.proxy_ids || [];
    if (ids.length === 0) { toast.error("No proxies in this group"); return; }
    setTesting(true);
    setTestResults(null);
    const proxiesInGroup = allProxies.filter((p) => ids.includes(p.id));
    let healthy = 0, unhealthy = 0;
    await Promise.all(proxiesInGroup.map(async (p) => {
      const start = Date.now();
      let ok = false;
      if (window.electronAPI) {
        const res = await window.electronAPI.checkProxy({ host: p.host, port: p.port, protocol: p.protocol, username: p.username, password: p.password });
        ok = res?.ok === true;
      }
      const elapsed = Date.now() - start;
      if (ok) { healthy++; } else { unhealthy++; }
      await db.Proxy.update(p.id, { status: ok ? "healthy" : "unhealthy", response_time_ms: ok ? elapsed : null, last_checked: new Date().toISOString() });
    }));
    setTestResults({ healthy, unhealthy });
    setTesting(false);
    toast.success(`Group tested: ${healthy} healthy, ${unhealthy} unhealthy`);
    onUpdate();
  };

  const toggle = (id) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const save = async () => {
    await db.ProxyGroup.update(group.id, { name, proxy_ids: selected });
    setEditing(false);
    onUpdate();
  };

  const cancel = () => {
    setName(group.name);
    setSelected(group.proxy_ids || []);
    setEditing(false);
  };

  return (
    <div className="border border-white/5 bg-[#08080f] rounded-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        {editing ? (
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm h-7 w-48" />
        ) : (
          <div>
            <p className="font-mono text-sm text-gray-100">{group.name}</p>
            <p className="text-[10px] font-mono text-gray-600">{(group.proxy_ids || []).length} proxies</p>
          </div>
        )}
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button onClick={save} className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded"><Check className="w-3.5 h-3.5" /></button>
              <button onClick={cancel} className="p-1.5 text-gray-500 hover:bg-white/5 rounded"><X className="w-3.5 h-3.5" /></button>
            </>
          ) : (
            <>
              <button onClick={runHealthCheck} disabled={testing} title="Test all proxies in group"
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors">
                <Zap className={`w-3 h-3 ${testing ? "animate-pulse" : ""}`} />{testing ? "Testing…" : "Test All"}
              </button>
              <button onClick={() => setEditing(true)} className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
              <button onClick={() => onDelete(group.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-2">Select proxies</p>
          {allProxies.map((p) => {
            const isIn = selected.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-sm text-xs font-mono flex items-center gap-2 transition-colors ${
                  isIn ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" : "bg-white/[0.02] border border-white/5 text-gray-400 hover:border-white/10"
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isIn ? "bg-emerald-400" : "bg-gray-700"}`} />
                {p.host}:{p.port} {p.label ? `(${p.label})` : ""} — <span className={p.status === "healthy" ? "text-emerald-500" : "text-gray-600"}>{p.status}</span>
              </button>
            );
          })}
          {allProxies.length === 0 && <p className="text-[10px] text-gray-600 font-mono">No proxies found. Add some in Proxy Pool first.</p>}
        </div>
      )}

      {testResults && (
        <div className="flex items-center gap-3 text-[10px] font-mono px-2 py-1.5 bg-white/[0.02] border border-white/5 rounded-sm">
          <span className="text-emerald-400">✓ {testResults.healthy} healthy</span>
          <span className="text-red-400">✗ {testResults.unhealthy} unhealthy</span>
        </div>
      )}
      {!editing && (group.proxy_ids || []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(group.proxy_ids || []).map((id) => {
            const p = allProxies.find((x) => x.id === id);
            return p ? (
              <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 bg-white/5 border border-white/5 text-gray-400 rounded-sm">{p.host}:{p.port}</span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

export default function ProxyGroups() {
  const [groups, setGroups] = useState([]);
  const [allProxies, setAllProxies] = useState([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);


  const load = async () => {
    const [g, p] = await Promise.all([
      db.ProxyGroup.list("-created_date"),
      db.Proxy.list(),
    ]);
    setGroups(g);
    setAllProxies(p);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    await db.ProxyGroup.create({ name: newName.trim(), proxy_ids: [] });
    setNewName("");
    load();
  };

  const del = async (id) => {
    await db.ProxyGroup.delete(id);
    toast.success("Proxy group deleted");
    load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100 flex items-center gap-2"><Layers className="w-4 h-4 text-emerald-400" /> Proxy Groups</h1>
          <p className="text-xs text-gray-500 font-mono mt-1">{groups.length} group{groups.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="New group name..." className="bg-white/5 border-white/10 font-mono text-sm h-9 w-48" />
          <Button onClick={create} disabled={!newName.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs gap-1.5 h-9"><Plus className="w-3.5 h-3.5" /> Create</Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/5 rounded-sm">
          <Layers className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 font-mono">No proxy groups yet</p>
          <p className="text-xs text-gray-700 font-mono mt-1">Create a group and assign proxies to it</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => <ProxyGroupRow key={g.id} group={g} allProxies={allProxies} onUpdate={load} onDelete={del} />)}
        </div>
      )}
    </div>
  );
}
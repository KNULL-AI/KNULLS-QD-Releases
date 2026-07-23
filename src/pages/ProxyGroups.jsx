import { useState, useEffect, useRef } from "react";
import { Layers, Plus, Trash2, Edit2, Check, X, Zap, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import toast from "react-hot-toast";

function parseProxyLines(text) {
  const lines = text.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    let proto = "HTTP", host = "", port = "", username = "", password = "";
    let clean = line;
    const protoMatch = clean.match(/^(https?|socks[45]):\/\//i);
    if (protoMatch) {
      proto = protoMatch[1].toUpperCase();
      clean = clean.slice(protoMatch[0].length);
    }
    const authMatch = clean.match(/^([^:@]+):([^@]+)@/);
    if (authMatch) {
      username = authMatch[1];
      password = authMatch[2];
      clean = clean.slice(authMatch[0].length);
    }
    const parts = clean.split(":");
    host = parts[0];
    port = parts[1] || "8080";
    if (!username && parts[2]) username = parts[2];
    if (!password && parts[3]) password = parts[3];
    return { host, port: Number(port), protocol: proto, username, password };
  });
}

function serializeProxyLine(proxy) {
  const protocol = String(proxy.protocol || "HTTP").toLowerCase();
  if (proxy.username || proxy.password) {
    const username = proxy.username || "";
    const password = proxy.password || "";
    return `${protocol}://${username}:${password}@${proxy.host}:${proxy.port}`;
  }
  return `${protocol}://${proxy.host}:${proxy.port}`;
}

function proxyKey(proxy) {
  return [proxy.host, proxy.port, String(proxy.protocol || "HTTP").toUpperCase(), proxy.username || "", proxy.password || ""].join("|");
}

function ProxyGroupRow({ group, allProxies, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [selected, setSelected] = useState(group.proxy_ids || []);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [editingList, setEditingList] = useState(false);
  const [listText, setListText] = useState("");
  const [savingList, setSavingList] = useState(false);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [replacePreview, setReplacePreview] = useState(null);
  const fileRef = useRef(null);

  const groupProxyIds = group.proxy_ids || [];
  const groupProxies = allProxies.filter((proxy) => groupProxyIds.includes(proxy.id));

  const runHealthCheck = async () => {
    const ids = groupProxyIds;
    if (ids.length === 0) { toast.error("No proxies in this group"); return; }
    setTesting(true);
    setTestResults(null);
    const proxiesInGroup = allProxies.filter((proxy) => ids.includes(proxy.id));
    let healthy = 0, unhealthy = 0;
    await Promise.all(proxiesInGroup.map(async (proxy) => {
      const start = Date.now();
      let ok = false;
      if (window.electronAPI) {
        const res = await window.electronAPI.checkProxy({ host: proxy.host, port: proxy.port, protocol: proxy.protocol, username: proxy.username, password: proxy.password });
        ok = res?.ok === true;
      }
      const elapsed = Date.now() - start;
      if (ok) { healthy++; } else { unhealthy++; }
      await db.Proxy.update(proxy.id, { status: ok ? "healthy" : "unhealthy", response_time_ms: ok ? elapsed : null, last_checked: new Date().toISOString() });
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
    setSelected(groupProxyIds);
    setEditing(false);
  };

  const beginEditList = () => {
    setListText(groupProxies.map(serializeProxyLine).join("\n"));
    setEditingList(true);
  };

  const loadListFromFile = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      setListText(String(event.target?.result || ""));
      setEditingList(true);
    };
    reader.readAsText(file);
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      loadListFromFile(file);
      event.target.value = "";
    }
  };

  const cancelEditList = () => {
    setListText("");
    setEditingList(false);
    setSavingList(false);
  };

  const saveList = async () => {
    if (!listText.trim()) {
      toast.error("Paste at least one proxy line");
      return;
    }

    const lineCount = listText.trim().split("\n").map((line) => line.trim()).filter(Boolean).length;
    setReplacePreview({ lineCount });
    setConfirmReplaceOpen(true);
  };

  const commitList = async () => {
    if (!listText.trim()) {
      toast.error("Paste at least one proxy line");
      return;
    }

    setSavingList(true);
    const parsed = parseProxyLines(listText);
    const existingByKey = new Map(allProxies.map((proxy) => [proxyKey(proxy), proxy]));
    const nextIds = [];

    for (const proxy of parsed) {
      const key = proxyKey(proxy);
      const existing = existingByKey.get(key);
      if (existing) {
        nextIds.push(existing.id);
        continue;
      }

      const created = await db.Proxy.create({
        ...proxy,
        status: "untested",
        is_active: true,
        fail_count: 0,
      });
      existingByKey.set(key, created);
      nextIds.push(created.id);
    }

    const previousIds = groupProxyIds;
    const removedIds = previousIds.filter((id) => !nextIds.includes(id));

    await db.ProxyGroup.update(group.id, { proxy_ids: nextIds });

    if (removedIds.length > 0) {
      const remainingGroups = await db.ProxyGroup.list();
      await Promise.all(removedIds.map(async (id) => {
        const stillUsed = remainingGroups.some((otherGroup) => otherGroup.id !== group.id && (otherGroup.proxy_ids || []).includes(id));
        if (!stillUsed) {
          await db.Proxy.delete(id);
        }
      }));
    }

    setSelected((prev) => {
      const next = new Set(prev);
      removedIds.forEach((id) => next.delete(id));
      return next;
    });

    toast.success(`Updated "${group.name}" with ${nextIds.length} proxies`);
    setEditingList(false);
    setSavingList(false);
    setConfirmReplaceOpen(false);
    setReplacePreview(null);
    onUpdate();
  };

  return (
    <div className="border border-white/5 bg-[#08080f] rounded-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        {editing ? (
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm h-7 w-48" />
        ) : (
          <div>
            <p className="font-mono text-sm text-gray-100">{group.name}</p>
            <p className="text-[10px] font-mono text-gray-600">{groupProxyIds.length} proxies</p>
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
              <button onClick={beginEditList} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-white/[0.04] text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors">
                <Edit2 className="w-3 h-3" /> Edit List
              </button>
              <button onClick={() => setEditing(true)} className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
              <button onClick={() => onDelete(group.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
            </>
          )}
        </div>
      </div>

      {editingList ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Edit list</p>
            <p className="text-[10px] font-mono text-gray-600">Paste one proxy per line</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              className="h-7 px-2.5 text-[10px] font-mono bg-white/5 border-white/10 text-gray-400 hover:text-emerald-400 hover:border-emerald-500/30"
            >
              <Upload className="w-3 h-3" /> Load from file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.csv,text/plain"
              className="hidden"
              onChange={handleFileChange}
            />
            <p className="text-[10px] font-mono text-gray-600">Replaces the group when saved</p>
          </div>
          <Textarea
            value={listText}
            onChange={(e) => setListText(e.target.value)}
            rows={8}
            className="bg-white/5 border-white/10 font-mono text-xs"
            placeholder={"192.168.1.1:8080\nsocks5://user:pass@10.0.0.1:1080"}
          />
          <div className="flex items-center gap-2">
            <button onClick={saveList} disabled={savingList} className="px-2.5 py-1.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors">
              {savingList ? "Saving…" : "Save List"}
            </button>
            <button onClick={cancelEditList} className="px-2.5 py-1.5 rounded text-[10px] font-mono bg-white/5 text-gray-500 hover:text-gray-300 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : editing ? (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-2">Select proxies</p>
          {allProxies.map((proxy) => {
            const isIn = selected.includes(proxy.id);
            return (
              <button
                key={proxy.id}
                onClick={() => toggle(proxy.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-sm text-xs font-mono flex items-center gap-2 transition-colors ${
                  isIn ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" : "bg-white/[0.02] border border-white/5 text-gray-400 hover:border-white/10"
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isIn ? "bg-emerald-400" : "bg-gray-700"}`} />
                {proxy.host}:{proxy.port} {proxy.label ? `(${proxy.label})` : ""} — <span className={proxy.status === "healthy" ? "text-emerald-500" : "text-gray-600"}>{proxy.status}</span>
              </button>
            );
          })}
          {allProxies.length === 0 && <p className="text-[10px] text-gray-600 font-mono">No proxies found. Add some in Proxy Pool first.</p>}
        </div>
      ) : null}

      {testResults && (
        <div className="flex items-center gap-3 text-[10px] font-mono px-2 py-1.5 bg-white/[0.02] border border-white/5 rounded-sm">
          <span className="text-emerald-400">✓ {testResults.healthy} healthy</span>
          <span className="text-red-400">✗ {testResults.unhealthy} unhealthy</span>
        </div>
      )}
      {!editing && !editingList && groupProxyIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {groupProxyIds.map((id) => {
            const p = groupProxies.find((proxy) => proxy.id === id);
            return p ? (
              <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 bg-white/5 border border-white/5 text-gray-400 rounded-sm">{p.host}:{p.port}</span>
            ) : null;
          })}
        </div>
      )}

      <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <AlertDialogContent className="bg-[#12121a] border-white/10 text-gray-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm">Replace proxy list?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-gray-400 font-mono">
              This will overwrite the current list for {group.name} with {replacePreview?.lineCount || 0} pasted proxies.
              Proxies removed from this group will be hard deleted if no other group still uses them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5 font-mono text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                commitList();
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs"
            >
              Replace List
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
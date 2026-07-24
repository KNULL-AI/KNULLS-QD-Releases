import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Upload } from "lucide-react";
import { db } from "@/lib/db";
import toast from "react-hot-toast";

export default function AddProxyDialog({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Proxy groups for assignment
  const [proxyGroups, setProxyGroups] = useState([]);

  // Single proxy
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [protocol, setProtocol] = useState("HTTP");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [country, setCountry] = useState("");
  const [singleGroupId, setSingleGroupId] = useState("none");

  // Bulk
  const [bulkText, setBulkText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [bulkGroupId, setBulkGroupId] = useState("none");
  const [bulkNewGroupName, setBulkNewGroupName] = useState("");
  const [bulkProtocol, setBulkProtocol] = useState("auto");
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) db.ProxyGroup.list().then(setProxyGroups);
  }, [open]);

  const resetForm = () => {
    setHost(""); setPort(""); setProtocol("HTTP"); setUsername(""); setPassword(""); setLabel(""); setCountry("");
    setBulkText(""); setSingleGroupId("none"); setBulkGroupId("none"); setBulkNewGroupName(""); setBulkProtocol("auto");
  };

  const handleAddSingle = async () => {
    if (!host || !port) return;
    setLoading(true);
    const proxy = await db.Proxy.create({
      host, port: Number(port), protocol, username, password, label, country, status: "untested", is_active: true, fail_count: 0,
    });
    if (singleGroupId && singleGroupId !== "none") {
      const group = proxyGroups.find((g) => g.id === singleGroupId);
      if (group) await db.ProxyGroup.update(group.id, { proxy_ids: [...(group.proxy_ids || []), proxy.id] });
    }
    toast.success("Proxy added");
    resetForm();
    setOpen(false);
    setLoading(false);
    onAdded?.();
  };

  const handleFileLoad = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = typeof e?.target?.result === "string" ? e.target.result : "";
      setBulkText((prev) => prev ? `${prev}\n${text}` : text);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileLoad(file);
  };

  const handleBulkAdd = async () => {
    if (!bulkText.trim()) return;
    setLoading(true);
    const lines = bulkText.trim().split("\n").filter(Boolean);
    const proxies = lines.map((line) => {
      let proto = "HTTP", h = "", p = "", u = "", pw = "";
      let clean = line.trim();

      const protoMatch = clean.match(/^(https?|socks[45]):\/\//i);
      if (protoMatch) {
        proto = protoMatch[1].toUpperCase().replace("SOCKS", "SOCKS");
        clean = clean.slice(protoMatch[0].length);
      }

      const authMatch = clean.match(/^([^:@]+):([^@]+)@/);
      if (authMatch) {
        u = authMatch[1];
        pw = authMatch[2];
        clean = clean.slice(authMatch[0].length);
      }

      const parts = clean.split(":");
      h = parts[0];
      p = parts[1] || "8080";
      if (!u && parts[2]) u = parts[2];
      if (!pw && parts[3]) pw = parts[3];

      return { host: h, port: Number(p), protocol: bulkProtocol !== "auto" ? bulkProtocol : proto, username: u, password: pw, status: "untested", is_active: true, fail_count: 0 };
    });

    const created = await db.Proxy.bulkCreate(proxies);
    const newIds = created.map((p) => p.id);

    // Assign to group
    if (bulkGroupId === "new" && bulkNewGroupName.trim()) {
      await db.ProxyGroup.create({ name: bulkNewGroupName.trim(), proxy_ids: newIds });
    } else if (bulkGroupId && bulkGroupId !== "none") {
      const group = proxyGroups.find((g) => g.id === bulkGroupId);
      if (group) await db.ProxyGroup.update(group.id, { proxy_ids: [...(group.proxy_ids || []), ...newIds] });
    }

    toast.success(`${proxies.length} proxies imported${bulkGroupId !== "none" ? " & grouped" : ""}`);
    resetForm();
    setOpen(false);
    setLoading(false);
    onAdded?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs gap-2">
          <Plus className="w-3.5 h-3.5" /> Add Proxies
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#12121a] border-white/10 text-gray-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Add Proxies</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="single" className="mt-2">
          <TabsList className="bg-white/5 border border-white/10">
            <TabsTrigger value="single" className="font-mono text-xs data-[state=active]:bg-white/10 data-[state=active]:text-emerald-400">Single</TabsTrigger>
            <TabsTrigger value="bulk" className="font-mono text-xs data-[state=active]:bg-white/10 data-[state=active]:text-emerald-400">Bulk Import</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-3 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-400 font-mono">Host *</Label>
                <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.1" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              </div>
              <div>
                <Label className="text-xs text-gray-400 font-mono">Port *</Label>
                <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="8080" type="number" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-400 font-mono">Protocol</Label>
                <Select value={protocol} onValueChange={setProtocol}>
                  <SelectTrigger className="bg-white/5 border-white/10 font-mono text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#1a1a24] border-white/10 text-gray-100">
                    {["HTTP", "HTTPS", "SOCKS4", "SOCKS5"].map((p) => (
                      <SelectItem key={p} value={p} className="font-mono text-sm text-gray-100">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-gray-400 font-mono">Country</Label>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-400 font-mono">Username</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="optional" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              </div>
              <div>
                <Label className="text-xs text-gray-400 font-mono">Password</Label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="optional" type="password" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-400 font-mono">Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. US Residential #1" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs text-gray-400 font-mono">Add to Proxy Group <span className="text-gray-600">(optional)</span></Label>
              <Select value={singleGroupId} onValueChange={setSingleGroupId}>
                <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue placeholder="No group" /></SelectTrigger>
                <SelectContent className="bg-[#1a1a24] border-white/10 text-gray-100">
                  <SelectItem value="none" className="font-mono text-xs text-gray-300">No group</SelectItem>
                  {proxyGroups.map((g) => <SelectItem key={g.id} value={g.id} className="font-mono text-xs text-gray-100">{g.name} ({(g.proxy_ids || []).length} proxies)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddSingle} disabled={loading || !host || !port} className="w-full bg-emerald-600 hover:bg-emerald-700 font-mono text-xs mt-2">
              {loading ? "Adding..." : "Add Proxy"}
            </Button>
          </TabsContent>

          <TabsContent value="bulk" className="space-y-3 mt-4">
            {/* Drag-and-drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => { if (fileRef.current) fileRef.current.click(); }}
              className={`flex flex-col items-center justify-center gap-2 py-4 rounded border-2 border-dashed cursor-pointer transition-colors ${dragging ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/10 hover:border-white/20 bg-white/[0.02]"}`}
            >
              <Upload className="w-4 h-4 text-gray-500" />
              <p className="text-[10px] font-mono text-gray-500">Drop a .txt file here or <span className="text-emerald-400">click to browse</span></p>
              <input ref={fileRef} type="file" accept=".txt,.csv,text/plain" className="hidden" onChange={(e) => e.target.files[0] && handleFileLoad(e.target.files[0])} />
            </div>
            <div>
              <Label className="text-xs text-gray-400 font-mono">Protocol Override</Label>
              <Select value={bulkProtocol} onValueChange={setBulkProtocol}>
                <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#1a1a24] border-white/10 text-gray-100">
                  <SelectItem value="auto" className="font-mono text-xs text-gray-400">Auto-detect from line</SelectItem>
                  {["HTTP", "HTTPS", "SOCKS4", "SOCKS5"].map((p) => (
                    <SelectItem key={p} value={p} className="font-mono text-xs text-gray-100">{p} — force all</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-400 font-mono">Or paste proxy list (one per line)</Label>
              <p className="text-[10px] text-gray-600 font-mono mt-1 mb-2">
                Formats: host:port · host:port:user:pass · protocol://host:port · protocol://user:pass@host:port
              </p>
              <Textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"192.168.1.1:8080\nsocks5://user:pass@10.0.0.1:1080\n203.0.113.5:3128:admin:secret"}
                rows={6}
                className="bg-white/5 border-white/10 font-mono text-xs"
              />
            </div>
            {/* Group assignment */}
            <div>
              <Label className="text-xs text-gray-400 font-mono">Assign to Proxy Group <span className="text-gray-600">(optional)</span></Label>
              <Select value={bulkGroupId} onValueChange={setBulkGroupId}>
                <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue placeholder="No group" /></SelectTrigger>
                <SelectContent className="bg-[#1a1a24] border-white/10 text-gray-100">
                  <SelectItem value="none" className="font-mono text-xs text-gray-300">No group</SelectItem>
                  <SelectItem value="new" className="font-mono text-xs text-emerald-400">+ Create new group</SelectItem>
                  {proxyGroups.map((g) => <SelectItem key={g.id} value={g.id} className="font-mono text-xs text-gray-100">{g.name} ({(g.proxy_ids || []).length} proxies)</SelectItem>)}
                </SelectContent>
              </Select>
              {bulkGroupId === "new" && (
                <Input
                  value={bulkNewGroupName}
                  onChange={(e) => setBulkNewGroupName(e.target.value)}
                  placeholder="New group name…"
                  className="bg-white/5 border-white/10 font-mono text-xs mt-2 h-8"
                />
              )}
            </div>
            <Button onClick={handleBulkAdd} disabled={loading || !bulkText.trim() || (bulkGroupId === "new" && !bulkNewGroupName.trim())} className="w-full bg-emerald-600 hover:bg-emerald-700 font-mono text-xs">
              {loading ? "Importing..." : `Import ${bulkText.trim().split("\n").filter(Boolean).length} Proxies${bulkGroupId !== "none" ? " → Group" : ""}`}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
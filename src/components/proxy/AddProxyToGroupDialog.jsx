import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Upload } from "lucide-react";
import { db } from "@/lib/db";
import toast from "react-hot-toast";

export default function AddProxyToGroupDialog({ group, onAdded }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  const handleFileLoad = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => setBulkText((prev) => prev ? prev + "\n" + e.target.result : e.target.result);
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileLoad(file);
  };

  const parseProxies = (text) => {
    const lines = text.trim().split("\n").filter(Boolean);
    return lines.map((line) => {
      let proto = "HTTP", h = "", p = "", u = "", pw = "";
      let clean = line.trim();
      const protoMatch = clean.match(/^(https?|socks[45]):\/\//i);
      if (protoMatch) {
        proto = protoMatch[1].toUpperCase();
        clean = clean.slice(protoMatch[0].length);
      }
      const authMatch = clean.match(/^([^:@]+):([^@]+)@/);
      if (authMatch) {
        u = authMatch[1]; pw = authMatch[2];
        clean = clean.slice(authMatch[0].length);
      }
      const parts = clean.split(":");
      h = parts[0]; p = parts[1] || "8080";
      if (!u && parts[2]) u = parts[2];
      if (!pw && parts[3]) pw = parts[3];
      return { host: h, port: Number(p), protocol: proto, username: u, password: pw, status: "untested", is_active: true, fail_count: 0 };
    });
  };

  const handleImport = async () => {
    if (!bulkText.trim()) return;
    setLoading(true);
    const proxies = parseProxies(bulkText);
    const created = await db.Proxy.bulkCreate(proxies);
    const newIds = created.map((p) => p.id);
    const merged = [...new Set([...(group.proxy_ids || []), ...newIds])];
    await db.ProxyGroup.update(group.id, { proxy_ids: merged });
    toast.success(`${proxies.length} proxies added to "${group.name}"`);
    setBulkText("");
    setOpen(false);
    setLoading(false);
    onAdded?.();
  };

  const lineCount = bulkText.trim().split("\n").filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[10px] font-mono text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10 gap-1"
        >
          <Plus className="w-3 h-3" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#12121a] border-white/10 text-gray-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            Import to <span className="text-emerald-400">{group.name}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {/* Drag-and-drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 py-4 rounded border-2 border-dashed cursor-pointer transition-colors ${dragging ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/10 hover:border-white/20 bg-white/[0.02]"}`}
          >
            <Upload className="w-4 h-4 text-gray-500" />
            <p className="text-[10px] font-mono text-gray-500">Drop a .txt file or <span className="text-emerald-400">click to browse</span></p>
            <input ref={fileRef} type="file" accept=".txt,.csv,text/plain" className="hidden" onChange={(e) => e.target.files[0] && handleFileLoad(e.target.files[0])} />
          </div>

          <div>
            <Label className="text-xs text-gray-400 font-mono">Or paste proxy list (one per line)</Label>
            <p className="text-[10px] text-gray-600 font-mono mt-1 mb-2">
              host:port · host:port:user:pass · protocol://user:pass@host:port
            </p>
            <Textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"192.168.1.1:8080\nsocks5://user:pass@10.0.0.1:1080"}
              rows={6}
              className="bg-white/5 border-white/10 font-mono text-xs"
            />
          </div>

          <Button
            onClick={handleImport}
            disabled={loading || !bulkText.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700 font-mono text-xs"
          >
            {loading ? "Importing..." : `Import ${lineCount} ${lineCount === 1 ? "Proxy" : "Proxies"} → ${group.name}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonitorPlay } from "lucide-react";
import { db } from "@/lib/db";
import toast from "react-hot-toast";
import { launchBrowser } from "@/lib/electronBridge";

export default function LaunchSessionDialog({ onLaunched }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [proxies, setProxies] = useState([]);


  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("https://");
  const [proxyId, setProxyId] = useState("auto");
  const [rotationMode, setRotationMode] = useState("round_robin");
  const [userAgent, setUserAgent] = useState("");
  const [browser, setBrowser] = useState("chrome");

  useEffect(() => {
    if (open) {
      db.Proxy.filter({ is_active: true, status: "healthy" }).then(setProxies);
    }
  }, [open]);

  const handleLaunch = async () => {
    if (!name || !targetUrl) return;
    setLoading(true);

    let assignedProxy = null;
    if (proxyId === "auto") {
      if (proxies.length > 0) {
        assignedProxy = proxies[Math.floor(Math.random() * proxies.length)];
      }
    } else {
      assignedProxy = proxies.find((p) => p.id === proxyId);
    }

    const session = await db.BrowserSession.create({
      name,
      target_url: targetUrl,
      proxy_id: assignedProxy?.id || null,
      proxy_label: assignedProxy ? `${assignedProxy.host}:${assignedProxy.port}` : "No proxy",
      status: "running",
      rotation_mode: rotationMode,
      started_at: new Date().toISOString(),
      user_agent: userAgent || null,
      browser,
    });

    // Launch the real browser window via Electron IPC (no-op in browser preview)
    launchBrowser({
      sessionId: session.id,
      url: targetUrl,
      proxy: assignedProxy,
      userAgent: userAgent || null,
      browser,
    });

    toast.success(`${browser === "brave" ? "Brave" : "Chrome"} session launched`);
    setName(""); setTargetUrl("https://"); setProxyId("auto"); setUserAgent(""); setBrowser("chrome");
    setOpen(false);
    setLoading(false);
    onLaunched?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs gap-2">
          <MonitorPlay className="w-3.5 h-3.5" /> Launch Session
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#12121a] border-white/10 text-gray-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Launch Browser Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-4">
          <div>
            <Label className="text-xs text-gray-400 font-mono">Session Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scrape Job #1" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Target URL *</Label>
            <Input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://example.com" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-400 font-mono">Proxy</Label>
              <Select value={proxyId} onValueChange={setProxyId}>
                <SelectTrigger className="bg-white/5 border-white/10 font-mono text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#1a1a24] border-white/10">
                  <SelectItem value="auto" className="font-mono text-sm text-gray-100">Auto-assign</SelectItem>
                  {proxies.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="font-mono text-sm text-gray-100">
                      {p.host}:{p.port} {p.label ? `(${p.label})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-400 font-mono">Rotation Mode</Label>
              <Select value={rotationMode} onValueChange={setRotationMode}>
                <SelectTrigger className="bg-white/5 border-white/10 font-mono text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#1a1a24] border-white/10">
                  <SelectItem value="round_robin" className="font-mono text-sm text-gray-100">Round Robin</SelectItem>
                  <SelectItem value="random" className="font-mono text-sm text-gray-100">Random</SelectItem>
                  <SelectItem value="sticky" className="font-mono text-sm text-gray-100">Sticky</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Browser</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button onClick={() => setBrowser("chrome")} className={`flex items-center justify-center gap-2 px-3 py-2 rounded-sm border text-xs font-mono transition-all ${browser === "chrome" ? "border-blue-500/50 bg-blue-500/10 text-blue-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                🌐 Chrome
              </button>
              <button onClick={() => setBrowser("brave")} className={`flex items-center justify-center gap-2 px-3 py-2 rounded-sm border text-xs font-mono transition-all ${browser === "brave" ? "border-orange-500/50 bg-orange-500/10 text-orange-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                🦁 Brave
              </button>
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Custom User Agent</Label>
            <Input value={userAgent} onChange={(e) => setUserAgent(e.target.value)} placeholder="optional" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <Button onClick={handleLaunch} disabled={loading || !name || !targetUrl} className="w-full bg-blue-600 hover:bg-blue-700 font-mono text-xs mt-2">
            {loading ? "Launching..." : "Launch Session"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
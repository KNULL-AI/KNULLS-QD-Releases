import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { db } from "@/lib/db";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import toast from "react-hot-toast";

export default function SwapProxyDialog({ session, onSwapped }) {
  const [open, setOpen] = useState(false);
  const [proxies, setProxies] = useState([]);
  const [proxyGroups, setProxyGroups] = useState([]);
  const [selectedProxyId, setSelectedProxyId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      db.Proxy.filter({ is_active: true }),
      db.ProxyGroup.list(),
    ]).then(([p, pg]) => {
      setProxies(p);
      setProxyGroups(pg);
      setSelectedProxyId(session.proxy_id || "");
    });
  }, [open]);

  const handleSwap = async () => {
    if (!selectedProxyId) return;
    setLoading(true);
    const proxy = proxies.find((p) => p.id === selectedProxyId);
    const label = proxy
      ? `${proxy.protocol}://${proxy.host}:${proxy.port}`
      : "Unknown";

    await db.BrowserSession.update(session.id, {
      proxy_id: selectedProxyId,
      proxy_label: label,
    });

    toast.success(`Proxy swapped → ${label}`);
    onSwapped?.();
    setOpen(false);
    setLoading(false);
  };

  const handleGroupSelect = (groupId) => {
    const group = proxyGroups.find((g) => g.id === groupId);
    if (!group?.proxy_ids?.length) return;
    // Pick a random proxy from the group
    const pick = group.proxy_ids[Math.floor(Math.random() * group.proxy_ids.length)];
    setSelectedProxyId(pick);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 text-xs font-mono transition-colors">
          <RefreshCw className="w-3 h-3" /> Swap Proxy
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#0f0f17] border-white/10 text-gray-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm text-gray-200">
            Swap Proxy — <span className="text-emerald-400">{session.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {proxyGroups.length > 0 && (
            <div>
              <label className="block text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">
                Pick random from group
              </label>
              <div className="flex flex-wrap gap-2">
                {proxyGroups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => handleGroupSelect(g.id)}
                    className="px-2 py-1 text-[10px] font-mono rounded bg-white/5 hover:bg-emerald-500/20 hover:text-emerald-400 text-gray-400 transition-colors border border-white/5"
                  >
                    {g.name} ({g.proxy_ids?.length ?? 0})
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">
              Select proxy
            </label>
            <select
              value={selectedProxyId}
              onChange={(e) => setSelectedProxyId(e.target.value)}
              className="w-full bg-[#1a1a2e] border border-white/10 rounded-md px-3 py-2 text-xs font-mono text-gray-100 focus:outline-none focus:border-emerald-500/50"
              style={{ colorScheme: "dark" }}
            >
              <option value="" style={{ background: "#1a1a2e", color: "#e2e8f0" }}>— choose a proxy —</option>
              {proxies.map((p) => (
                <option key={p.id} value={p.id} style={{ background: "#1a1a2e", color: "#e2e8f0" }}>
                  {p.protocol}://{p.host}:{p.port}
                  {p.label ? ` (${p.label})` : ""}
                  {" "}· {p.status}
                </option>
              ))}
            </select>
          </div>

          {selectedProxyId && (
            <div className="text-[10px] font-mono text-emerald-400 bg-emerald-500/5 px-3 py-2 rounded border border-emerald-500/10">
              ✓ {proxies.find((p) => p.id === selectedProxyId)
                ? `${proxies.find((p) => p.id === selectedProxyId).protocol}://${proxies.find((p) => p.id === selectedProxyId).host}:${proxies.find((p) => p.id === selectedProxyId).port}`
                : selectedProxyId}
            </div>
          )}

          <button
            onClick={handleSwap}
            disabled={!selectedProxyId || loading}
            className="w-full py-2 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-mono font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Swapping…" : "Confirm Swap"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Stethoscope, Play, CheckCircle, XCircle, AlertTriangle, Clock, Loader2 } from "lucide-react";
import { diagnoseProxy } from "@/lib/electronBridge";

const STATUS_INFO = {
  200: { label: "OK — Allowed", color: "text-emerald-400", icon: CheckCircle },
  301: { label: "Redirect — Allowed", color: "text-emerald-400", icon: CheckCircle },
  302: { label: "Redirect — Allowed", color: "text-emerald-400", icon: CheckCircle },
  403: { label: "403 Forbidden — IP Blocked", color: "text-red-400", icon: XCircle },
  407: { label: "407 Proxy Auth Failed", color: "text-orange-400", icon: AlertTriangle },
  429: { label: "429 Rate Limited", color: "text-yellow-400", icon: AlertTriangle },
  503: { label: "503 Bot Challenge", color: "text-orange-400", icon: AlertTriangle },
  0:   { label: "Connection Failed", color: "text-red-500", icon: XCircle },
};

function getStatusInfo(code) {
  return STATUS_INFO[code] || { label: `HTTP ${code}`, color: code < 400 ? "text-emerald-400" : "text-red-400", icon: code < 400 ? CheckCircle : XCircle };
}

export default function ProxyDiagnosticDialog({ proxies }) {
  const [open, setOpen] = useState(false);
  const [targetUrl, setTargetUrl] = useState("https://www.pokemoncenter.com/");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);

  const runDiagnostic = async () => {
    if (!proxies.length || !targetUrl.trim()) return;
    setRunning(true);
    setResults([]);

    // Run all proxies in parallel
    const checks = proxies.map(async (proxy) => {
      const start = Date.now();
      try {
        const res = await diagnoseProxy(proxy, targetUrl.trim());
        return {
          proxy,
          status: res.status ?? 0,
          responseTime: Date.now() - start,
          error: res.error || null,
        };
      } catch (e) {
        return { proxy, status: 0, responseTime: Date.now() - start, error: e.message };
      }
    });

    // Stream results as they come in
    let completed = [];
    await Promise.all(checks.map((p) => p.then((r) => {
      completed = [...completed, r];
      setResults([...completed]);
    })));

    setRunning(false);
  };

  const blocked = results.filter((r) => r.status === 403 || r.status === 0).length;
  const allowed = results.filter((r) => r.status > 0 && r.status < 400).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="bg-transparent border-white/10 text-gray-400 hover:text-violet-400 hover:border-violet-500/30 font-mono text-xs gap-2"
        >
          <Stethoscope className="w-3.5 h-3.5" />
          Site Diagnostic
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#0e0e18] border-white/10 text-gray-100 max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm text-gray-100 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-violet-400" />
            Proxy Site Diagnostic
          </DialogTitle>
          <p className="text-xs font-mono text-gray-500 pt-1">
            Tests each proxy against a real site to detect 403 blocks, auth failures, and bot challenges.
          </p>
        </DialogHeader>

        <div className="flex gap-2 mt-2">
          <Input
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://www.pokemoncenter.com/"
            className="bg-white/5 border-white/10 font-mono text-xs h-8 flex-1"
          />
          <Button
            onClick={runDiagnostic}
            disabled={running || !proxies.length}
            className="bg-violet-600 hover:bg-violet-700 font-mono text-xs h-8 px-4 gap-1.5 flex-shrink-0"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? "Running…" : `Test ${proxies.length} Proxies`}
          </Button>
        </div>

        {/* Summary bar */}
        {results.length > 0 && (
          <div className="flex gap-4 px-3 py-2 rounded-sm bg-white/5 border border-white/10 font-mono text-xs">
            <span className="text-gray-500">{results.length}/{proxies.length} checked</span>
            <span className="text-emerald-400">✓ {allowed} allowed</span>
            <span className="text-red-400">✗ {blocked} blocked/failed</span>
            {results.length < proxies.length && <span className="text-gray-500 animate-pulse ml-auto">Running…</span>}
          </div>
        )}

        {/* Results list */}
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0 mt-1">
          {results.length === 0 && !running && (
            <div className="text-center py-12 text-gray-600 font-mono text-xs">
              {proxies.length === 0
                ? "Select proxies first using the checkboxes, then open this tool."
                : "Click 'Test Proxies' to run the diagnostic."}
            </div>
          )}
          {results.map((r, i) => {
            const info = getStatusInfo(r.error && r.status === 0 ? 0 : r.status);
            const Icon = info.icon;
            return (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-sm bg-white/[0.03] border border-white/5 font-mono text-xs">
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${info.color}`} />
                <span className="text-gray-300 flex-shrink-0 w-32 truncate">{r.proxy.host}:{r.proxy.port}</span>
                <span className={`flex-shrink-0 font-semibold ${info.color}`}>{info.label}</span>
                <span className="ml-auto text-gray-600 flex items-center gap-1 flex-shrink-0">
                  <Clock className="w-3 h-3" />{r.responseTime}ms
                </span>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
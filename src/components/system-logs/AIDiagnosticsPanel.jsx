import { useState } from "react";
import { Bot, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { geminiAnalyze } from "@/lib/electronBridge";
import { db } from "@/lib/db";

export default function AIDiagnosticsPanel({ logs }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    // Build log text (last 100 entries)
    const logText = logs.slice(0, 100).map((l) => {
      const ts = new Date(l.created_date).toISOString();
      const base = `[${ts}] ${(l.level || "info").toUpperCase()} [${l.source}] ${l.message}`;
      return l.details ? `${base}\n  ${l.details}` : base;
    }).join("\n");

    // Build proxy summary
    let proxySummary = "No proxy data available.";
    try {
      const proxies = await db.Proxy.list("-created_date", 200);
      const total = proxies.length;
      const healthy = proxies.filter((p) => p.status === "healthy").length;
      const unhealthy = proxies.filter((p) => p.status === "unhealthy").length;
      const untested = proxies.filter((p) => p.status === "untested").length;
      const avgMs = proxies.filter((p) => p.response_time_ms).reduce((s, p) => s + p.response_time_ms, 0) / (healthy || 1);
      proxySummary = `Total: ${total} | Healthy: ${healthy} | Unhealthy: ${unhealthy} | Untested: ${untested} | Avg response: ${Math.round(avgMs)}ms`;
    } catch (_) {}

    const res = await geminiAnalyze(logText, proxySummary);
    setLoading(false);

    if (res?.error) {
      setError(res.error);
    } else {
      setResult(res?.result || "No analysis returned.");
    }
  };

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-purple-400" />
          <span className="font-mono text-sm text-purple-300 font-semibold">AI Diagnostics</span>
          <span className="text-[10px] font-mono text-purple-500/70 border border-purple-500/20 rounded px-1.5 py-0.5">Gemini Flash</span>
        </div>
        <Button
          onClick={runAnalysis}
          disabled={loading || logs.length === 0}
          className="bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 font-mono text-xs gap-2 h-7 px-3"
          variant="outline"
        >
          {loading ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Analyzing...</>
          ) : (
            <><RefreshCw className="w-3 h-3" /> Run Analysis</>
          )}
        </Button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 font-mono text-xs">
        {!result && !error && !loading && (
          <p className="text-purple-500/60 text-center py-4">
            Click "Run Analysis" to send your logs to Gemini AI for diagnostics and fix suggestions.
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-purple-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Sending logs to Gemini Flash...</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-red-400 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <pre className="whitespace-pre-wrap text-gray-300 leading-relaxed text-[11px]">
            {result}
          </pre>
        )}
      </div>
    </div>
  );
}
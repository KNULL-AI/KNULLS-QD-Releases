import { useState, useEffect } from "react";
import { db } from "@/lib/db";
import { Trash2, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import AIDiagnosticsPanel from "@/components/system-logs/AIDiagnosticsPanel";

const LEVEL_STYLES = {
  info:  { dot: "bg-blue-400",    text: "text-blue-400",    label: "INFO"  },
  warn:  { dot: "bg-yellow-400",  text: "text-yellow-400",  label: "WARN"  },
  error: { dot: "bg-red-400",     text: "text-red-400",     label: "ERROR" },
  crash: { dot: "bg-red-600 animate-pulse", text: "text-red-500 font-bold", label: "CRASH" },
};

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    const data = await db.SystemLog.list("-created_date", 200);
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleExport = () => {
    const lines = filtered.map((log) => {
      const ts = new Date(log.created_date).toISOString();
      const level = (log.level || "info").toUpperCase().padEnd(5);
      const base = `[${ts}] ${level} [${log.source}] ${log.message}`;
      return log.details ? `${base}\n  ${log.details}` : base;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knull-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearAll = async () => {
    await db.SystemLog.deleteMany({});
    setLogs([]);
  };

  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100">System Logs</h1>
          <p className="text-xs text-gray-500 font-mono mt-1">{logs.length} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleExport} disabled={filtered.length === 0} variant="outline" className="bg-transparent border-white/10 text-gray-400 hover:text-blue-400 hover:border-blue-500/30 font-mono text-xs gap-2">
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
          <Button onClick={load} variant="outline" className="bg-transparent border-white/10 text-gray-400 hover:text-emerald-400 font-mono text-xs gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Button onClick={handleClearAll} disabled={logs.length === 0} variant="outline" className="bg-transparent border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/30 font-mono text-xs gap-2">
            <Trash2 className="w-3.5 h-3.5" /> Clear All
          </Button>
        </div>
      </div>

      {/* AI Diagnostics */}
      <AIDiagnosticsPanel logs={logs} />

      {/* Level filter */}
      <div className="flex gap-2 flex-wrap">
        {["all", "info", "warn", "error", "crash"].map((lvl) => (
          <button
            key={lvl}
            onClick={() => setFilter(lvl)}
            className={`px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-wider border transition-all ${
              filter === lvl
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"
            }`}
          >
            {lvl}
          </button>
        ))}
      </div>

      {/* Log list */}
      <div className="rounded-lg border border-white/5 bg-black/30 overflow-hidden font-mono text-xs">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-600">No logs yet.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map((log) => {
              const s = LEVEL_STYLES[log.level] || LEVEL_STYLES.info;
              return (
                <div key={log.id} className="px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`${s.text} uppercase text-[10px] tracking-wider`}>{s.label}</span>
                        <span className="text-gray-600">[{log.source}]</span>
                        <span className="text-gray-300">{log.message}</span>
                        <span className="text-gray-700 ml-auto text-[10px]">
                          {new Date(log.created_date).toLocaleString()}
                        </span>
                      </div>
                      {log.details && (
                        <pre className="mt-1 text-[10px] text-gray-600 whitespace-pre-wrap break-all leading-tight">
                          {log.details}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
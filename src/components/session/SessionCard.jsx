import { useState, useEffect } from "react";
import { Square, ExternalLink, RotateCcw, MonitorPlay, Flame, CheckCircle2, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import StatusBadge from "@/components/proxy/StatusBadge";
import toast from "react-hot-toast";
import { launchBrowser, focusBrowser, killBrowser, startQueueTimer, stopQueueTimer } from "@/lib/electronBridge";
import SwapProxyDialog from "@/components/session/SwapProxyDialog";

// Warmup duration in seconds — sessions show warming progress for this long after start
const WARMUP_SECONDS = 90;

function WarmupBar({ startedAt }) {
  const [elapsed, setElapsed] = useState(() => (Date.now() - new Date(startedAt).getTime()) / 1000);

  useEffect(() => {
    if (elapsed >= WARMUP_SECONDS) return;
    const id = setInterval(() => {
      setElapsed((Date.now() - new Date(startedAt).getTime()) / 1000);
    }, 500);
    return () => clearInterval(id);
  }, [startedAt]);

  const pct = Math.min(100, (elapsed / WARMUP_SECONDS) * 100);
  const isReady = pct >= 100;

  return (
    <div className="mt-2.5 space-y-1">
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-1 text-[10px] font-mono ${isReady ? "text-emerald-400" : "text-amber-400"}`}>
          {isReady
            ? <><CheckCircle2 className="w-3 h-3" /> Ready for task execution</>
            : <><Flame className="w-3 h-3 animate-pulse" /> Warming up — {Math.max(0, Math.ceil(WARMUP_SECONDS - elapsed))}s remaining</>
          }
        </div>
        <span className="text-[10px] font-mono text-gray-600">{Math.round(pct)}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isReady ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function SessionCard({ session, onUpdate, selected, onToggleSelect }) {

  const handleStop = async () => {
    killBrowser(session.id);
    await stopQueueTimer(session.id);
    await db.BrowserSession.update(session.id, {
      status: "stopped",
      stopped_at: new Date().toISOString(),
    });
    toast.success("Session stopped");
    onUpdate?.();
  };

  const handleRestart = async () => {
    await db.BrowserSession.update(session.id, {
      status: "running",
      started_at: new Date().toISOString(),
      stopped_at: null,
    });

    // Actually relaunch the browser window
    let proxy = null;
    if (session.proxy_id) {
      proxy = await db.Proxy.get(session.proxy_id).catch(() => null);
    }
    await launchBrowser({
      sessionId: session.id,
      url: session.target_url,
      proxy,
      userAgent: session.user_agent || null,
      browser: session.browser || "chrome",
      noPreload: false,
    });

    await startQueueTimer(session.id, 0);
    toast.success("Session restarted");
    onUpdate?.();
  };

  const handleLaunchBrowser = async () => {
    // Try to bring existing window to front first
    const result = await focusBrowser(session.id);
    if (result?.ok) return;

    // No existing window — launch fresh
    let proxy = null;
    if (session.proxy_id) {
      proxy = await db.Proxy.get(session.proxy_id).catch(() => null);
    }
    launchBrowser({
      sessionId: session.id,
      url: session.target_url,
      proxy,
      userAgent: session.user_agent || null,
      browser: session.browser || "chrome",
      noPreload: false,
      manualOpen: true,
    });
    startQueueTimer(session.id, session.queue_timer_ms || 0);
    toast(`Opening ${session.browser === "brave" ? "Brave" : "Chrome"}…`);
  };

  const isRunning = session.status === "running";

  return (
    <div className={`p-4 rounded-lg border transition-all ${selected ? "border-blue-500/40 bg-blue-500/5" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {/* Selection checkbox */}
          <button
            onClick={onToggleSelect}
            className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border transition-colors ${selected ? "bg-blue-500 border-blue-400" : "border-white/20 hover:border-white/40"}`}
          >
            {selected && <span className="text-white text-[10px] leading-none flex items-center justify-center h-full">✓</span>}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-mono text-sm text-gray-200 truncate">{session.name}</h3>
              <StatusBadge status={session.status} />
            </div>
            <a
              href={session.target_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-gray-500 hover:text-emerald-400 flex items-center gap-1 mt-1 truncate"
            >
              {session.target_url}
              <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
            </a>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
          {session.proxy_label || "No proxy"}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-500">
          {session.rotation_mode}
        </span>
        {session.started_at && (
          <span className="text-[10px] text-gray-600">
            started {new Date(session.started_at).toLocaleString()}
          </span>
        )}
      </div>

      {isRunning && session.started_at && <WarmupBar startedAt={session.started_at} />}

      <div className="mt-3 flex gap-2 flex-wrap">
        {isRunning ? (
          <button onClick={handleStop} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-mono transition-colors">
            <Square className="w-3 h-3" /> Stop
          </button>
        ) : (
          <button onClick={handleRestart} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-mono transition-colors">
            <RotateCcw className="w-3 h-3" /> Restart
          </button>
        )}
        <button onClick={handleLaunchBrowser} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 text-xs font-mono transition-colors">
          <MonitorPlay className="w-3 h-3" /> {session.browser === "brave" ? "🦁" : "🌐"} Open
        </button>
        <SwapProxyDialog session={session} onSwapped={onUpdate} />
        {session.proxy_id && (
          <button
            onClick={async () => {
              await db.BrowserSession.update(session.id, { proxy_id: null, proxy_label: "No proxy" });
              toast.success("Proxy removed — direct connection");
              onUpdate?.();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-mono transition-colors"
          >
            <XCircle className="w-3 h-3" /> Remove Proxy
          </button>
        )}
      </div>
    </div>
  );
}
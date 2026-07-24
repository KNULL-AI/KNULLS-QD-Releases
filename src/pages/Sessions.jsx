import { useState, useEffect, useCallback, useRef } from "react";
import { Square, RotateCcw, CheckSquare, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import LaunchSessionDialog from "@/components/session/LaunchSessionDialog";
import SessionCard from "@/components/session/SessionCard";
import toast from "react-hot-toast";
import { killBrowser, launchBrowser, onSessionCrashed, offSessionCrashed, onAllSessionsKilled, offAllSessionsKilled } from "@/lib/electronBridge";

export default function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const loadSessions = async () => {
    try {
      const data = await db.BrowserSession.list("-created_date", 100);
      setSessions(data);
    } catch {
      toast.error("Failed to load sessions");
    }
    setLoading(false);
  };

  // ── Session crash watchdog ──────────────────────────────────────────────────
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const handleCrash = useCallback(async ({ sessionId }) => {
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (!session || session.status !== "running") return;

    // Try auto-swap to another healthy proxy
    if (session.proxy_id) {
      try {
        const allHealthy = await db.Proxy.filter({ is_active: true, status: "healthy" });
        const next = allHealthy.find((p) => p.id !== session.proxy_id);
        if (next) {
          await db.BrowserSession.update(sessionId, {
            status: "error",
            proxy_id: next.id,
            proxy_label: `${next.protocol}://${next.host}:${next.port}`,
          });
          toast.error(`Session crashed — proxy rotated to ${next.host}:${next.port}`);
          loadSessions();
          return;
        }
      } catch {}
    }

    await db.BrowserSession.update(sessionId, {
      status: "error",
      stopped_at: new Date().toISOString(),
    });
    toast.error(`Session "${session?.name || sessionId}" crashed`);
    loadSessions();
  }, []);

  useEffect(() => {
    loadSessions();
  }, []);

  const handleCrashRef = useRef(handleCrash);
  useEffect(() => { handleCrashRef.current = handleCrash; }, [handleCrash]);

  useEffect(() => {
    const wrapper = (data) => handleCrashRef.current(data);
    const sub = onSessionCrashed(wrapper);
    return () => offSessionCrashed(sub ?? wrapper);
  }, []);

  // Refresh session list when tray kills all sessions
  useEffect(() => {
    const wrapper = onAllSessionsKilled(() => loadSessions());
    return () => offAllSessionsKilled(wrapper);
  }, []);

  const running = sessions.filter((s) => s.status === "running");
  const stopped = sessions.filter((s) => s.status !== "running");

  // ── Bulk selection helpers ──────────────────────────────────────────────────
  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectAll = () => setSelected(new Set(sessions.map((s) => s.id)));
  const clearSelect = () => setSelected(new Set());

  const selectedSessions = sessions.filter((s) => selected.has(s.id));

  const handleBulkStop = async () => {
    const toStop = selectedSessions.filter((s) => s.status === "running");
    if (toStop.length) {
      const now = new Date().toISOString();
      await db.BrowserSession.bulkUpdate(toStop.map((s) => ({ id: s.id, status: "stopped", stopped_at: now })));
      // Kill actual browser windows
      await Promise.all(toStop.map((s) => killBrowser(s.id)));
    }
    toast.success(`Stopped ${toStop.length} session${toStop.length !== 1 ? "s" : ""}`);
    clearSelect();
    loadSessions();
  };

  const handleBulkRestart = async () => {
    const now = new Date().toISOString();
    await db.BrowserSession.bulkUpdate(selectedSessions.map((s) => ({ id: s.id, status: "running", started_at: now, stopped_at: null })));
    // Relaunch actual browser windows
    for (const s of selectedSessions) {
      let proxy = null;
      if (s.proxy_id) proxy = await db.Proxy.get(s.proxy_id).catch(() => null);
      await launchBrowser({ sessionId: s.id, url: s.target_url, proxy, userAgent: s.user_agent || null, browser: s.browser || "chrome" });
    }
    toast.success(`Restarted ${selectedSessions.length} sessions`);
    clearSelect();
    loadSessions();
  };

  const handleBulkDelete = async () => {
    await Promise.all(selectedSessions.map((s) => killBrowser(s.id)));
    await Promise.all(selectedSessions.map((s) => db.BrowserSession.delete(s.id)));
    toast.success(`Deleted ${selectedSessions.length} session${selectedSessions.length !== 1 ? "s" : ""}`);
    clearSelect();
    loadSessions();
  };

  const handleDeleteAll = async () => {
    await Promise.all(sessions.map((s) => killBrowser(s.id)));
    await Promise.all(sessions.map((s) => db.BrowserSession.delete(s.id)));
    toast.success(`Deleted all ${sessions.length} sessions`);
    clearSelect();
    loadSessions();
  };

  const handleStopAll = async () => {
    try {
      const now = new Date().toISOString();
      await db.BrowserSession.bulkUpdate(running.map((s) => ({ id: s.id, status: "stopped", stopped_at: now })));
      // Kill actual browser windows
      await Promise.all(running.map((s) => killBrowser(s.id)));
      toast.success(`Stopped ${running.length} sessions`);
    } catch {
      toast.error("Failed to stop all sessions");
    }
    loadSessions();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100">Browser Sessions</h1>
          <p className="text-xs text-gray-500 font-mono mt-1">{running.length} running · {stopped.length} stopped</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <LaunchSessionDialog onLaunched={loadSessions} />
          {sessions.length > 0 && (
            <Button
              onClick={selected.size === sessions.length ? clearSelect : selectAll}
              variant="outline"
              className="bg-transparent border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 font-mono text-xs gap-1.5"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {selected.size === sessions.length ? "Deselect All" : "Select All"}
            </Button>
          )}
          {sessions.length > 0 && (
            <Button
              onClick={handleDeleteAll}
              variant="outline"
              className="bg-transparent border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/30 font-mono text-xs gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete All
            </Button>
          )}
          {running.length > 0 && (
            <Button
              onClick={handleStopAll}
              variant="outline"
              className="bg-transparent border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/30 font-mono text-xs gap-2"
            >
              <Square className="w-3.5 h-3.5" /> Stop All
            </Button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-sm border border-blue-500/20 bg-blue-500/5 font-mono text-xs">
          <span className="text-blue-400">{selected.size} selected</span>
          <button onClick={handleBulkStop} className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
            <Square className="w-3 h-3" /> Stop
          </button>
          <button onClick={handleBulkRestart} className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
            <RotateCcw className="w-3 h-3" /> Restart
          </button>
          <button onClick={handleBulkDelete} className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-900/20 text-red-400 hover:bg-red-500/20 transition-colors">
            <Trash2 className="w-3 h-3" /> Delete
          </button>
          <button onClick={clearSelect} className="ml-auto text-gray-600 hover:text-gray-400">✕ Clear</button>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 font-mono text-sm">No sessions yet. Launch one to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {running.length > 0 && (
            <div>
              <h2 className="font-mono text-xs text-gray-500 uppercase tracking-wider mb-3">Running</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {running.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onUpdate={loadSessions}
                    selected={selected.has(s.id)}
                    onToggleSelect={() => toggleSelect(s.id)}
                  />
                ))}
              </div>
            </div>
          )}
          {stopped.length > 0 && (
            <div>
              <h2 className="font-mono text-xs text-gray-500 uppercase tracking-wider mb-3">Stopped</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {stopped.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onUpdate={loadSessions}
                    selected={selected.has(s.id)}
                    onToggleSelect={() => toggleSelect(s.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
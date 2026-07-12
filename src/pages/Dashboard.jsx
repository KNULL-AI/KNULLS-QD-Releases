import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Shield, MonitorPlay, AlertTriangle, Zap, ArrowRight, StopCircle } from "lucide-react";
import { db } from "@/lib/db";
import { killBrowser, onAllSessionsKilled, offAllSessionsKilled } from "@/lib/electronBridge";
import StatCard from "@/components/dashboard/StatCard";
import StatusBadge from "@/components/proxy/StatusBadge";
import QueueLeaderboard from "@/components/dashboard/QueueLeaderboard";
import ActivityFeed from "@/components/dashboard/ActivityFeed";
import toast from "react-hot-toast";

export default function Dashboard() {
  const [proxies, setProxies] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [p, s] = await Promise.all([
      db.Proxy.list(),
      db.BrowserSession.list("-created_date", 200),
    ]);
    setProxies(p);
    setSessions(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();

    // Real-time: refresh sessions whenever one is created or updated (e.g. by Discord trigger)
    const unsub = db.BrowserSession.subscribe((event) => {
      if (event.type === "create") {
        setSessions((prev) => [event.data, ...prev].slice(0, 200));
      } else if (event.type === "update") {
        setSessions((prev) => prev.map((s) => s.id === event.data.id ? { ...s, ...event.data } : s));
      } else if (event.type === "delete") {
        setSessions((prev) => prev.filter((s) => s.id !== event.data.id));
      }
    });

    return unsub;
  }, [loadData]);

  // Refresh when tray kills all sessions
  useEffect(() => {
    const wrapper = onAllSessionsKilled(loadData);
    return () => offAllSessionsKilled(wrapper);
  }, [loadData]);

  const stopAllSessions = async () => {
    const running = sessions.filter((s) => s.status === "running");
    if (running.length === 0) { toast("No running sessions"); return; }
    await Promise.all(running.map(async (s) => {
      killBrowser(s.id);
      await db.BrowserSession.update(s.id, { status: "stopped", stopped_at: new Date().toISOString() });
    }));
    toast.success(`Stopped ${running.length} session${running.length !== 1 ? "s" : ""}`);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  const healthy = proxies.filter((p) => p.status === "healthy").length;
  const unhealthy = proxies.filter((p) => p.status === "unhealthy").length;
  const runningSessions = sessions.filter((s) => s.status === "running");
  const active = runningSessions.length;
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100">Dashboard</h1>
          <p className="text-xs text-gray-500 font-mono mt-1">Overview of your proxy pool and browser sessions</p>
        </div>
        {active > 0 && (
          <button onClick={stopAllSessions}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-mono bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors flex-shrink-0">
            <StopCircle className="w-3.5 h-3.5" /> Stop All ({active})
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Proxies" value={proxies.length} icon={Shield} color="gray" />
        <StatCard label="Healthy" value={healthy} icon={Zap} color="emerald" />
        <StatCard label="Unhealthy" value={unhealthy} icon={AlertTriangle} color="red" />
        <StatCard label="Active Sessions" value={active} icon={MonitorPlay} color="blue" />
      </div>

      {/* Recent Proxies */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <h2 className="font-mono text-xs text-gray-400 uppercase tracking-wider">Proxy Pool</h2>
          <Link to="/proxies" className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {proxies.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Shield className="w-8 h-8 text-gray-700 mx-auto mb-2" />
            <p className="text-xs text-gray-500 font-mono">No proxies added yet</p>
            <Link to="/proxies" className="text-xs text-emerald-400 font-mono mt-1 inline-block hover:text-emerald-300">
              Add your first proxy →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {proxies.slice(0, 5).map((proxy) => (
              <div key={proxy.id} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-300">{proxy.host}:{proxy.port}</span>
                  <span className="text-[10px] font-mono text-gray-600">{proxy.protocol}</span>
                </div>
                <StatusBadge status={proxy.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity Feed */}
      <ActivityFeed />

      {/* Queue Leaderboard */}
      <QueueLeaderboard sessions={sessions} onUpdate={loadData} />

      {/* Recent Sessions */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <h2 className="font-mono text-xs text-gray-400 uppercase tracking-wider">Recent Sessions</h2>
          <Link to="/sessions" className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {sessions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <MonitorPlay className="w-8 h-8 text-gray-700 mx-auto mb-2" />
            <p className="text-xs text-gray-500 font-mono">No sessions launched yet</p>
            <Link to="/sessions" className="text-xs text-emerald-400 font-mono mt-1 inline-block hover:text-emerald-300">
              Launch your first session →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {sessions.slice(0, 5).map((s) => (
              <div key={s.id} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-300">{s.name}</span>
                  <span className="text-[10px] font-mono text-gray-600 truncate max-w-[200px]">{s.target_url}</span>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
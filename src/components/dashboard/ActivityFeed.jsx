import { useEffect, useState } from "react";
import { Activity, Zap, MonitorPlay, AlertTriangle, Radio, RefreshCw, Shield } from "lucide-react";
import { db } from "@/lib/db";

const EVENT_ICONS = {
  session_launched: { icon: MonitorPlay, color: "text-emerald-400" },
  session_stopped: { icon: MonitorPlay, color: "text-gray-500" },
  session_crashed: { icon: AlertTriangle, color: "text-red-400" },
  proxy_swapped: { icon: RefreshCw, color: "text-blue-400" },
  discord_trigger: { icon: Radio, color: "text-purple-400" },
  task_group_run: { icon: Zap, color: "text-yellow-400" },
  proxy_healthy: { icon: Shield, color: "text-emerald-400" },
  proxy_unhealthy: { icon: Shield, color: "text-red-400" },
};

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function ActivityFeed() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    db.ActivityEvent.list("-created_date", 40).then(setEvents);

    const unsub = db.ActivityEvent.subscribe((event) => {
      if (event.type === "create") {
        setEvents((prev) => [event.data, ...prev].slice(0, 40));
      }
    });
    return unsub;
  }, []);

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className="font-mono text-xs text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-emerald-400" /> Activity Feed
        </h2>
        <span className="text-[9px] font-mono text-gray-700 border border-white/5 px-1.5 py-0.5 rounded">LIVE</span>
      </div>
      {events.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Activity className="w-6 h-6 text-gray-700 mx-auto mb-2" />
          <p className="text-xs text-gray-600 font-mono">No events yet</p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.03] max-h-64 overflow-y-auto">
          {events.map((e) => {
            const cfg = EVENT_ICONS[e.type] || { icon: Activity, color: "text-gray-400" };
            const Icon = cfg.icon;
            return (
              <div key={e.id} className="px-4 py-2 flex items-center gap-3">
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${cfg.color}`} />
                <p className="font-mono text-xs text-gray-300 flex-1 truncate">{e.message}</p>
                <span className="text-[10px] font-mono text-gray-700 flex-shrink-0">{timeAgo(e.created_date)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
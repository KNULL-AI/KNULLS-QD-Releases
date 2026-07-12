import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Timer, Trophy, ArrowRight, Pencil, Check, MonitorPlay, Bell } from "lucide-react";
import toast from "react-hot-toast";
import { db } from "@/lib/db";
import { launchBrowser, focusBrowser, onQueueTimerTick, offQueueTimerTick } from "@/lib/electronBridge";
import StatusBadge from "@/components/proxy/StatusBadge";

function formatTimer(ms) {
  if (ms == null) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function timerColor(ms) {
  if (ms == null) return "text-gray-500";
  if (ms < 60_000) return "text-emerald-400";
  if (ms < 300_000) return "text-yellow-400";
  return "text-red-400";
}

function InlineTimerEdit({ session, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(session.queue_timer_ms != null ? Math.floor(session.queue_timer_ms / 1000) : "");

  const save = async () => {
    const ms = parseInt(val, 10);
    await db.BrowserSession.update(session.id, {
      queue_timer_ms: isNaN(ms) ? null : ms * 1000,
    });
    setEditing(false);
    onSaved?.();
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          placeholder="sec"
          className="w-16 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-emerald-500/50"
        />
        <button onClick={save} className="text-emerald-400 hover:text-emerald-300">
          <Check className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group cursor-pointer" onClick={() => setEditing(true)}>
      <span className={`font-mono text-sm font-semibold tabular-nums ${timerColor(session.queue_timer_ms)}`}>
        {formatTimer(session.queue_timer_ms)}
      </span>
      <Pencil className="w-2.5 h-2.5 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

export default function QueueLeaderboard({ sessions, onUpdate }) {
  const [timerOverrides, setTimerOverrides] = useState({});
  const [alertThreshold, setAlertThreshold] = useState("");
  const alertedSessions = useRef(new Set());

  useEffect(() => {
    const handler = ({ sessionId, ms }) => {
      setTimerOverrides((prev) => ({ ...prev, [sessionId]: ms }));
    };
    const wrapper = onQueueTimerTick(handler);
    return () => offQueueTimerTick(wrapper);
  }, []);

  // Merge live overrides into sessions
  const liveSessions = sessions.map((s) =>
    timerOverrides[s.id] != null ? { ...s, queue_timer_ms: timerOverrides[s.id] } : s
  );

  // Queue position alert
  const threshold = parseInt(alertThreshold, 10);
  useEffect(() => {
    if (isNaN(threshold) || threshold <= 0) return;
    liveSessions.forEach((s) => {
      if (
        s.status === "running" &&
        s.queue_position != null &&
        s.queue_position <= threshold &&
        !alertedSessions.current.has(s.id)
      ) {
        alertedSessions.current.add(s.id);
        toast(`🔔 ${s.name} reached position #${s.queue_position}!`, {
          duration: 8000,
          style: { background: "#1a1a2e", color: "#e2e8f0", border: "1px solid rgba(16,185,129,0.4)", fontFamily: "monospace", fontSize: "13px" },
        });
      }
      // Reset alert if position climbs back above threshold
      if (s.queue_position == null || s.queue_position > threshold) {
        alertedSessions.current.delete(s.id);
      }
    });
  }, [liveSessions, threshold]);

  const sorted = [...liveSessions].sort((a, b) => {
    // Running first, then stopped
    if (a.status === "running" && b.status !== "running") return -1;
    if (a.status !== "running" && b.status === "running") return 1;
    // Within same status: lower timer = higher rank; no timer = last
    if (a.queue_timer_ms == null && b.queue_timer_ms == null) return 0;
    if (a.queue_timer_ms == null) return 1;
    if (b.queue_timer_ms == null) return -1;
    return a.queue_timer_ms - b.queue_timer_ms;
  });

  const handleFocus = async (s) => {
    // Try to bring the existing window to front first
    const result = await focusBrowser(s.id);
    if (result?.ok) return;

    // Window doesn't exist yet — launch it
    let proxy = null;
    if (s.proxy_id) {
      proxy = await db.Proxy.get(s.proxy_id).catch(() => null);
    }
    launchBrowser({
      sessionId: s.id,
      url: s.target_url,
      proxy,
      userAgent: s.user_agent || null,
      browser: s.browser || "chrome",
    });
  };

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-yellow-500/70" />
            <h2 className="font-mono text-xs text-gray-400 uppercase tracking-wider">Queue Leaderboard</h2>
          </div>
          <Link to="/sessions" className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
            Sessions <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="px-4 py-8 text-center">
          <Timer className="w-8 h-8 text-gray-700 mx-auto mb-2" />
          <p className="text-xs text-gray-500 font-mono">No sessions yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Trophy className="w-3.5 h-3.5 text-yellow-500/70" />
          <h2 className="font-mono text-xs text-gray-400 uppercase tracking-wider">Queue Leaderboard</h2>
          <span className="text-[10px] font-mono text-gray-600 hidden sm:inline">{sorted.length} sessions · click timer to edit</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1" title="Alert when any session reaches this queue position">
            <Bell className="w-3 h-3 text-yellow-500/60 flex-shrink-0" />
            <input
              type="number"
              min="1"
              value={alertThreshold}
              onChange={(e) => { setAlertThreshold(e.target.value); alertedSessions.current.clear(); }}
              placeholder="pos alert"
              className="w-16 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-mono text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-yellow-500/40"
            />
          </div>
          <Link to="/sessions" className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      <div className="divide-y divide-white/5">
        {sorted.map((s, idx) => {
          const isRunning = s.status === "running";
          return (
            <div key={s.id} className={`px-4 py-2.5 flex items-center gap-3 transition-colors ${isRunning ? "hover:bg-white/[0.03]" : "opacity-50 hover:opacity-70"}`}>
              {/* Rank (running only get medals) */}
              <span className={`w-5 text-center font-mono text-xs font-bold flex-shrink-0 ${
                !isRunning ? "text-gray-700" :
                idx === 0 ? "text-yellow-400" : idx === 1 ? "text-gray-300" : idx === 2 ? "text-orange-400/70" : "text-gray-600"
              }`}>
                {!isRunning ? "—" : idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}
              </span>

              {/* Name + URL */}
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs text-gray-200 truncate">{s.name}</p>
                <p className="font-mono text-[10px] text-gray-600 truncate">{s.target_url}</p>
              </div>

              {/* Status */}
              <StatusBadge status={s.status} />

              {/* Queue position */}
              {s.queue_position != null && (
                <span className="text-[10px] font-mono text-gray-500 flex-shrink-0 hidden sm:inline">
                  pos <span className="text-gray-300">#{s.queue_position}</span>
                </span>
              )}

              {/* Timer — editable inline */}
              <div className="flex-shrink-0">
                <InlineTimerEdit session={s} onSaved={onUpdate} />
              </div>

              {/* Focus / Open button */}
              <button
                onClick={() => handleFocus(s)}
                title={`Open ${s.browser === "brave" ? "Brave" : "Chrome"} for this session`}
                className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 text-[10px] font-mono transition-colors"
              >
                <MonitorPlay className="w-3 h-3" />
                <span className="hidden sm:inline">{s.browser === "brave" ? "🦁" : "🌐"} Focus</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
import { useState, useEffect } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { Shield, MonitorPlay, LayoutDashboard, Terminal, Radio, ListChecks, ShieldCheck, ScrollText, User, Settings, Users } from "lucide-react";
import { db } from "@/lib/db";
import Activate from "@/pages/Activate";
import { cfRequest, getDeviceId } from "@/lib/electronBridge";

const CF_ENDPOINT = "https://knull-activation.sloanbrack.workers.dev/activate";
const LICENSE_REFRESH_MS = 10 * 60 * 1000;
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/proxies", label: "Proxy Pool", icon: Shield },
  { path: "/sessions", label: "Sessions", icon: MonitorPlay },
  { path: "/discord", label: "Discord", icon: Radio },
  { path: "/accounts", label: "Accounts", icon: Users },
  { path: "/task-groups", label: "Task Groups", icon: ListChecks },
  { path: "/captcha", label: "Captcha", icon: ShieldCheck },
  { path: "/logs", label: "Logs", icon: ScrollText },
  { path: "/profiles", label: "Profiles", icon: User },
  { path: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout() {
  const location = useLocation();
  const [authState, setAuthState] = useState("checking"); // "checking" | "activated" | "needs_activation" | "blocked"

  useEffect(() => { checkActivation(); }, []);

  useEffect(() => {
    if (authState !== "activated") return;
    const timer = setInterval(() => {
      refreshLicense().catch(() => {});
    }, LICENSE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [authState]);

  const resolveDeviceId = async () => {
    const fallbackKey = "knull_device_id";
    try {
      const id = await getDeviceId();
      if (id && !String(id).includes("Not running in Electron")) return id;
    } catch {}

    let local = localStorage.getItem(fallbackKey);
    if (!local) {
      local = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(fallbackKey, local);
    }
    return local;
  };

  const requestLicense = async (action, record, extras = {}) => {
    const deviceId = await resolveDeviceId();
    return cfRequest(CF_ENDPOINT, {
      action,
      discord_id: record.discord_id,
      device_id: deviceId,
      ...extras,
    });
  };

  const refreshLicense = async () => {
    const rows = await db.DiscordVerify.list();
    const record = (Array.isArray(rows) ? rows : [])[0];
    if (!record?.verified || !record?.discord_id) return;

    let data = await requestLicense("refresh", record, {
      session_token: record.license_session_token || null,
    });

    // Fallback to full handshake when no token exists yet or refresh token expired.
    if (data?.error && !data?.blocked) {
      data = await requestLicense("handshake", record, {
        client_nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
    }

    if (data?.blocked) {
      await db.DiscordVerify.update(record.id, { verified: false, license_session_token: null });
      setAuthState("blocked");
      return;
    }

    if (data?.ok && data?.session_token) {
      await db.DiscordVerify.update(record.id, {
        last_checked: new Date().toISOString(),
        license_session_token: data.session_token,
        license_expires_at: data.expires_at,
        license_refresh_after: data.refresh_after,
      });
    }
  };

  const checkActivation = async () => {
    const rows = await db.DiscordVerify.list();
    const record = (Array.isArray(rows) ? rows : [])[0];

    if (!record?.verified || !record?.discord_id) {
      setAuthState("needs_activation");
      return;
    }

    // Re-validate with Cloudflare on every launch + establish a short-lived session token.
    try {
      const data = await requestLicense("handshake", record, {
        client_nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });

      if (data?.blocked || data?.error) {
        // Mark locally as unverified so they see the gate
        await db.DiscordVerify.update(record.id, { verified: false, license_session_token: null });
        setAuthState("blocked");
      } else {
        // Update last_checked + license token material (if available)
        await db.DiscordVerify.update(record.id, {
          last_checked: new Date().toISOString(),
          license_session_token: data.session_token || record.license_session_token || null,
          license_expires_at: data.expires_at || record.license_expires_at || null,
          license_refresh_after: data.refresh_after || record.license_refresh_after || null,
        });
        setAuthState("activated");
      }
    } catch {
      // Offline grace: allow cached sessions for a bounded time window.
      const lastSeenMs = record.last_checked ? new Date(record.last_checked).getTime() : 0;
      if (lastSeenMs && Date.now() - lastSeenMs < OFFLINE_GRACE_MS) setAuthState("activated");
      else setAuthState("needs_activation");
    }
  };

  if (authState === "checking") return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: "#06060c" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
        <p className="text-[10px] font-mono text-gray-500 tracking-widest uppercase">Verifying access…</p>
      </div>
    </div>
  );

  if (authState === "needs_activation" || authState === "blocked") return (
    <>
      {authState === "blocked" && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-sm font-mono text-xs text-red-400">
          ⛔ Your access has been revoked. You must re-verify Discord membership.
        </div>
      )}
      <Activate onActivated={() => checkActivation()} />
    </>
  );

  return (
    <div className="min-h-screen text-gray-100" style={{ background: "#06060c" }}>
      {/* Technical grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,128,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,128,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />
      {/* Subtle scanline overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
        }}
      />
      {/* Top glow */}
      <div className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent pointer-events-none" />

      {/* Title bar — draggable, houses window controls */}
      <div
        className="relative flex items-center justify-between px-4 h-9 bg-[#05050a] border-b border-white/5 z-20 flex-shrink-0"
        style={{ WebkitAppRegion: "drag" }}
      >
        {/* Logo + name */}
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" }}>
          <div className="relative w-6 h-6 rounded-sm bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <span className="font-mono font-bold text-xs tracking-widest text-gray-200">
            KNULL<span className="text-emerald-400">'s</span> Queue Destroyer
          </span>
          <span className="text-[9px] font-mono text-gray-600 tracking-widest hidden sm:block">v1.0.0</span>
        </div>

        {/* Window controls */}
        {typeof window !== "undefined" && window.electronAPI && (
          <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: "no-drag" }}>
            <div className="hidden sm:flex items-center gap-1.5 text-[9px] font-mono text-gray-600 mr-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              SYS ONLINE
            </div>
            <button
              onClick={() => window.electronAPI.windowMinimize()}
              className="w-8 h-7 flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors font-mono text-base leading-none rounded-sm"
              title="Minimize"
            >─</button>
            <button
              onClick={() => window.electronAPI.windowMaximize()}
              className="w-8 h-7 flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors font-mono text-xs leading-none rounded-sm"
              title="Maximize / Restore"
            >□</button>
            <button
              onClick={() => window.electronAPI.windowClose()}
              className="w-8 h-7 flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-500/15 transition-colors font-mono text-sm leading-none rounded-sm"
              title="Close"
            >✕</button>
          </div>
        )}
      </div>

      {/* Nav bar */}
      <header className="relative border-b border-emerald-500/10 bg-[#08080f]/90 backdrop-blur-sm z-10">
        <div className="px-4 sm:px-6 h-10 flex items-center gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-mono transition-all border whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5 hover:border-white/5"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-3 bg-emerald-400 rounded-full" />
                )}
                <item.icon className="w-3 h-3" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Corner decorations */}
        <div className="absolute top-0 left-4 w-12 h-px bg-gradient-to-r from-emerald-500/30 to-transparent" />
        <div className="absolute top-0 left-4 w-px h-12 bg-gradient-to-b from-emerald-500/30 to-transparent" />
        <Outlet />
      </main>
    </div>
  );
}
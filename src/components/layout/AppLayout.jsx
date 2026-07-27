import { Outlet, Link, useLocation } from "react-router-dom";
import { Shield, MonitorPlay, LayoutDashboard, Terminal, Radio, ListChecks, ShieldCheck, ScrollText, User, Settings, Users, Minus, Square, X } from "lucide-react";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/proxies", label: "Proxy Pool", icon: Shield },
  { path: "/sessions", label: "Sessions", icon: MonitorPlay },
  { path: "/discord", label: "Discord Monitor", icon: Radio },
  { path: "/accounts", label: "Accounts", icon: Users },
  { path: "/task-groups", label: "Task Groups", icon: ListChecks },
  { path: "/captcha", label: "Captcha", icon: ShieldCheck },
  { path: "/logs", label: "Logs", icon: ScrollText },
  { path: "/profiles", label: "Profiles", icon: User },
  { path: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout() {
  const location = useLocation();

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
        className="relative flex items-center justify-between px-4 h-11 bg-gradient-to-r from-[#05050a] to-[#0a0a14] border-b border-emerald-500/20 z-20 flex-shrink-0"
        style={/** @type {any} */ ({ WebkitAppRegion: "drag" })}
      >
        {/* Logo + name */}
        <div className="flex items-center gap-2.5" style={/** @type {any} */ ({ WebkitAppRegion: "no-drag" })}>
          <div className="relative w-6 h-6 rounded-sm bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <span className="font-mono font-bold text-sm tracking-wide text-gray-100">
            KNULL<span className="text-emerald-400">'s</span> Queue Destroyer
          </span>
          <span className="text-xs font-mono text-gray-600 tracking-widest hidden sm:block ml-auto mr-4">v{APP_VERSION}</span>
        </div>

        {/* Window controls */}
        {typeof window !== "undefined" && window.electronAPI && (
          <div className="flex items-center gap-1" style={/** @type {any} */ ({ WebkitAppRegion: "no-drag" })}>
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-emerald-400/70 mr-2 pr-2 border-r border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              ONLINE
            </div>
            <button
              onClick={() => window.electronAPI.windowMinimize()}
              className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-emerald-300 hover:bg-emerald-500/15 transition-all rounded-sm border border-transparent hover:border-emerald-500/30"
              title="Minimize"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={() => window.electronAPI.windowMaximize()}
              className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-emerald-300 hover:bg-emerald-500/15 transition-all rounded-sm border border-transparent hover:border-emerald-500/30"
              title="Maximize / Restore"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => window.electronAPI.windowClose()}
              className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-red-500/20 transition-all rounded-sm border border-transparent hover:border-red-500/30"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Nav bar */}
      <header className="relative border-b border-emerald-500/15 bg-[#08080f]/80 backdrop-blur-md z-10 sticky top-0">
        <div className="px-4 sm:px-6 h-11 flex items-center gap-1 overflow-x-auto scroll-smooth scrollbar-hide">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-sm text-xs font-mono transition-all border whitespace-nowrap flex-shrink-0 font-semibold ${
                  isActive
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-500/10"
                    : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/8 hover:border-emerald-500/30"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-emerald-400 rounded-full shadow-lg shadow-emerald-400/50" />
                )}
                <item.icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-0 w-full px-3 sm:px-4 md:px-6 lg:px-8 py-5 overflow-y-auto">
        {/* Corner decorations */}
        <div className="absolute top-12 left-4 w-12 h-px bg-gradient-to-r from-emerald-500/25 to-transparent pointer-events-none" />
        <div className="absolute top-12 left-4 w-px h-12 bg-gradient-to-b from-emerald-500/25 to-transparent pointer-events-none" />
        <div className="mx-auto w-full max-w-[1680px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
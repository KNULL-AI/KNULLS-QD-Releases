import { useState, useEffect } from "react";
import { Terminal, Lock, Loader2, ShieldCheck, XCircle, LogIn } from "lucide-react";
import { db } from "@/lib/db";
import { discordOAuthLogin } from "@/lib/electronBridge";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";

const REQUIRED_SERVER_NAME  = "Pokemon Restocks and Alerts";
const REQUIRED_CHANNEL_NAME = "stock-snipers";
const CF_BASE = "https://knull-activation.sloanbrack.workers.dev";

export default function Activate({ onActivated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    const result = await discordOAuthLogin(CF_BASE);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if (result?.blocked) {
      setError("Your access has been revoked by an administrator.");
      setLoading(false);
      return;
    }

    if (!result?.ok || !result?.discord_id) {
      setError("Activation failed — make sure you are a member of " + REQUIRED_SERVER_NAME + " with access to #" + REQUIRED_CHANNEL_NAME + ".");
      setLoading(false);
      return;
    }

    // Persist locally
    const rows = await db.DiscordVerify.list();
    const existing = (Array.isArray(rows) ? rows : [])[0];
    const patch = {
      discord_id: result.discord_id,
      username: result.username,
      user_token: result.access_token,
      verified: true,
      server_found: true,
      channel_found: true,
      last_checked: new Date().toISOString(),
    };
    if (existing?.id) await db.DiscordVerify.update(existing.id, patch);
    else await db.DiscordVerify.create(patch);

    toast.success(`✅ Activated as ${result.username}`);
    setLoading(false);
    onActivated?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "#06060c" }}
    >
      {/* Background grid */}
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(rgba(0,255,128,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,128,0.03) 1px, transparent 1px)`,
        backgroundSize: "40px 40px",
      }} />
      <div className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent pointer-events-none" />

      <div className="relative w-full max-w-sm px-4">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="relative w-14 h-14 rounded-sm bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Terminal className="w-7 h-7 text-emerald-400" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-center">
            <h1 className="font-mono font-bold text-lg tracking-widest text-gray-100">
              KNULL<span className="text-emerald-400">'s</span> Queue Destroyer
            </h1>
            <p className="text-[10px] font-mono text-gray-500 mt-1 tracking-wider uppercase">Activation Required</p>
          </div>
        </div>

        {/* Card */}
        <div className="relative rounded-sm border border-white/5 bg-[#08080f] p-6 space-y-5">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-emerald-500/30" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-emerald-500/10" />

          {/* Requirement notice */}
          <div className="flex items-start gap-2.5 px-3 py-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-sm">
            <Lock className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div className="text-[10px] font-mono text-indigo-300 space-y-1">
              <p className="font-semibold">Discord membership required</p>
              <p className="text-indigo-400/70">
                You must be a member of <span className="text-indigo-200">{REQUIRED_SERVER_NAME}</span> with access to <span className="text-indigo-200">#{REQUIRED_CHANNEL_NAME}</span>.
              </p>
            </div>
          </div>

          {/* Login button */}
          <Button
            onClick={handleLogin}
            disabled={loading}
            className="w-full font-mono text-sm gap-2.5 py-5"
            style={{ background: "#5865F2" }}
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying with Discord…</>
              : <><LogIn className="w-4 h-4" /> Login with Discord</>}
          </Button>

          <p className="text-[10px] font-mono text-gray-600 text-center">
            A Discord login window will open. Sign in and grant access to continue.
          </p>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-sm">
              <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] font-mono text-red-400">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
import { useState, useEffect } from "react";
import {
  Terminal, MessageSquare, CheckCircle2, XCircle, Loader2,
  Hash, Lock, Info, Eye, EyeOff, ShieldCheck, User, RefreshCw
} from "lucide-react";
import { db } from "@/lib/db";
import { fetchDiscordGuilds, fetchDiscordGuildChannels, fetchDiscordMe } from "@/lib/electronBridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

// ── Config — update to match your server/channel ──────────────────────────────
const REQUIRED_SERVER_ID    = "1369077918244012072";
const REQUIRED_SERVER_NAME  = "Pokemon Restocks and Alerts";
const REQUIRED_CHANNEL_ID   = "1369077919758155940";
const REQUIRED_CHANNEL_NAME = "stock-snipers";

// Your Cloudflare Worker endpoint
const CF_ENDPOINT = "https://knull-activation.sloanbrack.workers.dev/activate";

async function cfRequest(body) {
  // Use Electron IPC bridge to avoid CORS restrictions in the renderer
  if (typeof window !== "undefined" && window.electronAPI?.cfRequest) {
    return window.electronAPI.cfRequest({ url: CF_ENDPOINT, body });
  }
  // Fallback for browser preview
  try {
    const res = await fetch(CF_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { error: "Could not reach activation server — check your internet connection" };
  }
}

// ── Steps: token → servers → channels → activating → done ────────────────────
export default function Activate({ onActivated }) {
  const [step, setStep] = useState("token");
  const [userToken, setUserToken] = useState("");

  // Pre-fill saved token on mount
  useEffect(() => {
    db.DiscordVerify.list().then((rows) => {
      const record = (Array.isArray(rows) ? rows : [])[0];
      if (record?.user_token) setUserToken(record.user_token);
    });
  }, []);
  const [showToken, setShowToken] = useState(false);

  const [loadingGuilds, setLoadingGuilds] = useState(false);
  const [guilds, setGuilds] = useState([]);
  const [selectedGuild, setSelectedGuild] = useState(null);

  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channels, setChannels] = useState([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);

  const [activating, setActivating] = useState(false);
  const [error, setError] = useState(null);
  const [guildSearch, setGuildSearch] = useState("");
  const [channelSearch, setChannelSearch] = useState("");

  // ── Step 1: load servers ────────────────────────────────────────────────────
  const loadGuilds = async () => {
    if (!userToken.trim()) return;
    setError(null);
    setLoadingGuilds(true);
    const result = await fetchDiscordGuilds(userToken.trim());
    setLoadingGuilds(false);
    if (result?.error) { setError(`Failed to load servers: ${result.error}`); return; }
    const list = result?.guilds || (Array.isArray(result) ? result : []);
    if (!list.length) { setError("No servers found for this token. Make sure you pasted the correct Authorization header."); return; }
    setGuilds(list);
    setStep("servers");
  };

  // ── Step 2: select server → load channels ───────────────────────────────────
  const selectGuild = async (guild) => {
    if (guild.id !== REQUIRED_SERVER_ID) {
      toast.error(`You must select "${REQUIRED_SERVER_NAME}"`);
      return;
    }
    setSelectedGuild(guild);
    setChannels([]); setSelectedChannelIds([]); setChannelSearch("");
    setLoadingChannels(true);
    const result = await fetchDiscordGuildChannels(userToken.trim(), guild.id);
    setLoadingChannels(false);
    if (result?.error) { setError(`Failed to load channels: ${result.error}`); return; }
    const list = result?.channels || (Array.isArray(result) ? result : []);
    setChannels(list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
    setStep("channels");
  };

  // ── Step 3: toggle channel ──────────────────────────────────────────────────
  const toggleChannel = (ch) => {
    setSelectedChannelIds((prev) =>
      prev.includes(ch.id) ? prev.filter((id) => id !== ch.id) : [...prev, ch.id]
    );
  };

  const hasRequiredChannel = selectedChannelIds.includes(REQUIRED_CHANNEL_ID) ||
    channels.some((c) => selectedChannelIds.includes(c.id) && c.name?.toLowerCase() === REQUIRED_CHANNEL_NAME);

  // ── Step 4: activate via Cloudflare ────────────────────────────────────────
  const activate = async () => {
    if (!hasRequiredChannel) { toast.error(`Select #${REQUIRED_CHANNEL_NAME} to continue`); return; }
    setActivating(true);
    setError(null);

    // Fetch Discord identity
    const me = await fetchDiscordMe(userToken.trim());
    if (me?.error || !me?.id) {
      setError("Could not fetch Discord identity — token may be invalid.");
      setActivating(false);
      return;
    }

    const payload = {
      action: "register",
      discord_id: me.id,
      username: me.username,
      discriminator: me.discriminator ?? "0",
      guild_id: REQUIRED_SERVER_ID,
      channel_id: REQUIRED_CHANNEL_ID,
      user_token: userToken.trim(),
    };

    const res = await cfRequest(payload);
    if (res?.error || res?.blocked) {
      setError(res.error || "Your account has been blocked. Contact the server admin.");
      setActivating(false);
      return;
    }

    // Persist locally
    const rows = await db.DiscordVerify.list();
    const existing = (Array.isArray(rows) ? rows : [])[0];
    const patch = {
      discord_id: me.id,
      username: me.username,
      user_token: userToken.trim(),
      verified: true,
      server_found: true,
      channel_found: true,
      last_checked: new Date().toISOString(),
    };
    if (existing?.id) await db.DiscordVerify.update(existing.id, patch);
    else await db.DiscordVerify.create(patch);

    toast.success(`✅ Activated as ${me.username}`);
    setActivating(false);
    onActivated?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto py-8"
      style={{ background: "#06060c" }}
    >
      {/* Background grid */}
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(rgba(0,255,128,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,128,0.03) 1px, transparent 1px)`,
        backgroundSize: "40px 40px",
      }} />
      <div className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent pointer-events-none" />

      <div className="relative w-full max-w-md px-4">
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
        <div className="relative rounded-sm border border-white/5 bg-[#08080f] p-5 space-y-5">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-emerald-500/30" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-emerald-500/10" />

          {/* Requirement notice */}
          <div className="flex items-start gap-2.5 px-3 py-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-sm">
            <Lock className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div className="text-[10px] font-mono text-indigo-300 space-y-1">
              <p className="font-semibold">Discord membership required to use this tool</p>
              <p className="text-indigo-400/70">
                You must be a member of <span className="text-indigo-200">{REQUIRED_SERVER_NAME}</span> and verify access to <span className="text-indigo-200">#{REQUIRED_CHANNEL_NAME}</span>.
              </p>
            </div>
          </div>

          {/* Step 1 — Token */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0 ${step === "token" ? "bg-indigo-500 text-white" : "bg-white/10 text-gray-400"}`}>1</span>
              <Label className="text-xs text-gray-400 font-mono">Paste Discord Authorization Token</Label>
            </div>

            <div className="rounded-sm border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 space-y-1.5">
              <p className="text-[10px] font-mono text-blue-400 font-semibold flex items-center gap-1.5"><Info className="w-3 h-3" /> How to get your token</p>
              <ol className="text-[10px] font-mono text-gray-400 space-y-0.5">
                <li>1. Open Discord in your <strong className="text-gray-200">browser</strong></li>
                <li>2. Press <strong className="text-gray-200">F12</strong> → Network tab</li>
                <li>3. Send any message</li>
                <li>4. Find the <strong className="text-gray-200">messages</strong> POST request</li>
                <li>5. Copy the <strong className="text-gray-200">Authorization</strong> header value</li>
              </ol>
              <p className="text-[10px] font-mono text-yellow-400/80">⚠ Never share your token with anyone else.</p>
            </div>

            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={userToken}
                onChange={(e) => setUserToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadGuilds()}
                placeholder="Paste Authorization header value"
                className="bg-white/5 border-white/10 font-mono text-sm pr-9 text-gray-100 placeholder:text-gray-600"
                autoComplete="new-password"
              />
              <button onClick={() => setShowToken((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            <Button
              onClick={loadGuilds}
              disabled={loadingGuilds || !userToken.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-700 font-mono text-xs gap-2"
            >
              {loadingGuilds
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading servers…</>
                : <><User className="w-3.5 h-3.5" /> Load My Servers</>}
            </Button>
          </div>

          {/* Step 2 — Server picker */}
          {(step === "servers" || step === "channels") && guilds.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0 ${step === "servers" ? "bg-indigo-500 text-white" : "bg-white/10 text-gray-400"}`}>2</span>
                <Label className="text-xs text-gray-400 font-mono">Select <span className="text-indigo-300">{REQUIRED_SERVER_NAME}</span></Label>
              </div>
              <Input
                value={guildSearch}
                onChange={(e) => setGuildSearch(e.target.value)}
                placeholder="Search servers…"
                className="bg-white/5 border-white/10 font-mono text-xs text-gray-100 placeholder:text-gray-600 h-7"
              />
              <div className="max-h-44 overflow-y-auto border border-white/10 rounded-sm bg-[#1a1a24] space-y-px p-1">
                {guilds.filter((g) => g.name.toLowerCase().includes(guildSearch.toLowerCase())).map((g) => {
                  const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=32` : null;
                  const initials = g.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                  const isRequired = g.id === REQUIRED_SERVER_ID;
                  const isSelected = selectedGuild?.id === g.id;
                  return (
                    <button key={g.id} onClick={() => selectGuild(g)}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-sm text-left text-xs font-mono transition-colors ${isSelected ? "bg-indigo-500/25 text-indigo-200" : isRequired ? "text-emerald-300 hover:bg-emerald-500/10" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"}`}>
                      {iconUrl
                        ? <img src={iconUrl} alt={g.name} className="w-5 h-5 rounded-full flex-shrink-0 object-cover" />
                        : <span className="w-5 h-5 rounded-full flex-shrink-0 bg-indigo-700/60 flex items-center justify-center text-[9px] font-bold text-indigo-200">{initials}</span>
                      }
                      <span className="flex-1 truncate">{g.name}</span>
                      {isRequired && <span className="text-[9px] font-mono text-emerald-400 border border-emerald-500/30 px-1 rounded-sm">Required ✓</span>}
                    </button>
                  );
                })}
              </div>
              {loadingChannels && (
                <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading channels…
                </div>
              )}
            </div>
          )}

          {/* Step 3 — Channel picker */}
          {step === "channels" && channels.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0 bg-indigo-500 text-white">3</span>
                <Label className="text-xs text-gray-400 font-mono">
                  Select <span className="text-indigo-300">#{REQUIRED_CHANNEL_NAME}</span> to confirm access
                </Label>
              </div>
              <Input
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder="Search channels…"
                className="bg-white/5 border-white/10 font-mono text-xs text-gray-100 placeholder:text-gray-600 h-7"
              />
              <div className="max-h-44 overflow-y-auto space-y-0.5 border border-white/5 rounded-sm p-1.5 bg-black/20">
                {channels.filter((ch) => ch.name?.toLowerCase().includes(channelSearch.toLowerCase())).map((ch) => {
                  const isRequired = ch.id === REQUIRED_CHANNEL_ID || ch.name?.toLowerCase() === REQUIRED_CHANNEL_NAME;
                  const isSelected = selectedChannelIds.includes(ch.id);
                  return (
                    <button key={ch.id} onClick={() => toggleChannel(ch)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-sm text-left text-[10px] font-mono transition-colors ${isSelected ? "bg-indigo-500/20 text-indigo-300" : isRequired ? "text-emerald-400/80 hover:bg-emerald-500/10" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"}`}>
                      <Hash className="w-3 h-3 flex-shrink-0" />
                      <span className="flex-1 truncate">{ch.name}</span>
                      {isRequired && <span className="text-[9px] font-mono text-emerald-400 border border-emerald-500/30 px-1 rounded-sm flex-shrink-0">Required</span>}
                      {isSelected && <span className="text-[9px] text-indigo-400 flex-shrink-0">✓</span>}
                    </button>
                  );
                })}
              </div>

              {!hasRequiredChannel && selectedChannelIds.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-sm text-[10px] font-mono text-amber-400">
                  <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Select <strong>#stock-snipers</strong> to unlock access</span>
                </div>
              )}

              <Button
                onClick={activate}
                disabled={activating || !hasRequiredChannel}
                className="w-full bg-emerald-600 hover:bg-emerald-700 font-mono text-xs gap-2"
              >
                {activating
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Activating…</>
                  : <><ShieldCheck className="w-3.5 h-3.5" /> Activate &amp; Unlock</>}
              </Button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-sm">
              <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] font-mono text-red-400">{error}</p>
            </div>
          )}

          {/* Start over */}
          {step !== "token" && (
            <button onClick={() => { setStep("token"); setGuilds([]); setSelectedGuild(null); setChannels([]); setSelectedChannelIds([]); setError(null); }}
              className="text-[10px] font-mono text-gray-600 hover:text-gray-400 flex items-center gap-1">
              <RefreshCw className="w-2.5 h-2.5" /> Start over
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
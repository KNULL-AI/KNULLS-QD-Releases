import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, Loader2, Hash,
  Lock, User, Info, RefreshCw, Eye, EyeOff
} from "lucide-react";
import { db } from "@/lib/db";
import { fetchDiscordGuilds, fetchDiscordGuildChannels } from "@/lib/electronBridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const REQUIRED_SERVER_ID   = "1369077918244012072";
const REQUIRED_SERVER_NAME = "Pokemon Restocks and Alerts";
const REQUIRED_CHANNEL_ID   = "1369077919758155940";
const REQUIRED_CHANNEL_NAME = "stock-snipers";

export default function DiscordLinkSection({ onVerified }) {
  const [record, setRecord] = useState(null);

  // Step state: 'token' | 'servers' | 'channels' | 'verified'
  const [step, setStep] = useState("token");
  const [userToken, setUserToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const [guilds, setGuilds] = useState([]);
  const [loadingGuilds, setLoadingGuilds] = useState(false);
  const [selectedGuild, setSelectedGuild] = useState(null);

  const [channels, setChannels] = useState([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);

  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const rows = await db.DiscordVerify.list();
      const r = (Array.isArray(rows) ? rows : [])[0] ?? null;
      setRecord(r);
      if (r?.verified) {
        setStep("verified");
        onVerified?.(true);
      } else {
        onVerified?.(false);
      }
    } catch {
      onVerified?.(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Step 1: load servers ──────────────────────────────────────────────────
  const loadGuilds = async () => {
    if (!userToken.trim()) { toast.error("Paste your Discord token first"); return; }
    setLoadingGuilds(true);
    setGuilds([]); setSelectedGuild(null); setChannels([]); setSelectedChannelIds([]);
    const result = await fetchDiscordGuilds(userToken.trim());
    setLoadingGuilds(false);
    if (result?.error) { toast.error(`Failed: ${result.error}`); return; }
    const list = result?.guilds || (Array.isArray(result) ? result : []);
    if (!list.length) { toast("No servers found for this token"); return; }
    setGuilds(list);
    setStep("servers");
  };

  // ── Step 2: select server → load channels ────────────────────────────────
  const selectGuild = async (guild) => {
    setSelectedGuild(guild);
    setChannels([]); setSelectedChannelIds([]);
    setLoadingChannels(true);
    const result = await fetchDiscordGuildChannels(userToken.trim(), guild.id);
    setLoadingChannels(false);
    if (result?.error) { toast.error(`Failed: ${result.error}`); return; }
    const list = result?.channels || (Array.isArray(result) ? result : []);
    setChannels(list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
    setStep("channels");
  };

  // ── Step 3: toggle channel selection ─────────────────────────────────────
  const toggleChannel = (ch) => {
    setSelectedChannelIds((prev) =>
      prev.includes(ch.id) ? prev.filter((id) => id !== ch.id) : [...prev, ch.id]
    );
  };

  // ── Step 4: verify & save ─────────────────────────────────────────────────
  const verify = async () => {
    const hasRequiredChannel = selectedChannelIds.includes(REQUIRED_CHANNEL_ID) ||
      channels.find((c) => selectedChannelIds.includes(c.id) && c.name?.toLowerCase() === REQUIRED_CHANNEL_NAME);

    if (!hasRequiredChannel) {
      toast.error(`You must select #${REQUIRED_CHANNEL_NAME} to gain access`);
      return;
    }

    setSaving(true);
    const patch = {
      user_token: userToken.trim(),
      verified: true,
      server_found: true,
      channel_found: true,
      last_checked: new Date().toISOString(),
    };
    if (record?.id) await db.DiscordVerify.update(record.id, patch);
    else await db.DiscordVerify.create(patch);
    toast.success("✅ Discord verified — community pool unlocked!");
    await load();
    setSaving(false);
  };

  // ── Revoke ────────────────────────────────────────────────────────────────
  const revoke = async () => {
    if (!record?.id) return;
    await db.DiscordVerify.update(record.id, { verified: false, user_token: "" });
    setStep("token");
    setUserToken(""); setGuilds([]); setSelectedGuild(null); setChannels([]); setSelectedChannelIds([]);
    await load();
    toast.success("Discord unlinked");
  };

  // ── Verified state ────────────────────────────────────────────────────────
  if (step === "verified") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 px-3 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-emerald-400 font-semibold">Discord Verified</p>
            <p className="text-[10px] font-mono text-gray-500 mt-0.5">
              Member of <span className="text-gray-300">{REQUIRED_SERVER_NAME}</span> · #{REQUIRED_CHANNEL_NAME}
            </p>
          </div>
          <button onClick={revoke} className="text-[10px] font-mono text-gray-600 hover:text-red-400 flex items-center gap-1 flex-shrink-0">
            <XCircle className="w-3 h-3" /> Unlink
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Requirement notice */}
      <div className="flex items-start gap-2 px-3 py-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-sm">
        <Lock className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="text-[10px] font-mono text-indigo-300 space-y-0.5">
          <p className="font-semibold">Community pool requires Discord membership</p>
          <p className="text-indigo-400/70">You must be a member of <span className="text-indigo-200">{REQUIRED_SERVER_NAME}</span> and select the <span className="text-indigo-200">#{REQUIRED_CHANNEL_NAME}</span> channel to verify.</p>
        </div>
      </div>

      {/* Step 1 — Token input */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0 ${step === "token" ? "bg-indigo-500 text-white" : "bg-white/10 text-gray-400"}`}>1</span>
          <Label className="text-xs text-gray-400 font-mono">Login with Discord</Label>
        </div>

        <div className="rounded-sm border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 space-y-1.5">
          <p className="text-[10px] font-mono text-blue-400 font-semibold flex items-center gap-1.5"><Info className="w-3 h-3" /> How to get your Discord user token</p>
          <ol className="text-[10px] font-mono text-gray-400 space-y-1">
            <li>1. Open Discord in your <strong className="text-gray-200">browser</strong> (discord.com)</li>
            <li>2. Press <strong className="text-gray-200">F12</strong> → Network tab</li>
            <li>3. Type any message in any channel</li>
            <li>4. Find the <strong className="text-gray-200">messages</strong> POST request</li>
            <li>5. Under Request Headers, copy the <strong className="text-gray-200">Authorization</strong> value</li>
          </ol>
          <p className="text-[10px] font-mono text-yellow-400/80">⚠ Never share your user token. It gives full account access.</p>
        </div>

        <div className="relative">
          <Input
            type={showToken ? "text" : "password"}
            value={userToken}
            onChange={(e) => setUserToken(e.target.value)}
            placeholder="Paste Authorization header value"
            className="bg-white/5 border-white/10 font-mono text-sm pr-9"
            autoComplete="new-password"
          />
          <button onClick={() => setShowToken((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>

        <Button onClick={loadGuilds} disabled={loadingGuilds || !userToken.trim()}
          className="w-full bg-indigo-600 hover:bg-indigo-700 font-mono text-xs gap-2">
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
            <Label className="text-xs text-gray-400 font-mono">Select Server — <span className="text-indigo-300">{REQUIRED_SERVER_NAME}</span></Label>
          </div>
          <div className="max-h-48 overflow-y-auto border border-white/10 rounded-sm bg-[#1a1a24] space-y-px p-1">
            {guilds.map((g) => {
              const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=32` : null;
              const initials = g.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
              const isRequired = g.id === REQUIRED_SERVER_ID || g.name?.toLowerCase().includes("pokemon restocks");
              const isSelected = selectedGuild?.id === g.id;
              return (
                <button key={g.id} onClick={() => selectGuild(g)}
                  className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-sm text-left text-xs font-mono transition-colors ${isSelected ? "bg-indigo-500/25 text-indigo-200" : "text-gray-300 hover:bg-white/5 hover:text-gray-100"}`}>
                  {iconUrl
                    ? <img src={iconUrl} alt={g.name} className="w-5 h-5 rounded-full flex-shrink-0 object-cover" />
                    : <span className="w-5 h-5 rounded-full flex-shrink-0 bg-indigo-700/60 flex items-center justify-center text-[9px] font-bold text-indigo-200">{initials}</span>
                  }
                  <span className="flex-1 truncate">{g.name}</span>
                  {isRequired && <span className="text-[9px] font-mono text-emerald-400 border border-emerald-500/30 px-1 rounded-sm">Required</span>}
                  {isSelected && <span className="text-[9px] text-indigo-400">✓</span>}
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
              Select Channels — <span className="text-indigo-300">#{REQUIRED_CHANNEL_NAME} required</span>
            </Label>
          </div>

          <div className="max-h-48 overflow-y-auto space-y-0.5 border border-white/5 rounded-sm p-1.5 bg-black/20">
            {channels.map((ch) => {
              const isRequired = ch.id === REQUIRED_CHANNEL_ID || ch.name?.toLowerCase() === REQUIRED_CHANNEL_NAME;
              const isSelected = selectedChannelIds.includes(ch.id);
              return (
                <button key={ch.id} onClick={() => toggleChannel(ch)}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded-sm text-left text-[10px] font-mono transition-colors ${isSelected ? "bg-indigo-500/20 text-indigo-300" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"}`}>
                  <Hash className="w-3 h-3 flex-shrink-0" />
                  <span className="flex-1 truncate">{ch.name}</span>
                  {isRequired && <span className="text-[9px] font-mono text-emerald-400 border border-emerald-500/30 px-1 rounded-sm flex-shrink-0">Required</span>}
                  {isSelected && <span className="text-[9px] text-indigo-400 flex-shrink-0">✓</span>}
                </button>
              );
            })}
          </div>

          {selectedChannelIds.length > 0 && (
            <p className="text-[10px] font-mono text-gray-600">{selectedChannelIds.length} channel{selectedChannelIds.length !== 1 ? "s" : ""} selected</p>
          )}

          {/* Warn if required channel not selected */}
          {selectedChannelIds.length > 0 &&
            !selectedChannelIds.includes(REQUIRED_CHANNEL_ID) &&
            !channels.find((c) => selectedChannelIds.includes(c.id) && c.name?.toLowerCase() === REQUIRED_CHANNEL_NAME) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-sm text-[10px] font-mono text-amber-400">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>You must select <strong>#stock-snipers</strong> to verify</span>
            </div>
          )}

          <Button onClick={verify} disabled={saving || selectedChannelIds.length === 0}
            className="w-full bg-emerald-600 hover:bg-emerald-700 font-mono text-xs gap-2">
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying…</>
              : <><CheckCircle2 className="w-3.5 h-3.5" /> Confirm &amp; Verify Access</>}
          </Button>
        </div>
      )}

      {/* Reset link */}
      {step !== "token" && (
        <button onClick={() => { setStep("token"); setGuilds([]); setSelectedGuild(null); setChannels([]); setSelectedChannelIds([]); }}
          className="text-[10px] font-mono text-gray-600 hover:text-gray-400 flex items-center gap-1">
          <RefreshCw className="w-2.5 h-2.5" /> Start over
        </button>
      )}
    </div>
  );
}
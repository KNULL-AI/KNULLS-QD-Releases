import { useState, useEffect, useRef } from "react";
import { Radio, Plus, Trash2, Play, Square, ChevronUp, ChevronDown, X, User, Bot, Info, Hash, ShoppingCart, RefreshCw, Edit2, ScrollText, Zap, AlertTriangle, Clock, Swords } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { launchBrowser, fetchDiscordMessages, fetchDiscordGuilds, fetchDiscordGuildChannels } from "@/lib/electronBridge";

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildAuthHeader(monitor) {
  const token = monitor.auth_mode === "bot_token" ? monitor.bot_token : monitor.user_token;
  return monitor.auth_mode === "bot_token" ? `Bot ${token}` : token;
}

async function fetchMessages(authHeader, channelId, afterId) {
  const result = await fetchDiscordMessages(authHeader, channelId, afterId);
  if (result.error) throw new Error(result.error);
  return Array.isArray(result.messages) ? result.messages : [];
}

/** Extract all URLs from a Discord message object or raw content string.
 *  Handles:
 *  1. Plain-text URLs:          https://walmart.com/ip/12345
 *  2. Markdown hyperlinks:      [Queue detected](https://walmart.com/ip/12345)
 *  3. Discord embed URLs:       message.embeds[].url / embeds[].fields[].value
 */
function extractUrls(contentOrMsg) {
  const results = [];

  // Accept either a raw string (legacy) or a full Discord message object
  const content = typeof contentOrMsg === "string" ? contentOrMsg : (contentOrMsg?.content || "");
  const embeds = typeof contentOrMsg === "object" ? (contentOrMsg?.embeds || []) : [];

  // 1. Markdown links: [label](url)
  const mdLinks = [...(content?.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g) || [])];
  for (const m of mdLinks) results.push(m[2]);

  // 2. Plain-text URLs (after stripping markdown links to avoid dupes)
  const stripped = content?.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, "") || "";
  const plain = stripped.match(/https?:\/\/[^\s<>"]+/g) || [];
  results.push(...plain);

  // 3. Discord embed urls
  for (const embed of embeds) {
    if (embed.url) results.push(embed.url);
    // Embed description may also contain URLs
    if (embed.description) {
      const dMd = [...(embed.description.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g))];
      for (const m of dMd) results.push(m[2]);
      const dPlain = embed.description.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, "").match(/https?:\/\/[^\s<>"]+/g) || [];
      results.push(...dPlain);
    }
    // Embed fields
    for (const field of (embed.fields || [])) {
      const fMd = [...(field.value?.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g) || [])];
      for (const m of fMd) results.push(m[2]);
      const fPlain = field.value?.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, "").match(/https?:\/\/[^\s<>"]+/g) || [];
      results.push(...fPlain);
    }
  }

  // Dedupe while preserving order
  return [...new Set(results)];
}

// ── Global in-memory event log (shared across all MonitorCards) ───────────────
// Using a module-level array + subscriber list so cards can push without prop drilling
const _discordLog = [];
const _logSubs = new Set();
function pushLog(entry) {
  _discordLog.unshift({ ...entry, ts: new Date() });
  if (_discordLog.length > 500) _discordLog.length = 500;
  _logSubs.forEach((cb) => cb([..._discordLog]));
}
function useDiscordLog() {
  const [log, setLog] = useState([..._discordLog]);
  useEffect(() => {
    const cb = (l) => setLog(l);
    _logSubs.add(cb);
    return () => _logSubs.delete(cb);
  }, []);
  return log;
}

/** Normalize a URL for comparison: strip query params and trailing slash */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

/** Test a keyword against a message — supports regex if wrapped in /.../ */
function matchesKeyword(content, keyword) {
  if (!keyword) return true; // no keyword = any message triggers
  const regexMatch = keyword.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[1], regexMatch[2]).test(content);
    } catch (_) {}
  }
  return content?.toLowerCase().includes(keyword.toLowerCase());
}

function pickProxy(proxies, mode, index) {
  if (!proxies.length) return null;
  if (mode === "random") return proxies[Math.floor(Math.random() * proxies.length)];
  return proxies[index % proxies.length]; // round_robin or sticky
}

async function runTaskGroup(tg) {
  let proxies = [];
  if (tg.proxy_group_id) {
    const pg = await db.ProxyGroup.get(tg.proxy_group_id);
    if (pg?.proxy_ids?.length) {
      const fetched = await Promise.all(pg.proxy_ids.map((id) => db.Proxy.get(id).catch(() => null)));
      proxies = fetched.filter(Boolean);
    }
  }
  // No proxy group set = direct connection (no proxy)

  const count = tg.instance_count || 1;
  const mode = tg.rotation_mode || "round_robin";
  const now = new Date().toISOString();

  const assignedProxies = Array.from({ length: count }, (_, i) => pickProxy(proxies, mode, i));

  // Bulk-create all session records in one IPC call
  const sessions = await db.BrowserSession.bulkCreate(
    assignedProxies.map((proxy, i) => ({
      name: `[AUTO] ${tg.name} #${i + 1}`,
      target_url: tg.target_url,
      proxy_id: proxy?.id || null,
      proxy_label: proxy ? `${proxy.host}:${proxy.port}` : "No proxy",
      status: "running",
      rotation_mode: mode,
      user_agent: tg.user_agent || null,
      browser: tg.browser || "chrome",
      started_at: now,
    }))
  );

  for (let i = 0; i < sessions.length; i++) {
    launchBrowser({ sessionId: sessions[i].id, url: tg.target_url, proxy: assignedProxies[i], userAgent: tg.user_agent || null, browser: tg.browser || "chrome" });
    if (tg.delay_ms > 0 && i < sessions.length - 1) await new Promise((r) => setTimeout(r, tg.delay_ms));
  }
}

// ── Walmart Item Panel ────────────────────────────────────────────────────────
function WalmartItemPanel({ assignedGroups, onManualLaunch, launchedIds }) {
  const [manualUrl, setManualUrl] = useState("");

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Walmart Item Pool — Manual Pre-Launch</p>

      {/* Manual URL launcher */}
      <div className="flex gap-2">
        <Input
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          placeholder="Paste item URL to launch matching task group…"
          className="bg-white/5 border-white/10 font-mono text-[11px] h-7 flex-1"
        />
        <button
          onClick={() => {
            if (!manualUrl.trim()) return;
            const norm = normalizeUrl(manualUrl.trim());
            const match = assignedGroups.find((tg) => normalizeUrl(tg.target_url) === norm);
            if (!match) {
              toast.error(`No task group matches: ${manualUrl.trim()}`);
            } else {
              onManualLaunch(match);
              setManualUrl("");
            }
          }}
          className="px-2.5 py-1 rounded-sm border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-[10px] font-mono hover:bg-yellow-500/20 transition-all whitespace-nowrap"
        >
          ▶ Launch
        </button>
      </div>

      {/* Per-item status rows */}
      {assignedGroups.map((tg) => {
        const launched = launchedIds.has(tg.id);
        return (
          <div key={tg.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-sm border ${launched ? "border-green-500/20 bg-green-500/5" : "border-white/5 bg-white/[0.02]"}`}>
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${launched ? "bg-green-400" : "bg-gray-700"}`} />
            <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
            <span className="text-[9px] font-mono text-gray-600 truncate max-w-[130px]">{tg.target_url}</span>
            {launched
              ? <span className="text-[9px] font-mono text-green-400 flex-shrink-0">launched</span>
              : <button onClick={() => onManualLaunch(tg)} className="text-[9px] font-mono text-yellow-400 hover:text-yellow-300 border border-yellow-500/20 px-1.5 py-0.5 rounded-sm hover:bg-yellow-500/10 transition-all flex-shrink-0">▶ Start</button>
            }
          </div>
        );
      })}
    </div>
  );
}

// ── Costco Manual URL Panel ───────────────────────────────────────────────────
function CostcoManualPanel({ assignedGroups, onManualLaunch }) {
  const [manualUrl, setManualUrl] = useState("");

  const launch = async () => {
    if (!manualUrl.trim() || !assignedGroups.length) return;
    for (const tg of assignedGroups) {
      await db.TaskGroup.update(tg.id, { target_url: manualUrl.trim() });
      await onManualLaunch({ ...tg, target_url: manualUrl.trim() });
    }
    setManualUrl("");
    toast.success(`🛒 Costco manual launch — ${assignedGroups.length} group(s) updated & fired`);
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Costco Drop Groups — auto-updated on trigger</p>
      {assignedGroups.map((tg) => (
        <div key={tg.id} className="flex items-center gap-2 px-2 py-1.5 bg-orange-500/5 border border-orange-500/10 rounded-sm">
          <RefreshCw className="w-3 h-3 text-orange-400 flex-shrink-0" />
          <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
          <span className="text-[10px] font-mono text-gray-600">{tg.instance_count} inst</span>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Input
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          placeholder="Manual URL if polling fails…"
          className="bg-white/5 border-white/10 font-mono text-[11px] h-7 flex-1"
        />
        <button
          onClick={launch}
          disabled={!manualUrl.trim()}
          className="px-2.5 py-1 rounded-sm border border-orange-500/30 bg-orange-500/10 text-orange-300 text-[10px] font-mono hover:bg-orange-500/20 transition-all whitespace-nowrap disabled:opacity-40"
        >
          ▶ Launch
        </button>
      </div>
    </div>
  );
}

// ── Edit Monitor Dialog ───────────────────────────────────────────────────────
function EditMonitorDialog({ monitor, taskGroups, onSaved }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [userToken, setUserToken] = useState(monitor.user_token || "");
  const [botToken, setBotToken] = useState(monitor.bot_token || "");
  const [pollInterval, setPollInterval] = useState(String(monitor.poll_interval_seconds || 5));
  const [cooldownSeconds, setCooldownSeconds] = useState(String(monitor.cooldown_seconds ?? 600));
  const [channels, setChannels] = useState(monitor.channels || []);
  const [selectedTaskGroupIds, setSelectedTaskGroupIds] = useState(monitor.task_group_ids || []);

  // Guild/channel picker
  const [guilds, setGuilds] = useState([]);
  const [selectedGuildId, setSelectedGuildId] = useState("");
  const [guildChannels, setGuildChannels] = useState([]);
  const [loadingGuilds, setLoadingGuilds] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);

  const currentToken = monitor.auth_mode === "user_token" ? userToken : botToken;
  const authHeader = monitor.auth_mode === "bot_token" ? `Bot ${currentToken}` : currentToken;

  const loadGuilds = async () => {
    if (!currentToken.trim()) { toast.error("Paste your token first"); return; }
    setLoadingGuilds(true);
    setGuilds([]); setGuildChannels([]); setSelectedGuildId("");
    const result = await fetchDiscordGuilds(authHeader);
    setLoadingGuilds(false);
    if (result.error) { toast.error(`Failed: ${result.error}`); return; }
    setGuilds(result.guilds || []);
    if (!result.guilds?.length) toast("No servers found for this token");
  };

  const loadChannels = async (guildId) => {
    setSelectedGuildId(guildId);
    setGuildChannels([]);
    if (!guildId) return;
    setLoadingChannels(true);
    const result = await fetchDiscordGuildChannels(authHeader, guildId);
    setLoadingChannels(false);
    if (result.error) { toast.error(`Failed: ${result.error}`); return; }
    setGuildChannels((result.channels || []).sort((a, b) => a.position - b.position));
  };

  const toggleChannel = (ch) => {
    setChannels((prev) => {
      const exists = prev.find((c) => c.channel_id === ch.id);
      if (exists) return prev.filter((c) => c.channel_id !== ch.id);
      return [...prev, { label: ch.name, channel_id: ch.id, keyword: "", last_message_id: null }];
    });
  };

  const updateChannelKeyword = (channelId, keyword) => {
    setChannels((prev) => prev.map((c) => c.channel_id === channelId ? { ...c, keyword } : c));
  };

  const removeChannel = (channelId) => setChannels((prev) => prev.filter((c) => c.channel_id !== channelId));

  const addTG = (id) => { if (id && !selectedTaskGroupIds.includes(id)) setSelectedTaskGroupIds((p) => [...p, id]); };
  const removeTG = (id) => setSelectedTaskGroupIds((p) => p.filter((x) => x !== id));

  const submit = async () => {
    setLoading(true);
    await db.DiscordMonitor.update(monitor.id, {
      user_token: monitor.auth_mode === "user_token" ? userToken : monitor.user_token,
      bot_token: monitor.auth_mode === "bot_token" ? botToken : monitor.bot_token,
      channels: channels.map((ch) => ({ label: ch.label || ch.channel_id, channel_id: ch.channel_id, keyword: ch.keyword || null, last_message_id: ch.last_message_id || null })),
      poll_interval_seconds: Number(pollInterval),
      cooldown_seconds: Number(cooldownSeconds),
      task_group_ids: selectedTaskGroupIds,
    });
    toast.success("Monitor updated");
    setOpen(false);
    setLoading(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-1.5 text-gray-500 hover:text-violet-400 hover:bg-violet-500/10 rounded transition-colors" title="Edit monitor">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d16] border-white/10 text-gray-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-mono text-sm text-violet-400">Edit — {monitor.name}</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-3">
          {/* Token */}
          {monitor.auth_mode === "user_token" ? (
            <div>
              <Label className="text-xs text-gray-400 font-mono">Discord User Token</Label>
              <Input type="password" value={userToken} onChange={(e) => setUserToken(e.target.value)} placeholder="Paste updated Authorization header value" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              <p className="text-[10px] font-mono text-yellow-400/70 mt-1">⚠ Update this if you're getting 401 errors</p>
            </div>
          ) : (
            <div>
              <Label className="text-xs text-gray-400 font-mono">Discord Bot Token</Label>
              <Input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="Bot token from Developer Portal" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
            </div>
          )}

          {/* Channel Picker */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400 font-mono">Discord Channels</Label>

            <button
              onClick={loadGuilds}
              disabled={loadingGuilds || !currentToken.trim()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-sm border border-violet-500/30 bg-violet-500/10 text-violet-300 font-mono text-xs hover:bg-violet-500/20 disabled:opacity-40 transition-all"
            >
              {loadingGuilds
                ? <><div className="w-3 h-3 border border-violet-400/40 border-t-violet-300 rounded-full animate-spin" /> Loading servers…</>
                : <><Hash className="w-3.5 h-3.5" /> {guilds.length > 0 ? `Reload Servers (${guilds.length} loaded)` : "Load My Servers"}</>
              }
            </button>

            {guilds.length > 0 && (
              <div>
                <Label className="text-[10px] text-gray-500 font-mono">Select Server</Label>
                <div className="mt-0.5 max-h-48 overflow-y-auto border border-white/10 rounded-sm bg-[#1a1a24] space-y-px p-1">
                  {guilds.map((g) => {
                    const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=32` : null;
                    const initials = g.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                    return (
                      <button
                        key={g.id}
                        onClick={() => loadChannels(g.id)}
                        className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-sm text-left text-xs font-mono transition-colors ${selectedGuildId === g.id ? "bg-violet-500/25 text-violet-200" : "text-gray-300 hover:bg-white/5 hover:text-gray-100"}`}
                      >
                        {iconUrl ? (
                          <img src={iconUrl} alt={g.name} className="w-5 h-5 rounded-full flex-shrink-0 object-cover" onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
                        ) : null}
                        <span className={`w-5 h-5 rounded-full flex-shrink-0 bg-violet-700/60 items-center justify-center text-[9px] font-bold text-violet-200 ${iconUrl ? "hidden" : "flex"}`}>{initials}</span>
                        <span className="flex-1 truncate">{g.name}</span>
                        {selectedGuildId === g.id && <span className="text-[9px] text-violet-400">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {loadingChannels && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500 py-1">
                <div className="w-3 h-3 border border-gray-600 border-t-gray-400 rounded-full animate-spin" /> Loading channels…
              </div>
            )}
            {guildChannels.length > 0 && (
              <div className="max-h-36 overflow-y-auto space-y-0.5 border border-white/5 rounded-sm p-1.5 bg-black/20">
                {guildChannels.map((ch) => {
                  const isSelected = channels.some((c) => c.channel_id === ch.id);
                  return (
                    <button
                      key={ch.id}
                      onClick={() => toggleChannel(ch)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-sm text-left text-[10px] font-mono transition-colors ${isSelected ? "bg-violet-500/20 text-violet-300" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"}`}
                    >
                      <Hash className="w-3 h-3 flex-shrink-0" />
                      <span className="flex-1 truncate">{ch.name}</span>
                      {isSelected && <span className="text-[9px] text-violet-400">✓ added</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selected channels with keyword inputs */}
            {channels.length > 0 && (
              <div className="space-y-1.5 mt-1">
                <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">{channels.length} channel{channels.length !== 1 ? "s" : ""} selected</p>
                {channels.map((ch) => (
                  <div key={ch.channel_id} className="flex items-center gap-2 px-2 py-1.5 bg-violet-500/5 border border-violet-500/10 rounded-sm">
                    <Hash className="w-2.5 h-2.5 text-violet-400 flex-shrink-0" />
                    <span className="text-[10px] font-mono text-gray-200 w-28 truncate flex-shrink-0">#{ch.label || ch.channel_id}</span>
                    <Input
                      value={ch.keyword || ""}
                      onChange={(e) => updateChannelKeyword(ch.channel_id, e.target.value)}
                      placeholder="keyword (blank=any)"
                      className="bg-white/5 border-white/10 font-mono text-[10px] h-6 flex-1 min-w-0"
                    />
                    <button onClick={() => removeChannel(ch.channel_id)} className="text-gray-600 hover:text-red-400 flex-shrink-0"><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}

            {guilds.length === 0 && (
              <p className="text-[10px] font-mono text-gray-600">↑ Click "Load My Servers" to browse and select channels from your Discord.</p>
            )}
          </div>

          {/* Task groups */}
          <div>
            <Label className="text-xs text-gray-400 font-mono">Task Groups</Label>
            {/* Retailer bundle quick-add */}
            {(() => {
              const retailers = [...new Set(taskGroups.map((t) => t.retailer).filter(Boolean))];
              if (!retailers.length) return null;
              return (
                <div className="flex flex-wrap gap-1 mt-1 mb-1">
                  {retailers.map((r) => {
                    const ids = taskGroups.filter((t) => t.retailer === r).map((t) => t.id);
                    const allAdded = ids.every((id) => selectedTaskGroupIds.includes(id));
                    return (
                      <button
                        key={r}
                        onClick={() => {
                          if (allAdded) {
                            setSelectedTaskGroupIds((prev) => prev.filter((id) => !ids.includes(id)));
                          } else {
                            setSelectedTaskGroupIds((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
                          }
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-mono transition-all ${allAdded ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-white/10 bg-white/5 text-gray-400 hover:border-blue-500/30 hover:text-blue-300"}`}
                      >
                        {allAdded ? "✓" : "+"} {r} <span className="text-gray-600">({ids.length})</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <Select onValueChange={addTG} value="">
              <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue placeholder="+ Add task group…" /></SelectTrigger>
              <SelectContent className="bg-[#1a1a24] border-white/10">
                {taskGroups.filter((t) => !selectedTaskGroupIds.includes(t.id)).map((t) => (
                <SelectItem key={t.id} value={t.id} className="font-mono text-xs text-gray-100">{t.retailer ? `[${t.retailer}] ` : ""}{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTaskGroupIds.map((id) => {
              const tg = taskGroups.find((t) => t.id === id);
              if (!tg) return null;
              return (
                <div key={id} className="flex items-center gap-2 px-2 py-1.5 mt-1 bg-blue-500/5 border border-blue-500/10 rounded-sm">
                  <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
                  <button onClick={() => removeTG(id)} className="text-gray-600 hover:text-red-400"><X className="w-3 h-3" /></button>
                </div>
              );
            })}
          </div>

          {/* Timing */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-400 font-mono">Poll Interval (sec)</Label>
              <Input type="number" min="0.1" step="0.1" max="60" value={pollInterval} onChange={(e) => setPollInterval(e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs text-gray-400 font-mono">Cooldown (sec)</Label>
              <Input type="number" min="5" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
            </div>
          </div>

          <Button onClick={submit} disabled={loading || channels.length === 0} className="w-full bg-violet-600 hover:bg-violet-700 font-mono text-xs">
            {loading ? "Saving…" : `Save Changes — ${channels.length} channel${channels.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Monitor Card ──────────────────────────────────────────────────────────────
function MonitorCard({ monitor, taskGroups, onUpdate, onDelete }) {
  const [active, setActive] = useState(monitor.is_active);
  const [lastEvents, setLastEvents] = useState([]); // [{channelLabel, time, instances}]
  const [errors, setErrors] = useState({});
  const [launchedIds, setLaunchedIds] = useState(new Set()); // tracks manually/auto launched TG ids this session
  const timerRef = useRef(null);       // holds the current setTimeout handle
  const runningRef = useRef(false);    // true while a poll is in flight — prevents stacking
  const activeRef = useRef(monitor.is_active); // read inside async poll without stale closure
  const monitorIdRef = useRef(monitor.id);
  const monitorNameRef = useRef(monitor.name);
  const intervalMsRef = useRef((monitor.poll_interval_seconds || 5) * 1000);
  const launchedIdsRef = useRef(new Set());
  const taskGroupsRef = useRef(taskGroups);
  // In-memory cursor cache: channelId → last_message_id (avoids DB-write race on fast polls)
  const cursorCacheRef = useRef({});
  // In-memory set of message IDs that have already triggered a launch this session
  const firedMessageIdsRef = useRef(new Set());
  useEffect(() => { taskGroupsRef.current = taskGroups; }, [taskGroups]);
  const syncLaunchedIds = (newSet) => { launchedIdsRef.current = newSet; setLaunchedIds(newSet); };

  const stopLoop = () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const poll = async () => {
    // Guard: skip this tick if a previous poll is still running
    if (runningRef.current) {
      scheduleNext();
      return;
    }
    runningRef.current = true;
    try {
      const fresh = await db.DiscordMonitor.get(monitorIdRef.current);
      if (!fresh.is_active) { stopLoop(); activeRef.current = false; setActive(false); return; }

      // Update interval in case it changed via Edit
      intervalMsRef.current = (fresh.poll_interval_seconds || 5) * 1000;

      const channels = fresh.channels || [];
      if (!channels.length) { scheduleNext(); return; }

      const authHeader = buildAuthHeader(fresh);
      const updatedChannels = [...channels];
      let triggered = false;
      let totalInstances = 0;
      let triggerChannelLabel = "";
      let triggerMsgContent = null;
      const newErrors = {};

      // ── Fetch ALL channels in parallel ──────────────────────────────────────
      // Use in-memory cursor cache to avoid DB-write race on fast poll intervals
      const results = await Promise.allSettled(
        channels.map((ch) => {
          const cachedCursor = cursorCacheRef.current[ch.channel_id] ?? ch.last_message_id;
          return fetchMessages(authHeader, ch.channel_id, cachedCursor);
        })
      );

      for (let ci = 0; ci < channels.length; ci++) {
        const ch = channels[ci];
        const result = results[ci];
        if (result.status === "rejected") {
          newErrors[ch.channel_id] = result.reason?.message || String(result.reason);
          pushLog({ type: "error", monitor: monitorNameRef.current, channel: ch.label || ch.channel_id, msg: newErrors[ch.channel_id] });
          continue;
        }
        const msgs = result.value;
        if (!msgs.length) continue;

        const lastId = msgs[msgs.length - 1].id;
        // Update in-memory cursor immediately so next poll doesn't re-fetch these
        cursorCacheRef.current[ch.channel_id] = lastId;
        updatedChannels[ci] = { ...ch, last_message_id: lastId };

        if (!triggered) {
          const keyword = ch.keyword?.trim();
          // Pokemon Center: override keyword to match its specific trigger phrases
          const isPokemon = fresh.retailer_type === "pokemon_center";
          const pokemonMatch = (content) =>
            content?.toLowerCase().includes("security change detected") ||
            content?.toLowerCase().includes("queue detected");

          // Find first message that matches keyword AND hasn't already fired a launch
          const triggerMsg = msgs.find((m) =>
            (isPokemon ? pokemonMatch(m.content) : matchesKeyword(m.content, keyword)) &&
            !firedMessageIdsRef.current.has(m.id)
          );
          if (triggerMsg) {
            triggered = true;
            triggerChannelLabel = ch.label || ch.channel_id;
            triggerMsgContent = triggerMsg;
            // Mark this message ID as fired immediately to block duplicate triggers
            firedMessageIdsRef.current.add(triggerMsg.id);
            pushLog({ type: "trigger", monitor: monitorNameRef.current, channel: ch.label || ch.channel_id, msg: triggerMsg.content?.slice(0, 120) || "(embed)" });
          }
        }
      }

      // Cooldown guard — for Walmart mode, cooldown is per-URL (handled inside launch block),
      // so skip the global cooldown check to allow different items to trigger freely.
      let cooldownActive = false;
      if (triggered && fresh.retailer_type !== "walmart" && fresh.last_triggered) {
        const msSinceLast = Date.now() - new Date(fresh.last_triggered).getTime();
        const cooldownMs = (fresh.cooldown_seconds ?? 600) * 1000;
        if (msSinceLast < cooldownMs) {
          triggered = false;
          cooldownActive = true;
          const remaining = Math.ceil((cooldownMs - msSinceLast) / 1000);
          pushLog({ type: "cooldown", monitor: monitorNameRef.current, channel: triggerChannelLabel, msg: `Cooldown suppressed re-trigger — ${remaining}s remaining` });
          setErrors((prev) => ({ ...prev, _cooldown: `Cooldown active — ${remaining}s remaining` }));
        } else {
          setErrors((prev) => { const e = { ...prev }; delete e._cooldown; return e; });
        }
      }

      // Persist updated cursors FIRST — but DON'T advance cursor if cooldown suppressed
      // so the trigger message is re-evaluated once the cooldown expires
      const updatePayload = { channels: cooldownActive ? channels : updatedChannels };
      if (triggered) {
        updatePayload.last_triggered = new Date().toISOString();
        updatePayload.trigger_count = (fresh.trigger_count || 0) + 1;
      }
      await db.DiscordMonitor.update(fresh.id, updatePayload);

      // Launch task groups
      if (triggered) {
        const pool = (fresh.task_group_ids || []).map((id) => taskGroupsRef.current.find((t) => t.id === id)).filter(Boolean);

        if (fresh.retailer_type === "walmart") {
          // Forwarded messages store their content in message_snapshots[0].message
          // rather than the top-level message object — resolve to the real message first
          const snapshots = triggerMsgContent?.message_snapshots || [];
          const resolvedMsg = snapshots.length > 0 ? snapshots[0].message : triggerMsgContent;
          pushLog({ type: "info", monitor: monitorNameRef.current, channel: triggerChannelLabel, msg: `[DEBUG] snapshots=${snapshots.length} embeds=${(resolvedMsg?.embeds||[]).length} content="${(resolvedMsg?.content||"").slice(0,80)}"` });

          const allUrls = extractUrls(resolvedMsg);
          const walmartUrl = allUrls.find((u) => u.includes("walmart.com"));
          const embed = (resolvedMsg?.embeds || [])[0] || {};
          const primaryUrl = embed.url || walmartUrl || allUrls[0] || null;

          if (!primaryUrl) {
            newErrors._walmart = `No URL found in Discord message`;
          } else {
            const normPrimary = normalizeUrl(primaryUrl);

            // Deduplicate: skip if this exact URL has already been launched this session
            if (firedMessageIdsRef.current.has(`url:${normPrimary}`)) {
              pushLog({ type: "cooldown", monitor: monitorNameRef.current, channel: triggerChannelLabel, msg: `Duplicate URL suppressed — already launched: ${normPrimary}` });
            } else {
              firedMessageIdsRef.current.add(`url:${normPrimary}`);

              // Try to match against a task group by URL first
              const matched = pool.filter((tg) => normalizeUrl(tg.target_url) === normPrimary);
              const notYetLaunched = matched.filter((tg) => !launchedIdsRef.current.has(tg.id));

              if (matched.length > 0) {
                // Matched a specific task group by URL
                for (const tg of notYetLaunched) {
                  await runTaskGroup(tg);
                  totalInstances += tg.instance_count || 1;
                  syncLaunchedIds(new Set([...launchedIdsRef.current, tg.id]));
                }
              } else if (pool.length > 0) {
                // No URL match — apply the drop URL to all assigned task groups and launch
                for (const tg of pool) {
                  await db.TaskGroup.update(tg.id, { target_url: primaryUrl });
                  await runTaskGroup({ ...tg, target_url: primaryUrl });
                  totalInstances += tg.instance_count || 1;
                }
              } else {
                newErrors._walmart = `No task groups assigned to this monitor`;
              }
            }
          }
        } else if (fresh.retailer_type === "costco") {
          // Try direct URL, then embedded URL from forwarded/embed messages
          const snapshots = triggerMsgContent?.message_snapshots || [];
          const resolvedMsg = snapshots.length > 0 ? snapshots[0].message : triggerMsgContent;
          const msgUrls = extractUrls(resolvedMsg);
          const dropUrl = msgUrls[0];
          if (!dropUrl) {
            setErrors((prev) => ({ ...prev, _costco: `No URL found in Discord message — use manual input below` }));
          } else if (pool.length === 0) {
            setErrors((prev) => ({ ...prev, _costco: `No task group assigned to this Costco monitor` }));
          } else {
            setErrors((prev) => { const e = { ...prev }; delete e._costco; return e; });
            for (const tg of pool) {
              await db.TaskGroup.update(tg.id, { target_url: dropUrl });
              const updatedTg = { ...tg, target_url: dropUrl };
              await runTaskGroup(updatedTg);
              totalInstances += updatedTg.instance_count || 1;
            }
            toast.success(`🛒 Costco drop detected — URL updated & ${totalInstances} instances launched`);
          }
        } else if (fresh.retailer_type === "pokemon_center") {
          // No URL needed — just fire all assigned task groups
          if (pool.length === 0) {
            setErrors((prev) => ({ ...prev, _pokemon: `No task groups assigned to this Pokemon Center monitor` }));
          } else {
            setErrors((prev) => { const e = { ...prev }; delete e._pokemon; return e; });
            for (const tg of pool) {
              await runTaskGroup(tg);
              totalInstances += tg.instance_count || 1;
            }
            toast.success(`⚡ Pokemon Center triggered — ${totalInstances} instances launched`);
          }
        } else {
          for (const tg of pool) {
            await runTaskGroup(tg);
            totalInstances += tg.instance_count || 1;
          }
        }

        if (totalInstances > 0) {
          setLastEvents((prev) => [{ channelLabel: triggerChannelLabel, time: new Date().toLocaleTimeString(), instances: totalInstances }, ...prev].slice(0, 3));
          pushLog({ type: "launched", monitor: monitorNameRef.current, channel: triggerChannelLabel, msg: `${totalInstances} instance${totalInstances !== 1 ? "s" : ""} launched` });
          toast.success(`🚀 ${monitorNameRef.current} triggered — ${totalInstances} instances launched`);
        }
      }

      setErrors((prev) => {
        const special = {};
        if (newErrors._walmart) special._walmart = newErrors._walmart;
        else if (prev._walmart) special._walmart = prev._walmart;
        if (prev._cooldown) special._cooldown = prev._cooldown;
        if (newErrors._costco) special._costco = newErrors._costco;
        else if (prev._costco && !triggered) special._costco = prev._costco;
        const channelErrors = Object.fromEntries(Object.entries(newErrors).filter(([k]) => !k.startsWith("_")));
        return { ...special, ...channelErrors };
      });
    } catch (e) {
      setErrors((prev) => ({ ...prev, _global: e.message }));
    } finally {
      runningRef.current = false;
      if (activeRef.current) scheduleNext();
    }
  };

  // Schedule the next poll tick using setTimeout (not setInterval) so polls never stack
  const scheduleNext = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(poll, intervalMsRef.current);
  };

  const startPolling = (mon) => {
    activeRef.current = true;
    intervalMsRef.current = (mon.poll_interval_seconds || 5) * 1000;
    cursorCacheRef.current = {}; // reset cursor cache on each start
    firedMessageIdsRef.current = new Set(); // reset fired IDs on each start
    stopLoop();
    scheduleNext();
  };

  useEffect(() => {
    if (monitor.is_active) startPolling(monitor);
    return () => { activeRef.current = false; stopLoop(); };
  }, [monitor.id]);

  const toggle = async () => {
    const next = !active;
    setActive(next);
    activeRef.current = next;
    setErrors({});
    await db.DiscordMonitor.update(monitor.id, { is_active: next });
    if (next) { startPolling({ ...monitor, is_active: true }); pushLog({ type: "info", monitor: monitorNameRef.current, channel: "—", msg: "Monitor started" }); toast.success(`"${monitor.name}" monitor started`); }
    else { stopLoop(); syncLaunchedIds(new Set()); pushLog({ type: "info", monitor: monitorNameRef.current, channel: "—", msg: "Monitor stopped" }); toast(`"${monitor.name}" monitor stopped`); }
    onUpdate();
  };

  const isWalmartMode = monitor.retailer_type === "walmart";

  const handleManualLaunch = async (tg) => {
    if (launchedIdsRef.current.has(tg.id)) {
      toast(`${tg.name} already launched this session`);
      return;
    }
    await runTaskGroup(tg);
    syncLaunchedIds(new Set([...launchedIdsRef.current, tg.id]));
    setLastEvents((prev) => [{ channelLabel: "Manual", time: new Date().toLocaleTimeString(), instances: tg.instance_count || 1 }, ...prev].slice(0, 3));
    toast.success(`🚀 ${tg.name} — ${tg.instance_count || 1} instances launched`);
  };

  const isUserMode = monitor.auth_mode !== "bot_token";
  const channels = monitor.channels || [];
  const assignedGroups = (monitor.task_group_ids || []).map((id) => taskGroups.find((t) => t.id === id)).filter(Boolean);
  const errorList = Object.entries(errors);

  return (
    <div className={`relative p-4 rounded-sm border transition-all space-y-3 ${active ? "border-violet-500/30 bg-violet-500/5" : "border-white/5 bg-[#08080f]"}`}>
      <div className={`absolute top-0 left-0 w-3 h-3 border-t border-l ${active ? "border-violet-400/50" : "border-white/10"}`} />

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Radio className={`w-3.5 h-3.5 flex-shrink-0 ${active ? "text-violet-400 animate-pulse" : "text-gray-600"}`} />
            <p className="font-mono text-sm text-gray-100">{monitor.name}</p>
            <span className={`flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${isUserMode ? "border-blue-500/30 bg-blue-500/10 text-blue-400" : "border-gray-500/30 bg-gray-500/10 text-gray-400"}`}>
              {isUserMode ? <User className="w-2.5 h-2.5" /> : <Bot className="w-2.5 h-2.5" />}
              {isUserMode ? "User" : "Bot"}
            </span>
            {monitor.retailer_type === "walmart" && (
              <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-sm border border-yellow-500/30 bg-yellow-500/10 text-yellow-400">
                <ShoppingCart className="w-2.5 h-2.5" /> Walmart Mode
              </span>
            )}
            {monitor.retailer_type === "costco" && (
              <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-sm border border-orange-500/30 bg-orange-500/10 text-orange-400">
                <RefreshCw className="w-2.5 h-2.5" /> Costco Mode
              </span>
            )}
            {monitor.retailer_type === "pokemon_center" && (
              <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-sm border border-red-500/30 bg-red-500/10 text-red-400">
                <Swords className="w-2.5 h-2.5" /> Pokemon Center
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-gray-600 mt-0.5">{channels.length} channel{channels.length !== 1 ? "s" : ""} · every {monitor.poll_interval_seconds || 5}s</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={toggle} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-mono border transition-all ${active ? "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20" : "bg-violet-500/10 border-violet-500/20 text-violet-400 hover:bg-violet-500/20"}`}>
            {active ? <><Square className="w-3 h-3" />Stop</> : <><Play className="w-3 h-3" />Start</>}
          </button>
          <EditMonitorDialog monitor={monitor} taskGroups={taskGroups} onSaved={onUpdate} />
          <button onClick={() => onDelete(monitor.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Channels list */}
      {channels.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Channels ({channels.length})</p>
          {channels.map((ch, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1 bg-white/[0.02] border border-white/5 rounded-sm">
              <Hash className="w-2.5 h-2.5 text-gray-600 flex-shrink-0" />
              <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{ch.label || ch.channel_id}</span>
              {ch.keyword && <span className="text-[10px] font-mono text-violet-400 flex-shrink-0">"{ch.keyword}"</span>}
              {errors[ch.channel_id] && <span className="text-[9px] font-mono text-red-400">ERR</span>}
            </div>
          ))}
        </div>
      )}

      {/* Task queue / mode-specific panels */}
      {assignedGroups.length > 0 && (
        isWalmartMode
          ? <WalmartItemPanel
              assignedGroups={assignedGroups}
              onManualLaunch={handleManualLaunch}
              launchedIds={launchedIds}
            />
          : monitor.retailer_type === "costco"
          ? <CostcoManualPanel
              assignedGroups={assignedGroups}
              onManualLaunch={handleManualLaunch}
            />
          : monitor.retailer_type === "pokemon_center"
          ? <div className="space-y-1">
              <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Pokemon Center Tasks — fire on keyword match</p>
              <p className="text-[9px] font-mono text-red-400/60">Triggers on: "Security Change Detected" · "Queue Detected"</p>
              {assignedGroups.map((tg) => (
                <div key={tg.id} className="flex items-center gap-2 px-2 py-1 bg-red-500/5 border border-red-500/10 rounded-sm">
                  <Swords className="w-3 h-3 text-red-400 flex-shrink-0" />
                  <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
                  <span className="text-[10px] font-mono text-gray-600">{tg.instance_count} inst</span>
                </div>
              ))}
            </div>
          : <div className="space-y-1">
              <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Task Queue ({assignedGroups.length})</p>
              {assignedGroups.map((tg, i) => (
                <div key={tg.id} className="flex items-center gap-2 px-2 py-1 bg-blue-500/5 border border-blue-500/10 rounded-sm">
                  <span className="text-[10px] font-mono text-blue-400 w-4">{i + 1}.</span>
                  <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
                  <span className="text-[10px] font-mono text-gray-600">{tg.instance_count} inst · {tg.delay_ms || 0}ms</span>
                </div>
              ))}
            </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-[10px] font-mono text-gray-600 flex-wrap">
        <span>triggered: <span className="text-gray-400">{monitor.trigger_count || 0}×</span></span>
        {monitor.last_triggered && <span>last: <span className="text-gray-400">{new Date(monitor.last_triggered).toLocaleTimeString()}</span></span>}
        <span>cooldown: <span className="text-gray-400">{monitor.cooldown_seconds ?? 600}s</span></span>
      </div>

      {/* Recent events */}
      {lastEvents.map((ev, i) => (
        <div key={i} className="px-2 py-1.5 rounded-sm bg-violet-500/10 border border-violet-500/20 text-[10px] font-mono text-violet-300">
          ▶ {ev.time} — {ev.channelLabel} fired · {ev.instances} instances launched
        </div>
      ))}

      {/* Costco error */}
      {errors._costco && <div className="px-2 py-1.5 rounded-sm bg-orange-500/10 border border-orange-500/20 text-[10px] font-mono text-orange-400">⚠ {errors._costco}</div>}

      {/* Pokemon Center error */}
      {errors._pokemon && <div className="px-2 py-1.5 rounded-sm bg-red-500/10 border border-red-500/20 text-[10px] font-mono text-red-400">⚠ {errors._pokemon}</div>}

      {/* Walmart URL mismatch warning */}
      {errors._walmart && <div className="px-2 py-1.5 rounded-sm bg-yellow-500/10 border border-yellow-500/20 text-[10px] font-mono text-yellow-400">⚠ {errors._walmart}</div>}

      {/* Cooldown indicator */}
      {errors._cooldown && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-yellow-500/10 border border-yellow-500/20 text-[10px] font-mono text-yellow-400">
          <span className="flex-1">⏳ {errors._cooldown}</span>
          <button
            onClick={async () => {
              await db.DiscordMonitor.update(monitor.id, { last_triggered: null });
              setErrors((prev) => { const e = { ...prev }; delete e._cooldown; return e; });
              toast.success("Cooldown reset");
            }}
            className="px-1.5 py-0.5 rounded border border-yellow-500/30 hover:bg-yellow-500/20 text-yellow-300 transition-colors whitespace-nowrap"
          >
            Reset
          </button>
        </div>
      )}

      {/* Errors */}
      {errors._global && <div className="px-2 py-1.5 rounded-sm bg-red-500/10 border border-red-500/20 text-[10px] font-mono text-red-400">⚠ {errors._global}</div>}
      {errorList.filter(([k]) => !k.startsWith("_")).map(([chId, msg]) => (
        <div key={chId} className="px-2 py-1.5 rounded-sm bg-red-500/10 border border-red-500/20 text-[10px] font-mono text-red-400">⚠ CH {chId}: {msg}</div>
      ))}

      {active && <div className="h-px w-full bg-gradient-to-r from-transparent via-violet-500/50 to-transparent animate-pulse" />}
    </div>
  );
}

// ── Add Monitor Dialog ────────────────────────────────────────────────────────
function AddMonitorDialog({ taskGroups, onAdded }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retailerType, setRetailerType] = useState("standard");
  const [authMode, setAuthMode] = useState("user_token");
  const [name, setName] = useState("");
  const [userToken, setUserToken] = useState("");
  const [botToken, setBotToken] = useState("");
  const [pollInterval, setPollInterval] = useState("5");
  const [cooldownSeconds, setCooldownSeconds] = useState("600");
  const [selectedTaskGroupIds, setSelectedTaskGroupIds] = useState([]);
  // channels: [{label, channel_id, keyword}]
  const [channels, setChannels] = useState([]);

  // Guild/channel picker state
  const [guilds, setGuilds] = useState([]);
  const [selectedGuildId, setSelectedGuildId] = useState("");
  const [guildChannels, setGuildChannels] = useState([]);
  const [loadingGuilds, setLoadingGuilds] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);

  const currentToken = authMode === "user_token" ? userToken : botToken;
  const authHeader = authMode === "bot_token" ? `Bot ${currentToken}` : currentToken;

  const loadGuilds = async () => {
    if (!currentToken.trim()) { toast.error("Paste your token first"); return; }
    setLoadingGuilds(true);
    setGuilds([]); setGuildChannels([]); setSelectedGuildId("");
    const result = await fetchDiscordGuilds(authHeader);
    setLoadingGuilds(false);
    if (result.error) { toast.error(`Failed: ${result.error}`); return; }
    setGuilds(result.guilds || []);
    if (!result.guilds?.length) toast("No servers found for this token");
  };

  const loadChannels = async (guildId) => {
    setSelectedGuildId(guildId);
    setGuildChannels([]);
    if (!guildId) return;
    setLoadingChannels(true);
    const result = await fetchDiscordGuildChannels(authHeader, guildId);
    setLoadingChannels(false);
    if (result.error) { toast.error(`Failed: ${result.error}`); return; }
    // Sort by position
    setGuildChannels((result.channels || []).sort((a, b) => a.position - b.position));
  };

  const toggleChannel = (ch) => {
    setChannels((prev) => {
      const exists = prev.find((c) => c.channel_id === ch.id);
      if (exists) return prev.filter((c) => c.channel_id !== ch.id);
      return [...prev, { label: ch.name, channel_id: ch.id, keyword: "" }];
    });
  };

  const updateChannelKeyword = (channelId, keyword) => {
    setChannels((prev) => prev.map((c) => c.channel_id === channelId ? { ...c, keyword } : c));
  };

  const removeChannel = (channelId) => setChannels((prev) => prev.filter((c) => c.channel_id !== channelId));

  const addTG = (id) => { if (id && !selectedTaskGroupIds.includes(id)) setSelectedTaskGroupIds((p) => [...p, id]); };
  const removeTG = (id) => setSelectedTaskGroupIds((p) => p.filter((x) => x !== id));
  const moveUp = (i) => { const a = [...selectedTaskGroupIds]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setSelectedTaskGroupIds(a); };
  const moveDown = (i) => { const a = [...selectedTaskGroupIds]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setSelectedTaskGroupIds(a); };

  const hasToken = authMode === "user_token" ? !!userToken : !!botToken;
  const canSubmit = name && hasToken && channels.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    await db.DiscordMonitor.create({
      name,
      retailer_type: retailerType,
      auth_mode: authMode,
      user_token: authMode === "user_token" ? userToken : null,
      bot_token: authMode === "bot_token" ? botToken : null,
      channels: channels.map((ch) => ({ label: ch.label || ch.channel_id, channel_id: ch.channel_id, keyword: ch.keyword || null, last_message_id: null })),
      poll_interval_seconds: Number(pollInterval),
      cooldown_seconds: Number(cooldownSeconds),
      task_group_ids: selectedTaskGroupIds,
      is_active: false,
      trigger_count: 0,
    });
    toast.success("Monitor created");
    setOpen(false); setLoading(false);
    setName(""); setUserToken(""); setBotToken(""); setSelectedTaskGroupIds([]);
    setChannels([]); setGuilds([]); setGuildChannels([]); setSelectedGuildId("");
    setCooldownSeconds("600"); setRetailerType("standard");
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-violet-600 hover:bg-violet-700 text-white font-mono text-xs gap-2"><Plus className="w-3.5 h-3.5" />Add Monitor</Button>
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d16] border-white/10 text-gray-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-mono text-sm text-violet-400">New Discord Monitor</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-3">

          {/* Retailer type */}
          <div>
            <Label className="text-xs text-gray-400 font-mono">Retailer Type *</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button onClick={() => setRetailerType("standard")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${retailerType === "standard" ? "border-violet-500/50 bg-violet-500/10 text-violet-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <Radio className="w-3.5 h-3.5" /> Standard
              </button>
              <button onClick={() => setRetailerType("walmart")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${retailerType === "walmart" ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <ShoppingCart className="w-3.5 h-3.5" /> Walmart
              </button>
              <button onClick={() => setRetailerType("costco")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${retailerType === "costco" ? "border-orange-500/50 bg-orange-500/10 text-orange-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <RefreshCw className="w-3.5 h-3.5" /> Costco
              </button>
              <button onClick={() => setRetailerType("pokemon_center")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${retailerType === "pokemon_center" ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <Swords className="w-3.5 h-3.5" /> Pokemon Center
              </button>
            </div>
            {retailerType === "walmart" && (
              <div className="mt-2 rounded-sm border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-[10px] font-mono text-yellow-400 space-y-1">
                <p className="font-semibold">Walmart mode — URL-matched launching</p>
                <p className="text-yellow-400/70">When a drop is detected, the item URL is parsed from the Discord message. Only the TaskGroup whose <strong>Target URL</strong> matches that item URL will be launched. Add one TaskGroup per Walmart item.</p>
              </div>
            )}
            {retailerType === "costco" && (
              <div className="mt-2 rounded-sm border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-[10px] font-mono text-orange-400 space-y-1">
                <p className="font-semibold">Costco mode — URL auto-update & launch</p>
                <p className="text-orange-400/70">Extracts the drop URL from the Discord message (direct link or embedded) and writes it to all assigned TaskGroups, then fires. Falls back to manual URL input if polling finds no URL.</p>
              </div>
            )}
            {retailerType === "pokemon_center" && (
              <div className="mt-2 rounded-sm border border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] font-mono text-red-400 space-y-1">
                <p className="font-semibold">Pokemon Center mode — keyword trigger</p>
                <p className="text-red-400/70">Fires all assigned TaskGroups the moment any message containing <strong>"Security Change Detected"</strong> or <strong>"Queue Detected"</strong> is seen. No URL parsing, no warmup, no login required.</p>
              </div>
            )}
          </div>

          {/* Auth mode */}
          <div>
            <Label className="text-xs text-gray-400 font-mono">Auth Mode *</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button onClick={() => setAuthMode("user_token")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${authMode === "user_token" ? "border-blue-500/50 bg-blue-500/10 text-blue-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <User className="w-3.5 h-3.5" /> My Discord Account
              </button>
              <button onClick={() => setAuthMode("bot_token")} className={`flex items-center gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono transition-all ${authMode === "bot_token" ? "border-gray-500/50 bg-gray-500/10 text-gray-300" : "border-white/10 bg-white/5 text-gray-500 hover:text-gray-300"}`}>
                <Bot className="w-3.5 h-3.5" /> Bot Token
              </button>
            </div>
          </div>

          {authMode === "user_token" && (
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
          )}

          <div>
            <Label className="text-xs text-gray-400 font-mono">Retailer / Monitor Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Walmart, PokemonCenter, Costco" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>

          {authMode === "user_token" ? (
            <div>
              <Label className="text-xs text-gray-400 font-mono">Discord User Token *</Label>
              <Input type="password" value={userToken} onChange={(e) => setUserToken(e.target.value)} placeholder="Paste Authorization header value" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
            </div>
          ) : (
            <div>
              <Label className="text-xs text-gray-400 font-mono">Discord Bot Token *</Label>
              <Input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="Bot token from Developer Portal" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
            </div>
          )}

          {/* Channel Picker */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400 font-mono">Discord Channels *</Label>

            {/* Step 1: Load servers */}
            <button
              onClick={loadGuilds}
              disabled={loadingGuilds || !currentToken.trim()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-sm border border-violet-500/30 bg-violet-500/10 text-violet-300 font-mono text-xs hover:bg-violet-500/20 disabled:opacity-40 transition-all"
            >
              {loadingGuilds
                ? <><div className="w-3 h-3 border border-violet-400/40 border-t-violet-300 rounded-full animate-spin" /> Loading servers…</>
                : <><Hash className="w-3.5 h-3.5" /> {guilds.length > 0 ? `Reload Servers (${guilds.length} loaded)` : "Load My Servers"}</>
              }
            </button>

            {/* Step 2: Pick a server */}
            {guilds.length > 0 && (
              <div>
                <Label className="text-[10px] text-gray-500 font-mono">Select Server</Label>
                <div className="mt-0.5 max-h-48 overflow-y-auto border border-white/10 rounded-sm bg-[#1a1a24] space-y-px p-1">
                  {guilds.map((g) => {
                    const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=32` : null;
                    const initials = g.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                    return (
                      <button
                        key={g.id}
                        onClick={() => loadChannels(g.id)}
                        className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-sm text-left text-xs font-mono transition-colors ${selectedGuildId === g.id ? "bg-violet-500/25 text-violet-200" : "text-gray-300 hover:bg-white/5 hover:text-gray-100"}`}
                      >
                        {iconUrl ? (
                          <img src={iconUrl} alt={g.name} className="w-5 h-5 rounded-full flex-shrink-0 object-cover" onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
                        ) : null}
                        <span className={`w-5 h-5 rounded-full flex-shrink-0 bg-violet-700/60 items-center justify-center text-[9px] font-bold text-violet-200 ${iconUrl ? "hidden" : "flex"}`}>{initials}</span>
                        <span className="flex-1 truncate">{g.name}</span>
                        {selectedGuildId === g.id && <span className="text-[9px] text-violet-400">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 3: Pick channels */}
            {loadingChannels && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500 py-1">
                <div className="w-3 h-3 border border-gray-600 border-t-gray-400 rounded-full animate-spin" /> Loading channels…
              </div>
            )}
            {guildChannels.length > 0 && (
              <div className="max-h-36 overflow-y-auto space-y-0.5 border border-white/5 rounded-sm p-1.5 bg-black/20">
                {guildChannels.map((ch) => {
                  const isSelected = channels.some((c) => c.channel_id === ch.id);
                  return (
                    <button
                      key={ch.id}
                      onClick={() => toggleChannel(ch)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-sm text-left text-[10px] font-mono transition-colors ${isSelected ? "bg-violet-500/20 text-violet-300" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"}`}
                    >
                      <Hash className="w-3 h-3 flex-shrink-0" />
                      <span className="flex-1 truncate">{ch.name}</span>
                      {isSelected && <span className="text-[9px] text-violet-400">✓ added</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selected channels with keyword inputs */}
            {channels.length > 0 && (
              <div className="space-y-1.5 mt-1">
                <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">{channels.length} channel{channels.length !== 1 ? "s" : ""} selected</p>
                {channels.map((ch) => (
                  <div key={ch.channel_id} className="flex items-center gap-2 px-2 py-1.5 bg-violet-500/5 border border-violet-500/10 rounded-sm">
                    <Hash className="w-2.5 h-2.5 text-violet-400 flex-shrink-0" />
                    <span className="text-[10px] font-mono text-gray-200 w-28 truncate flex-shrink-0">#{ch.label}</span>
                    <Input
                      value={ch.keyword || ""}
                      onChange={(e) => updateChannelKeyword(ch.channel_id, e.target.value)}
                      placeholder="keyword (blank=any)"
                      className="bg-white/5 border-white/10 font-mono text-[10px] h-6 flex-1 min-w-0"
                    />
                    <button onClick={() => removeChannel(ch.channel_id)} className="text-gray-600 hover:text-red-400 flex-shrink-0"><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}

            {guilds.length === 0 && (
              <p className="text-[10px] font-mono text-gray-600">↑ Paste your token above, then click "Load My Servers" to browse and select channels.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-400 font-mono">Poll Interval (seconds)</Label>
              <Input type="number" min="0.1" step="0.1" max="60" value={pollInterval} onChange={(e) => setPollInterval(e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs text-gray-400 font-mono">Cooldown (seconds)</Label>
              <Input type="number" min="5" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} placeholder="60" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
              <p className="text-[9px] font-mono text-gray-600 mt-1">Silence re-triggers after first fire</p>
            </div>
          </div>

          {/* Task group queue */}
          <div>
            <Label className="text-xs text-gray-400 font-mono">
              {retailerType === "walmart"
                ? <>Item Pool <span className="text-gray-600">(each TaskGroup matched by its Target URL)</span></>
                : retailerType === "costco"
                ? <>Drop Groups <span className="text-gray-600">(URL auto-updated from Discord message; manual fallback available)</span></>
                : retailerType === "pokemon_center"
                ? <>Task Groups <span className="text-gray-600">(all fire instantly on keyword detection)</span></>
                : <>Task Queue <span className="text-gray-600">(all fire when any channel triggers)</span></>
              }
            </Label>
            {/* Retailer bundle quick-add */}
            {(() => {
              const retailers = [...new Set(taskGroups.map((t) => t.retailer).filter(Boolean))];
              if (!retailers.length) return null;
              return (
                <div className="flex flex-wrap gap-1 mt-1 mb-1">
                  {retailers.map((r) => {
                    const ids = taskGroups.filter((t) => t.retailer === r).map((t) => t.id);
                    const allAdded = ids.every((id) => selectedTaskGroupIds.includes(id));
                    return (
                      <button
                        key={r}
                        onClick={() => {
                          if (allAdded) {
                            setSelectedTaskGroupIds((prev) => prev.filter((id) => !ids.includes(id)));
                          } else {
                            setSelectedTaskGroupIds((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
                          }
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-mono transition-all ${allAdded ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-white/10 bg-white/5 text-gray-400 hover:border-blue-500/30 hover:text-blue-300"}`}
                      >
                        {allAdded ? "✓" : "+"} {r} <span className="text-gray-600">({ids.length})</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <Select onValueChange={addTG} value="">
              <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1 h-9"><SelectValue placeholder="+ Add task group…" /></SelectTrigger>
              <SelectContent className="bg-[#1a1a24] border-white/10">
                {taskGroups.filter((t) => !selectedTaskGroupIds.includes(t.id)).map((t) => (
                  <SelectItem key={t.id} value={t.id} className="font-mono text-xs text-gray-100">{t.retailer ? `[${t.retailer}] ` : ""}{t.name} ({t.instance_count} inst)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTaskGroupIds.length > 0 && (
              <div className="mt-2 space-y-1">
                {selectedTaskGroupIds.map((id, i) => {
                  const tg = taskGroups.find((t) => t.id === id);
                  if (!tg) return null;
                  return (
                    <div key={id} className="flex items-center gap-2 px-2 py-1.5 bg-blue-500/5 border border-blue-500/10 rounded-sm">
                      <span className="text-[10px] font-mono text-blue-400 w-4">{i + 1}.</span>
                      <span className="text-[10px] font-mono text-gray-300 flex-1 truncate">{tg.name}</span>
                      <span className="text-[10px] font-mono text-gray-600">{tg.instance_count} inst</span>
                      <div className="flex gap-0.5">
                        <button disabled={i === 0} onClick={() => moveUp(i)} className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20"><ChevronUp className="w-3 h-3" /></button>
                        <button disabled={i === selectedTaskGroupIds.length - 1} onClick={() => moveDown(i)} className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20"><ChevronDown className="w-3 h-3" /></button>
                        <button onClick={() => removeTG(id)} className="p-0.5 text-gray-600 hover:text-red-400 ml-1"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Button onClick={submit} disabled={loading || !canSubmit} className="w-full bg-violet-600 hover:bg-violet-700 font-mono text-xs">
            {loading ? "Creating..." : `Create Monitor — ${channels.length} channel${channels.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Event Log Panel ───────────────────────────────────────────────────────────
function EventLogPanel() {
  const log = useDiscordLog();

  const typeStyle = {
    trigger:  { icon: Zap,           color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
    launched: { icon: Play,          color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    error:    { icon: AlertTriangle, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
    cooldown: { icon: Clock,         color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/20" },
    info:     { icon: Radio,         color: "text-gray-400",    bg: "bg-white/5 border-white/10" },
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">{log.length} events (session only — clears on reload)</p>
        {log.length > 0 && (
          <button
            onClick={() => { _discordLog.length = 0; _logSubs.forEach((cb) => cb([])); }}
            className="text-[10px] font-mono text-gray-600 hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {log.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/5 rounded-sm">
          <ScrollText className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 font-mono">No events yet</p>
          <p className="text-xs text-gray-700 font-mono mt-1">Start a monitor to begin recording events</p>
        </div>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
          {log.map((entry, i) => {
            const cfg = typeStyle[entry.type] || typeStyle.info;
            const Icon = cfg.icon;
            const timeStr = entry.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
            return (
              <div key={i} className={`flex items-start gap-2 px-2.5 py-1.5 rounded-sm border text-[10px] font-mono ${cfg.bg}`}>
                <Icon className={`w-3 h-3 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                <span className="text-gray-600 flex-shrink-0 tabular-nums">{timeStr}</span>
                <span className={`flex-shrink-0 ${cfg.color}`}>[{entry.monitor}]</span>
                {entry.channel !== "—" && <span className="text-gray-600 flex-shrink-0">#{entry.channel}</span>}
                <span className="text-gray-300 flex-1 min-w-0 truncate">{entry.msg}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DiscordMonitor() {
  const [monitors, setMonitors] = useState([]);
  const [taskGroups, setTaskGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("monitors");

  const load = async () => {
    const [m, t] = await Promise.all([
      db.DiscordMonitor.list("-created_date"),
      db.TaskGroup.list(),
    ]);
    setMonitors(m);
    setTaskGroups(t);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const del = async (id) => {
    await db.DiscordMonitor.update(id, { is_active: false });
    await db.DiscordMonitor.delete(id);
    toast.success("Monitor deleted");
    load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" /></div>;

  const activeCount = monitors.filter((m) => m.is_active).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Radio className={`w-4 h-4 ${activeCount > 0 ? "text-violet-400 animate-pulse" : "text-gray-600"}`} />
            Discord Monitor
          </h1>
          <p className="text-xs text-gray-500 font-mono mt-1">{monitors.length} monitor{monitors.length !== 1 ? "s" : ""} · {activeCount} active</p>
        </div>
        {tab === "monitors" && <AddMonitorDialog taskGroups={taskGroups} onAdded={load} />}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/5 pb-0">
        <button
          onClick={() => setTab("monitors")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border-b-2 transition-colors -mb-px ${tab === "monitors" ? "border-violet-400 text-violet-300" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <Radio className="w-3 h-3" /> Monitors
        </button>
        <button
          onClick={() => setTab("log")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border-b-2 transition-colors -mb-px ${tab === "log" ? "border-violet-400 text-violet-300" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <ScrollText className="w-3 h-3" /> Event Log
          {_discordLog.length > 0 && <span className="ml-1 px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[9px]">{_discordLog.length}</span>}
        </button>
      </div>

      {/* Monitors tab */}
      {tab === "monitors" && (
        <>
          {taskGroups.length === 0 && (
            <div className="rounded-sm border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
              <p className="text-xs font-mono text-yellow-400">No task groups found — create some in the <strong>Task Groups</strong> tab first.</p>
            </div>
          )}
          {monitors.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-white/5 rounded-sm">
              <Radio className="w-8 h-8 text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-500 font-mono">No monitors configured</p>
              <p className="text-xs text-gray-700 font-mono mt-1">Create a monitor per retailer and add all the Discord channels to watch</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {monitors.map((m) => <MonitorCard key={m.id} monitor={m} taskGroups={taskGroups} onUpdate={load} onDelete={del} />)}
            </div>
          )}
        </>
      )}

      {/* Event Log tab */}
      {tab === "log" && <EventLogPanel />}
    </div>
  );
}
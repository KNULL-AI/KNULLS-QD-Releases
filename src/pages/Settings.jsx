import { useState, useEffect, useRef } from "react";
import {
  Settings as SettingsIcon, Download, Upload, AlertTriangle, Check, Inbox, Mail, Play, Square, RefreshCw, Copy,
  MailCheck, User
} from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import toast from "react-hot-toast";
import { checkForUpdatesManual, getAppVersion, imapFetch, injectVerificationCode, startImapPoll, stopImapPoll, getImapPollStatus, onImapPollEvent, offImapPollEvent } from "@/lib/electronBridge";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

// ─── Config Export / Import ───────────────────────────────────────────────────

async function exportConfig() {
  const [taskGroups, proxyGroups, discordMonitors, sessionProfiles] = await Promise.all([
    db.TaskGroup.list(), db.ProxyGroup.list(), db.DiscordMonitor.list(), db.SessionProfile.list(),
  ]);
  const config = { version: 1, exported_at: new Date().toISOString(), taskGroups, proxyGroups, discordMonitors, sessionProfiles };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `knull-config-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  URL.revokeObjectURL(url);
}

async function importConfig(file) {
  const text = await file.text();
  const config = JSON.parse(text);
  if (!config.version) throw new Error("Invalid config file");
  const counts = { taskGroups: 0, proxyGroups: 0, discordMonitors: 0, sessionProfiles: 0 };
  if (config.taskGroups?.length) for (const tg of config.taskGroups) { const { id: _id, created_date: _createdDate, updated_date: _updatedDate, created_by_id: _createdById, ...rest } = tg; await db.TaskGroup.create(rest); counts.taskGroups++; }
  if (config.proxyGroups?.length) for (const pg of config.proxyGroups) { const { id: _id, created_date: _createdDate, updated_date: _updatedDate, created_by_id: _createdById, ...rest } = pg; await db.ProxyGroup.create(rest); counts.proxyGroups++; }
  if (config.discordMonitors?.length) for (const dm of config.discordMonitors) { const { id: _id, created_date: _createdDate, updated_date: _updatedDate, created_by_id: _createdById, ...rest } = dm; await db.DiscordMonitor.create({ ...rest, is_active: false }); counts.discordMonitors++; }
  if (config.sessionProfiles?.length) for (const sp of config.sessionProfiles) { const { id: _id, created_date: _createdDate, updated_date: _updatedDate, created_by_id: _createdById, ...rest } = sp; await db.SessionProfile.create(rest); counts.sessionProfiles++; }
  return counts;
}

// ─── IMAP Tab ─────────────────────────────────────────────────────────────────

const DELIVERY_META = {
  auto_filled: { label: "Auto-filled", color: "text-emerald-400", bg: "border-emerald-500/20 bg-emerald-500/10", icon: Check },
  displayed:   { label: "Displayed",   color: "text-blue-400",    bg: "border-blue-500/20 bg-blue-500/10",    icon: MailCheck },
  no_account:  { label: "No account",  color: "text-yellow-400",  bg: "border-yellow-500/20 bg-yellow-500/10", icon: AlertTriangle },
  no_session:  { label: "No session",  color: "text-orange-400",  bg: "border-orange-500/20 bg-orange-500/10", icon: AlertTriangle },
};

function ImapSection() {
  const [config, setConfig] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);

  const configRef = useRef(null);
  const accountsRef = useRef([]);
  const processedUidsRef = useRef(new Set()); // still used by the manual Test button's one-off check

  const load = async () => {
    const [cfgs, accts, cds] = await Promise.all([
      db.ImapConfig.list("-created_date"),
      db.WalmartAccount.list(),
      db.VerificationCode.list("-created_date", 200),
    ]);
    const cfg = Array.isArray(cfgs) && cfgs[0] ? cfgs[0] : null;
    setConfig(cfg); configRef.current = cfg;
    setAccounts(Array.isArray(accts) ? accts : []); accountsRef.current = Array.isArray(accts) ? accts : [];
    setCodes(Array.isArray(cds) ? cds : []);
    (Array.isArray(cds) ? cds : []).forEach((c) => c.message_uid && processedUidsRef.current.add(c.message_uid));
    // Ask the main process what's ACTUALLY running, rather than trusting the persisted
    // is_active flag — the main process is now the source of truth for polling state.
    const status = await getImapPollStatus();
    setPolling(!!status?.active);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { configRef.current = config; }, [config]);

  // Local listener — only updates this page's UI when codes arrive
  // The global App.jsx listener handles the toast notifications for all pages
  useEffect(() => {
    const wrapper = onImapPollEvent((evt) => {
      if (evt.type === "result") {
        if (evt.newCodes?.length) {
          setCodes((prev) => [...evt.newCodes, ...prev].slice(0, 200));
          evt.newCodes.forEach((c) => c.message_uid && processedUidsRef.current.add(c.message_uid));
        }
        setConfig((c) => (c ? { ...c, last_sync: new Date().toISOString() } : c));
        refreshAccounts();
      }
    });
    return () => offImapPollEvent(wrapper);
  }, []);

  const refreshAccounts = async () => {
    const accts = await db.WalmartAccount.list();
    accountsRef.current = Array.isArray(accts) ? accts : [];
    setAccounts(accountsRef.current);
  };

  const processMessages = async (messages) => {
    let newCount = 0;
    for (const msg of messages) {
      if (processedUidsRef.current.has(msg.uid)) continue;
      processedUidsRef.current.add(msg.uid);
      if (!msg.code) continue;
      const account = accountsRef.current.find((a) => a.email && a.email.toLowerCase() === msg.to.toLowerCase());
      let delivery_status = "displayed", session_id = null;
      if (!account) { delivery_status = "no_account"; }
      else {
        const sessions = await db.BrowserSession.filter({ walmart_account_id: account.id, status: "running" });
        if (Array.isArray(sessions) && sessions.length) {
          const res = await injectVerificationCode(sessions[0].id, msg.code);
          if (res?.ok) { delivery_status = "auto_filled"; session_id = sessions[0].id; toast.success(`Code ${msg.code} injected → ${account.label}`); }
          else delivery_status = "no_session";
        }
      }
      const rec = await db.VerificationCode.create({ code: msg.code, to_email: msg.to, from_email: msg.from, subject: msg.subject, snippet: msg.snippet, account_id: account ? account.id : null, session_id, delivery_status, message_uid: msg.uid });
      setCodes((prev) => [rec, ...prev].slice(0, 200));
      newCount++;
    }
    if (newCount > 0) toast.success(`${newCount} new verification code${newCount !== 1 ? "s" : ""}`);
  };

  // Background polling now runs in the Electron main process (see main.js:
  // start-imap-poll / imap-poll-event) so it keeps running even if this page
  // unmounts — the loop no longer lives here as component/timer state.

  const startPolling = async () => {
    if (!config) return;
    await db.ImapConfig.update(config.id, { is_active: true });
    setConfig((c) => ({ ...c, is_active: true }));
    await startImapPoll();
    setPolling(true);
    toast.success("IMAP monitor started");
  };

  const stopPolling = async () => {
    await stopImapPoll();
    setPolling(false);
    if (config) { await db.ImapConfig.update(config.id, { is_active: false }); setConfig((c) => ({ ...c, is_active: false })); }
    toast("IMAP monitor stopped");
  };

  const saveConfig = async () => {
    if (!config.host || !config.username || !config.password) { toast.error("Host, username, and password required"); return; }
    if (config.id) {
      const updated = await db.ImapConfig.update(config.id, { host: config.host, port: Number(config.port) || 993, username: config.username, password: config.password, tls: config.tls, poll_interval_seconds: Number(config.poll_interval_seconds) || 15 });
      setConfig(updated); configRef.current = updated;
    } else {
      const created = await db.ImapConfig.create({ host: config.host, port: Number(config.port) || 993, username: config.username, password: config.password, tls: config.tls !== false, poll_interval_seconds: Number(config.poll_interval_seconds) || 15, is_active: false });
      setConfig(created); configRef.current = created;
    }
    setDirty(false); toast.success("IMAP settings saved");
  };

  const testConnection = async () => {
    if (!config?.host || !config?.username || !config?.password) { toast.error("Enter and save settings first"); return; }
    setTesting(true);
    const res = await imapFetch({ host: config.host, port: config.port, username: config.username, password: config.password, tls: config.tls, limit: 5 });
    setTesting(false);
    if (res.error) { toast.error(`Connection failed: ${res.error}`, { duration: 5000 }); return; }
    toast.success(`Connected — scanned ${res.messages.length} recent message${res.messages.length !== 1 ? "s" : ""}`);
    if (res.messages.length) await processMessages(res.messages);
  };

  const copyCode = (code) => { navigator.clipboard?.writeText(code); toast.success(`Copied ${code}`); };
  const setField = (k, v) => { setConfig((c) => ({ ...(c || {}), [k]: v })); setDirty(true); };

  if (loading) return <div className="flex items-center justify-center h-32"><div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" /></div>;

  const c = config || { host: "imap.gmail.com", port: 993, username: "", password: "", tls: true, poll_interval_seconds: 15, is_active: false };

  return (
    <div className="space-y-4">
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className={`w-4 h-4 ${polling ? "text-emerald-400 animate-pulse" : "text-gray-500"}`} />
          <span className="font-mono text-xs text-gray-400 uppercase tracking-wider">IMAP Monitor</span>
          {polling && <span className="text-[9px] font-mono px-2 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-pulse">● LIVE</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={testConnection} disabled={testing || !config} className="bg-white/5 border-white/10 font-mono text-xs gap-1.5 h-7 px-2.5">
            {testing ? <><RefreshCw className="w-3 h-3 animate-spin" /> Testing…</> : <><Mail className="w-3 h-3" /> Test</>}
          </Button>
          {polling ? (
            <Button onClick={stopPolling} className="bg-red-600 hover:bg-red-700 font-mono text-xs gap-1.5 h-7 px-2.5"><Square className="w-3 h-3" /> Stop</Button>
          ) : (
            <Button onClick={startPolling} disabled={!config} className="bg-emerald-600 hover:bg-emerald-700 font-mono text-xs gap-1.5 h-7 px-2.5"><Play className="w-3 h-3" /> Start</Button>
          )}
        </div>
      </div>

      {/* Gmail App Password notice */}
      <div className="flex items-start gap-3 border border-blue-500/20 bg-blue-500/5 rounded-sm px-3 py-2.5 text-[10px] font-mono text-blue-300">
        <Mail className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-blue-400" />
        <div className="space-y-1">
          <p className="text-blue-200 font-semibold">Gmail requires an App Password — your regular password will not work.</p>
          <ol className="list-decimal list-inside space-y-0.5 text-blue-300/80">
            <li>Enable 2-Step Verification at <span className="text-blue-400">myaccount.google.com/signinoptions/two-step-verification</span></li>
            <li>Generate an App Password at <span className="text-blue-400">myaccount.google.com/apppasswords</span></li>
            <li>Select app: <span className="text-blue-200">Mail</span> → device: <span className="text-blue-200">Windows Computer</span> → click <span className="text-blue-200">Generate</span></li>
            <li>Paste the 16-character code into the Password field below, then hit Save</li>
          </ol>
        </div>
      </div>

      {/* Config */}
      <div className="rounded-sm border border-white/5 bg-[#08080f] p-4 space-y-3">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-500 uppercase tracking-widest">
          <SettingsIcon className="w-3 h-3" /> Configuration {dirty && <span className="text-yellow-400 normal-case tracking-normal">· unsaved</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs text-gray-400 font-mono">Host</Label>
            <Input value={c.host || ""} onChange={(e) => setField("host", e.target.value)} placeholder="imap.gmail.com" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Port</Label>
            <Input type="number" value={c.port ?? 993} onChange={(e) => setField("port", e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Poll Interval (sec)</Label>
            <Input type="number" min="5" value={c.poll_interval_seconds ?? 15} onChange={(e) => setField("poll_interval_seconds", e.target.value)} className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Username</Label>
            <Input value={c.username || ""} onChange={(e) => setField("username", e.target.value)} placeholder="shared@email.com" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Password / App Password</Label>
            <Input type="password" value={c.password || ""} onChange={(e) => setField("password", e.target.value)} placeholder="••••••••" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div className="flex items-end gap-2">
            <Label className="text-xs text-gray-400 font-mono flex items-center gap-2">
              <Switch checked={c.tls !== false} onCheckedChange={(v) => setField("tls", v)} /> TLS
            </Label>
            <Button onClick={saveConfig} className="bg-violet-600 hover:bg-violet-700 font-mono text-xs ml-auto">Save</Button>
          </div>
        </div>
        {config?.last_sync && <p className="text-[10px] font-mono text-gray-600">Last sync: {new Date(config.last_sync).toLocaleString()}</p>}
      </div>

      {/* Codes */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Verification Codes ({codes.length})</p>
        {codes.length > 0 && (
          <button onClick={async () => { await db.VerificationCode.deleteMany({}); setCodes([]); toast.success("Codes cleared"); }}
            className="text-[10px] font-mono text-gray-600 hover:text-red-400 transition-colors">Clear all</button>
        )}
      </div>

      {codes.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-white/5 rounded-sm">
          <MailCheck className="w-7 h-7 text-gray-700 mx-auto mb-2" />
          <p className="text-sm text-gray-500 font-mono">No verification codes captured</p>
          <p className="text-xs text-gray-700 font-mono mt-1">Start the monitor — codes will appear here</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          {codes.map((code) => {
            const meta = DELIVERY_META[code.delivery_status] || DELIVERY_META.displayed;
            const MetaIcon = meta.icon;
            const acct = accounts.find((a) => a.id === code.account_id);
            return (
              <div key={code.id} className={`flex items-start gap-3 px-3 py-2.5 rounded-sm border ${meta.bg}`}>
                <MetaIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${meta.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-lg font-bold text-gray-100 tracking-wider">{code.code}</span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border border-current ${meta.color}`}>{meta.label}</span>
                    {acct && <span className="text-[10px] font-mono text-gray-400 flex items-center gap-1"><User className="w-2.5 h-2.5" />{acct.label}</span>}
                  </div>
                  <div className="text-[10px] font-mono text-gray-500 mt-0.5 truncate">To: {code.to_email || "—"} · {code.subject || "no subject"}</div>
                  {code.snippet && <div className="text-[9px] font-mono text-gray-600 mt-0.5 truncate">{code.snippet}</div>}
                  <div className="text-[9px] font-mono text-gray-700 mt-0.5">{new Date(code.created_date).toLocaleTimeString()}</div>
                </div>
                <button onClick={() => copyCode(code.code)} className="p-1.5 text-gray-500 hover:text-violet-300 hover:bg-violet-500/10 rounded transition-colors flex-shrink-0" title="Copy code"><Copy className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Monitoring Section ───────────────────────────────────────────────────────

function MonitoringSection() {
  const [walmartSkus, setWalmartSkus] = useState([]);
  const [newSku, setNewSku] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSkus();
  }, []);

  const loadSkus = async () => {
    try {
      const skus = await db.WalmartSkuWhitelist?.list?.() || [];
      setWalmartSkus(skus);
    } catch (err) {
      console.error("Failed to load SKUs:", err);
    } finally {
      setLoading(false);
    }
  };

  const addSku = async () => {
    const trimmed = newSku.trim().toUpperCase();
    if (!trimmed) return;
    
    if (walmartSkus.some(s => s.sku === trimmed)) {
      toast.error("SKU already in whitelist");
      return;
    }

    try {
      await db.WalmartSkuWhitelist?.create?.({ sku: trimmed, created_at: new Date().toISOString() });
      setWalmartSkus(prev => [...prev, { sku: trimmed, created_at: new Date().toISOString() }]);
      setNewSku("");
      toast.success(`Added SKU: ${trimmed}`);
    } catch (err) {
      toast.error(`Failed to add SKU: ${err.message}`);
    }
  };

  const removeSku = async (sku) => {
    try {
      await db.WalmartSkuWhitelist?.delete?.(sku);
      setWalmartSkus(prev => prev.filter(s => s.sku !== sku));
      toast.success(`Removed SKU: ${sku}`);
    } catch (err) {
      toast.error(`Failed to remove SKU: ${err.message}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="border border-white/5 bg-[#08080f] rounded-sm p-5 space-y-3">
        <h2 className="font-mono text-xs text-gray-400 uppercase tracking-wider">Walmart SKU Monitoring</h2>
        <p className="text-[11px] font-mono text-gray-600">
          Add Walmart SKUs to auto-trigger drop alerts for your monitored SKUs. When a Walmart alert drops matching any SKU in your whitelist, your configured task group will launch automatically.
        </p>

        {loading ? (
          <div className="text-[11px] font-mono text-gray-500">Loading PIDs...</div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                type="text"
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSku()}
                placeholder="Enter SKU (e.g., 1234567890)"
                className="bg-white/5 border-white/10 font-mono text-sm text-gray-100"
              />
              <Button onClick={addSku} className="bg-emerald-600 hover:bg-emerald-700 font-mono text-xs">
                Add
              </Button>
            </div>

            {walmartSkus.length === 0 ? (
              <div className="text-[11px] font-mono text-gray-600 border border-white/5 bg-white/2 rounded px-3 py-2">
                No SKUs whitelisted yet. Add one above to get started.
              </div>
            ) : (
              <div className="space-y-2">
                {walmartSkus.map((s) => (
                  <div key={s.sku} className="flex items-center justify-between bg-white/5 border border-white/5 rounded px-3 py-2">
                    <div className="flex-1">
                      <div className="text-[11px] font-mono text-gray-200">{s.sku}</div>
                      <div className="text-[9px] font-mono text-gray-600 mt-0.5">Added {new Date(s.created_at).toLocaleString()}</div>
                    </div>
                    <Button
                      onClick={() => removeSku(s.sku)}
                      variant="outline"
                      className="border-white/10 text-gray-500 hover:text-red-400 font-mono text-xs h-7"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

const TABS = ["General", "IMAP", "SKU WatchList", "About"];

export default function Settings() {
  const [tab, setTab] = useState("General");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installedVersion, setInstalledVersion] = useState(APP_VERSION);
  const [isPackagedApp, setIsPackagedApp] = useState(false);

  useEffect(() => {
    let alive = true;
    getAppVersion()
      .then((res) => {
        if (!alive || !res?.ok) return;
        if (res.version) setInstalledVersion(res.version);
        setIsPackagedApp(!!res.packaged);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const handleExport = async () => {
    setExporting(true);
    await exportConfig();
    setExporting(false);
    toast.success("Config exported");
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const counts = await importConfig(file);
      toast.success(`Imported: ${counts.taskGroups} task groups, ${counts.proxyGroups} proxy groups, ${counts.discordMonitors} monitors, ${counts.sessionProfiles} profiles`);
    } catch (err) {
      toast.error(`Import failed: ${err.message}`);
    }
    setImporting(false);
    e.target.value = "";
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await checkForUpdatesManual();
      if (res?.ok) {
        if (res.status === "update-ready") {
          toast.success(res.message || "Update is downloaded and ready to install.", { duration: 5000 });
        } else if (res.status === "checking-started") {
          toast.success(res.message || "Update found. Downloading in background...", { duration: 5000 });
        } else {
          toast(res.message || "You are already on the latest version.");
        }
      } else {
        toast.error(res?.message || "Could not check for updates.", { duration: 5000 });
      }
    } catch (err) {
      toast.error(`Could not check for updates: ${err?.message || "Unknown error"}`, { duration: 5000 });
    } finally {
      setCheckingUpdates(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="font-mono text-lg font-semibold text-gray-100 flex items-center gap-2"><SettingsIcon className="w-4 h-4 text-gray-400" /> Settings</h1>
        <p className="text-xs text-gray-500 font-mono mt-1">App configuration and data management</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/5 pb-0 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 font-mono text-xs rounded-t-sm border-b-2 transition-all -mb-px whitespace-nowrap ${tab === t ? "border-emerald-400 text-emerald-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "General" && (
        <div className="space-y-5">
          <div className="border border-white/5 bg-[#08080f] rounded-sm p-5 space-y-3">
            <h2 className="font-mono text-xs text-gray-400 uppercase tracking-wider">App Updates</h2>
            <p className="text-[11px] font-mono text-gray-600">
              Trigger an immediate update check from the installed app. If an update is already downloaded, this will show the install prompt.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <Button onClick={handleCheckUpdates} disabled={checkingUpdates} className="bg-blue-600 hover:bg-blue-700 font-mono text-xs gap-2">
                <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdates ? "animate-spin" : ""}`} />
                {checkingUpdates ? "Checking..." : "Check for Updates"}
              </Button>
              <span className="text-[10px] font-mono text-gray-600">Installed version: {installedVersion} {isPackagedApp ? "(packaged)" : "(dev)"}</span>
            </div>
          </div>

          <div className="border border-white/5 bg-[#08080f] rounded-sm p-5 space-y-4">
            <h2 className="font-mono text-xs text-gray-400 uppercase tracking-wider">Import / Export Config</h2>
            <p className="text-[11px] font-mono text-gray-600">
              Export all task groups, proxy groups, Discord monitors, and session profiles to a single JSON backup file. Import restores them as new records — it does not overwrite existing ones.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Button onClick={handleExport} disabled={exporting} className="bg-emerald-600 hover:bg-emerald-700 font-mono text-xs gap-2">
                <Download className="w-3.5 h-3.5" />{exporting ? "Exporting..." : "Export Config"}
              </Button>
              <label>
                <input type="file" accept=".json" className="hidden" onChange={handleImport} />
                <Button asChild disabled={importing} variant="outline" className="border-white/10 text-gray-400 hover:text-gray-200 font-mono text-xs gap-2 cursor-pointer">
                  <span><Upload className="w-3.5 h-3.5" />{importing ? "Importing..." : "Import Config"}</span>
                </Button>
              </label>
            </div>
            <div className="flex items-start gap-2 text-[10px] font-mono text-yellow-600 border border-yellow-600/20 bg-yellow-500/5 rounded px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              Proxies are not included in exports (may contain sensitive credentials).
            </div>
          </div>
        </div>
      )}

      {tab === "IMAP" && <ImapSection />}

      {tab === "SKU WatchList" && <MonitoringSection />}

      {tab === "About" && (
        <div className="border border-white/5 bg-[#08080f] rounded-sm p-5 space-y-2">
          <h2 className="font-mono text-xs text-gray-400 uppercase tracking-wider">About</h2>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-mono"><span className="text-gray-600">Version</span><span className="text-gray-300">{APP_VERSION}</span></div>
            <div className="flex justify-between text-[11px] font-mono"><span className="text-gray-600">Installed</span><span className="text-gray-300">{installedVersion} {isPackagedApp ? "(packaged)" : "(dev)"}</span></div>
            <div className="flex justify-between text-[11px] font-mono"><span className="text-gray-600">Build</span><span className="text-gray-300">KNULL Queue Destroyer</span></div>
            <div className="flex justify-between text-[11px] font-mono"><span className="text-gray-600">Architecture</span><span className="text-gray-300">React + Electron + SQLite</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
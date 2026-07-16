import { useState, useEffect } from "react";
import { Users, Plus, Trash2, LogIn, Eye, EyeOff, Edit2, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { launchBrowser } from "@/lib/electronBridge";

const STATUS_STYLE = {
  untested:  "border-gray-500/30 bg-gray-500/10 text-gray-400",
  needs_code:"border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  signed_in: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  failed:    "border-red-500/30 bg-red-500/10 text-red-400",
};
const STATUS_LABEL = { untested: "Untested", needs_code: "Needs Code", signed_in: "Signed In", failed: "Failed" };

const LOGIN_URL = "https://www.walmart.com/account/login";

function AddAccountDialog({ proxies, groups, onSaved, editing = null }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(editing?.label || "");
  const [email, setEmail] = useState(editing?.email || "");
  const [password, setPassword] = useState(editing?.password || "");
  const [assignType, setAssignType] = useState(editing?.proxy_assignment_type || "none");
  const [proxyId, setProxyId] = useState(editing?.proxy_id || "");
  const [groupId, setGroupId] = useState(editing?.proxy_group_id || "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!label || !email || !password) { toast.error("Label, email, and password are required"); return; }
    setSaving(true);
    const payload = {
      label, email, password,
      proxy_assignment_type: assignType,
      proxy_id: assignType === "single" ? proxyId : null,
      proxy_group_id: assignType === "group" ? groupId : null,
    };
    if (editing) await db.WalmartAccount.update(editing.id, payload);
    else await db.WalmartAccount.create({ ...payload, status: "untested" });
    setSaving(false);
    setOpen(false);
    toast.success(editing ? "Account updated" : "Account added");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <button className="p-1 text-gray-500 hover:text-violet-400 hover:bg-violet-500/10 rounded transition-colors" title="Edit account"><Edit2 className="w-3 h-3" /></button>
        ) : (
          <Button className="bg-violet-600 hover:bg-violet-700 text-white font-mono text-xs gap-2"><Plus className="w-3.5 h-3.5" />Add Account</Button>
        )}
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d16] border-white/10 text-gray-100 max-w-md">
        <DialogHeader><DialogTitle className="font-mono text-sm text-violet-400">{editing ? "Edit Account" : "New Walmart Account"}</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-3">
          <div>
            <Label className="text-xs text-gray-400 font-mono">Label *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Main, Alt1" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Email *</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="account@email.com" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Password *</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Walmart password" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs text-gray-400 font-mono">Proxy Assignment</Label>
            <Select value={assignType} onValueChange={setAssignType}>
              <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#1a1a24] border-white/10">
                <SelectItem value="none" className="text-gray-100">None (direct)</SelectItem>
                <SelectItem value="single" className="text-gray-100">Single Proxy</SelectItem>
                <SelectItem value="group" className="text-gray-100">Proxy Group</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {assignType === "single" && (
            <div>
              <Label className="text-xs text-gray-400 font-mono">Proxy</Label>
              <Select value={proxyId} onValueChange={setProxyId}>
                <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1"><SelectValue placeholder="Select proxy…" /></SelectTrigger>
                <SelectContent className="bg-[#1a1a24] border-white/10 max-h-60">
                  {proxies.length === 0 && <SelectItem value="_none" disabled className="text-gray-500">No proxies configured</SelectItem>}
                  {proxies.map((p) => <SelectItem key={p.id} value={p.id} className="text-gray-100">{p.label || `${p.host}:${p.port}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {assignType === "group" && (
            <div>
              <Label className="text-xs text-gray-400 font-mono">Proxy Group</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger className="bg-white/5 border-white/10 font-mono text-xs mt-1"><SelectValue placeholder="Select group…" /></SelectTrigger>
                <SelectContent className="bg-[#1a1a24] border-white/10 max-h-60">
                  {groups.length === 0 && <SelectItem value="_none" disabled className="text-gray-500">No groups configured</SelectItem>}
                  {groups.map((g) => <SelectItem key={g.id} value={g.id} className="text-gray-100">{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={submit} disabled={saving} className="w-full bg-violet-600 hover:bg-violet-700 font-mono text-xs">{saving ? "Saving…" : "Save Account"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccountRow({ account, proxies, groups, onSaved, onLaunch }) {
  const [reveal, setReveal] = useState(false);
  const proxyDisplay =
    account.proxy_assignment_type === "single"
      ? (proxies.find((p) => p.id === account.proxy_id)?.label || "Proxy removed")
      : account.proxy_assignment_type === "group"
      ? (groups.find((g) => g.id === account.proxy_group_id)?.name || "Group removed")
      : "Direct (no proxy)";

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-white/[0.02] border border-white/5 rounded-sm hover:border-white/10 transition-colors">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${account.status === "signed_in" ? "bg-emerald-400" : account.status === "needs_code" ? "bg-yellow-400" : account.status === "failed" ? "bg-red-400" : "bg-gray-600"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-gray-100 truncate">{account.label}</span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${STATUS_STYLE[account.status] || STATUS_STYLE.untested}`}>{STATUS_LABEL[account.status] || account.status}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-mono text-gray-500 truncate">{account.email}</span>
          <span className="text-[10px] font-mono text-gray-700">·</span>
          <span className="text-[10px] font-mono text-gray-500 truncate">{reveal ? account.password : "••••••••"}</span>
          <button onClick={() => setReveal((r) => !r)} className="text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0">
            {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
        </div>
        <div className="text-[9px] font-mono text-gray-600 mt-0.5 truncate">{proxyDisplay}{account.last_used && ` · last used ${new Date(account.last_used).toLocaleString()}`}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={() => onLaunch(account)} className="flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] font-mono border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-all" title="Launch Walmart login">
          <LogIn className="w-3 h-3" /> Login
        </button>
        <AddAccountDialog editing={account} proxies={proxies} groups={groups} onSaved={onSaved} />
        <button onClick={async () => { await db.WalmartAccount.delete(account.id); toast.success("Account deleted"); onSaved(); }} className="p-1 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [a, p, g] = await Promise.all([
      db.WalmartAccount.list("-created_date"),
      db.Proxy.list("-created_date", 500),
      db.ProxyGroup.list(),
    ]);
    setAccounts(Array.isArray(a) ? a : []);
    setProxies(Array.isArray(p) ? p : []);
    setGroups(Array.isArray(g) ? g : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const launchLogin = async (acc) => {
    let proxy = null;
    if (acc.proxy_assignment_type === "single" && acc.proxy_id) {
      proxy = await db.Proxy.get(acc.proxy_id);
    } else if (acc.proxy_assignment_type === "group" && acc.proxy_group_id) {
      const pg = await db.ProxyGroup.get(acc.proxy_group_id);
      if (pg?.proxy_ids?.length) {
        const fetched = await Promise.all(pg.proxy_ids.map((id) => db.Proxy.get(id).catch(() => null)));
        proxy = fetched.find(Boolean);
      }
    }
    const now = new Date().toISOString();
    const sess = await db.BrowserSession.create({
      name: acc.label,
      target_url: LOGIN_URL,
      proxy_id: proxy?.id || null,
      proxy_label: proxy ? `${proxy.host}:${proxy.port}` : "No proxy",
      status: "running",
      browser: "chrome",
      rotation_mode: "sticky",
      started_at: now,
      walmart_account_id: acc.id,
      walmart_account_email: acc.email,
    });
    await launchBrowser({
      sessionId: sess.id,
      url: sess.target_url,
      proxy,
      browser: "chrome",
      manualOpen: true,
      credentials: { email: acc.email, password: acc.password },
      partitionKey: `walmart-account-${acc.id}`,
    });
    await db.WalmartAccount.update(acc.id, { status: "needs_code", last_used: now });
    toast.success(`Launched login for ${acc.label}`);
    load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" /></div>;

  const signedInCount = accounts.filter((a) => a.status === "signed_in").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-400" /> Walmart Accounts
          </h1>
          <p className="text-xs text-gray-500 font-mono mt-1">{accounts.length} account{accounts.length !== 1 ? "s" : ""} · {signedInCount} signed in</p>
        </div>
        <AddAccountDialog proxies={proxies} groups={groups} onSaved={load} />
      </div>

      <div className="rounded-sm border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
        <p className="text-xs font-mono text-yellow-400 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Launch a login, then watch the <strong className="text-yellow-300">IMAP</strong> tab — verification codes auto-fill into the open window or display for manual copy.
        </p>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/5 rounded-sm">
          <Users className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 font-mono">No accounts configured</p>
          <p className="text-xs text-gray-700 font-mono mt-1">Add a Walmart account to launch signed-in sessions</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => <AccountRow key={a.id} account={a} proxies={proxies} groups={groups} onSaved={load} onLaunch={launchLogin} />)}
        </div>
      )}
    </div>
  );
}
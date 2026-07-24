import { useState, useEffect } from "react";
import { User, Plus, Trash2, Edit2, Monitor } from "lucide-react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import toast from "react-hot-toast";

const BLANK = {
  name: "", user_agent: "", viewport_width: 1280, viewport_height: 800,
  language: "en-US", timezone: "America/New_York",
  webrtc_block: true, canvas_spoof: false, disable_webgl: false, extra_args: ""
};

function Toggle({ label, value, onChange, description }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-white/5 last:border-0">
      <div>
        <p className="text-xs font-mono text-gray-300">{label}</p>
        {description && <p className="text-[10px] font-mono text-gray-600 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${value ? "bg-emerald-500" : "bg-white/10"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? "translate-x-4" : ""}`} />
      </button>
    </div>
  );
}

function ProfileForm({ initial = null, onSave, onCancel = null, loading }) {
  const [form, setForm] = useState(initial || BLANK);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-xs text-gray-400 font-mono">Profile Name *</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. US Chrome Standard" className="bg-white/5 border-white/10 font-mono text-sm mt-1" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-gray-400 font-mono">User Agent <span className="text-gray-600">(optional)</span></Label>
          <Input value={form.user_agent} onChange={(e) => set("user_agent", e.target.value)} placeholder="Mozilla/5.0 ..." className="bg-white/5 border-white/10 font-mono text-xs mt-1" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono">Viewport Width</Label>
          <Input type="number" value={form.viewport_width} onChange={(e) => set("viewport_width", Number(e.target.value))} className="bg-white/5 border-white/10 font-mono text-xs mt-1" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono">Viewport Height</Label>
          <Input type="number" value={form.viewport_height} onChange={(e) => set("viewport_height", Number(e.target.value))} className="bg-white/5 border-white/10 font-mono text-xs mt-1" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono">Language</Label>
          <Input value={form.language} onChange={(e) => set("language", e.target.value)} placeholder="en-US" className="bg-white/5 border-white/10 font-mono text-xs mt-1" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 font-mono">Timezone</Label>
          <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} placeholder="America/New_York" className="bg-white/5 border-white/10 font-mono text-xs mt-1" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-gray-400 font-mono">Extra Chrome Args <span className="text-gray-600">(space-separated)</span></Label>
          <Input value={form.extra_args} onChange={(e) => set("extra_args", e.target.value)} placeholder="--disable-blink-features=AutomationControlled" className="bg-white/5 border-white/10 font-mono text-xs mt-1" />
        </div>
      </div>

      <div className="rounded border border-white/5 bg-white/[0.02] px-3 py-1">
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1 pt-1">Stealth Flags</p>
        <Toggle label="Block WebRTC Leaks" value={form.webrtc_block} onChange={(v) => set("webrtc_block", v)} description="--disable-webrtc-hw-encoding + block-webrtc flags" />
        <Toggle label="Canvas Fingerprint Noise" value={form.canvas_spoof} onChange={(v) => set("canvas_spoof", v)} description="Randomise canvas readback (reduces fingerprint uniqueness)" />
        <Toggle label="Disable WebGL" value={form.disable_webgl} onChange={(v) => set("disable_webgl", v)} description="--disable-webgl" />
      </div>

      <div className="flex gap-2">
        <Button onClick={() => onSave(form)} disabled={loading || !form.name} className="flex-1 bg-purple-600 hover:bg-purple-700 font-mono text-xs">
          {loading ? "Saving..." : "Save Profile"}
        </Button>
        {onCancel && <Button onClick={onCancel} variant="outline" className="border-white/10 text-gray-400 font-mono text-xs">Cancel</Button>}
      </div>
    </div>
  );
}

export default function SessionProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const load = async () => {
    const data = await db.SessionProfile.list("-created_date");
    setProfiles(data);
    setPageLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async (data) => {
    setSaving(true);
    await db.SessionProfile.create(data);
    setSaving(false);
    setDialogOpen(false);
    toast.success("Profile created");
    load();
  };

  const save = async (id, data) => {
    setSaving(true);
    await db.SessionProfile.update(id, data);
    setSaving(false);
    setEditingId(null);
    toast.success("Profile updated");
    load();
  };

  const del = async (id) => {
    await db.SessionProfile.delete(id);
    toast.success("Profile deleted");
    load();
  };

  if (pageLoading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-100 flex items-center gap-2"><User className="w-4 h-4 text-purple-400" /> Session Profiles</h1>
          <p className="text-xs text-gray-500 font-mono mt-1">Reusable browser fingerprint configs — attach to Task Groups</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-purple-600 hover:bg-purple-700 font-mono text-xs gap-2"><Plus className="w-3.5 h-3.5" /> New Profile</Button>
          </DialogTrigger>
          <DialogContent className="bg-[#0d0d16] border-white/10 text-gray-100 max-w-lg">
            <DialogHeader><DialogTitle className="font-mono text-sm text-purple-400">New Session Profile</DialogTitle></DialogHeader>
            <div className="mt-3"><ProfileForm onSave={create} loading={saving} /></div>
          </DialogContent>
        </Dialog>
      </div>

      {profiles.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/5 rounded-sm">
          <Monitor className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 font-mono">No profiles yet</p>
          <p className="text-xs text-gray-700 font-mono mt-1">Create profiles to reuse browser fingerprints across task groups</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {profiles.map((p) => (
            <div key={p.id} className="border border-white/5 bg-[#08080f] rounded-sm p-4 space-y-3 hover:border-purple-500/15 transition-colors">
              {editingId === p.id ? (
                <ProfileForm initial={p} onSave={(data) => save(p.id, data)} onCancel={() => setEditingId(null)} loading={saving} />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-sm text-gray-100">{p.name}</p>
                    <div className="flex gap-1">
                      <button onClick={() => setEditingId(p.id)} className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-white/5 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => del(p.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="text-[10px] font-mono text-gray-500 col-span-2 truncate">{p.user_agent || "Default UA"}</div>
                    <div className="text-[10px] font-mono text-gray-500"><Monitor className="w-2.5 h-2.5 inline mr-1" />{p.viewport_width}×{p.viewport_height}</div>
                    <div className="text-[10px] font-mono text-gray-500">🌐 {p.language} · {p.timezone}</div>
                    <div className="flex gap-2 col-span-2 mt-1">
                      {p.webrtc_block && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">WebRTC Block</span>}
                      {p.canvas_spoof && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">Canvas Noise</span>}
                      {p.disable_webgl && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">No WebGL</span>}
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
import { useState } from "react";
import { KeyRound, ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

export default function Activate() {
  const { activateWithKey, authError, isLoadingAuth } = useAuth();
  const [keyInput, setKeyInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const submit = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setLocalError("Enter your activation key.");
      return;
    }

    setSubmitting(true);
    setLocalError("");
    const result = await activateWithKey(trimmed);
    setSubmitting(false);

    if (!result.ok) {
      setLocalError(result.error || "Activation failed.");
    }
  };

  const loading = submitting || isLoadingAuth;

  return (
    <div className="min-h-screen bg-[#06060c] text-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-sm border border-emerald-500/20 bg-[#0d0d16] p-6 space-y-4">
        <div className="space-y-1">
          <p className="text-[11px] font-mono text-emerald-400 uppercase tracking-[0.25em]">Activation Required</p>
          <h1 className="font-mono text-lg text-gray-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Enter License Key
          </h1>
          <p className="text-xs font-mono text-gray-500">This build uses centralized Discord monitoring. Enter your unique key to unlock trigger access.</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-mono text-gray-400" htmlFor="activation-key">Activation Key</label>
          <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-black/20 px-2">
            <KeyRound className="w-3.5 h-3.5 text-gray-500" />
            <input
              id="activation-key"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="KNULL-XXXX-XXXX-XXXX"
              className="w-full bg-transparent py-2.5 text-sm font-mono text-gray-100 outline-none placeholder:text-gray-600"
            />
          </div>
        </div>

        {(localError || authError) && (
          <div className="rounded-sm border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-mono text-red-300">
            {localError || authError}
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-xs font-mono px-3 py-2.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
          {loading ? "Validating..." : "Activate"}
        </button>

        <p className="text-[10px] font-mono text-gray-600">
          Use a user license key here. Admin keys are not valid for client activation.
        </p>
        <p className="text-[10px] font-mono text-gray-700">
          If your app is offline, centralized drop triggers will not be delivered until reconnect.
        </p>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { db } from "@/lib/db";
import { CheckCircle, Clock, Mail, AlertCircle, RefreshCw, MonitorPlay } from "lucide-react";
import { focusBrowser } from "@/lib/electronBridge";

/**
 * WarmupStatusPanel — shows per-account login + IMAP code status for an active drop.
 * Polls every 5s so it stays fresh while warmup is in progress.
 */
export default function WarmupStatusPanel({ drop, accounts }) {
  const [verificationCodes, setVerificationCodes] = useState([]);
  const [liveAccounts, setLiveAccounts] = useState(accounts);
  const [sessions, setSessions] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const assignedAccounts = liveAccounts.filter((a) =>
    (drop.account_ids || []).includes(a.id)
  );

  // Map: walmart_account_id → session id (for focus button)
  const sessionByAccount = {};
  for (const s of sessions) {
    if (s.walmart_account_id && (drop.session_ids || []).includes(s.id)) {
      sessionByAccount[s.walmart_account_id] = s.id;
    }
  }

  const load = async () => {
    const [allAccounts, codes, allSessions] = await Promise.all([
      db.WalmartAccount.list().catch(() => []),
      db.VerificationCode.list("-created_date", 200).catch(() => []),
      db.BrowserSession.list("-created_date", 500).catch(() => []),
    ]);
    setLiveAccounts(Array.isArray(allAccounts) ? allAccounts : []);
    setVerificationCodes(Array.isArray(codes) ? codes : []);
    setSessions(Array.isArray(allSessions) ? allSessions : []);
    setLastRefresh(Date.now());
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [drop.id]);

  // Map: account_id → most recent verification code record
  const codeByAccount = {};
  for (const code of verificationCodes) {
    if (code.account_id && !codeByAccount[code.account_id]) {
      codeByAccount[code.account_id] = code;
    }
  }

  const signedIn  = assignedAccounts.filter((a) => a.status === "signed_in");
  const needsCode = assignedAccounts.filter((a) => a.status === "needs_code");
  const failed    = assignedAccounts.filter((a) => a.status === "failed");
  const untested  = assignedAccounts.filter((a) => a.status === "untested");

  return (
    <div className="space-y-3 pt-2 border-t border-white/5">
      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-1.5">
        <div className="rounded-sm bg-emerald-500/10 border border-emerald-500/20 px-2 py-1.5 text-center">
          <p className="text-[8px] font-mono text-emerald-600 uppercase tracking-widest">Logged In</p>
          <p className="text-sm font-mono font-bold text-emerald-400">{signedIn.length}</p>
        </div>
        <div className="rounded-sm bg-yellow-500/10 border border-yellow-500/20 px-2 py-1.5 text-center">
          <p className="text-[8px] font-mono text-yellow-600 uppercase tracking-widest">Needs Code</p>
          <p className="text-sm font-mono font-bold text-yellow-400">{needsCode.length}</p>
        </div>
        <div className="rounded-sm bg-red-500/10 border border-red-500/20 px-2 py-1.5 text-center">
          <p className="text-[8px] font-mono text-red-600 uppercase tracking-widest">Failed</p>
          <p className="text-sm font-mono font-bold text-red-400">{failed.length}</p>
        </div>
        <div className="rounded-sm bg-white/[0.02] border border-white/5 px-2 py-1.5 text-center">
          <p className="text-[8px] font-mono text-gray-600 uppercase tracking-widest">Pending</p>
          <p className="text-sm font-mono font-bold text-gray-500">{untested.length}</p>
        </div>
      </div>

      {/* Per-account rows */}
      <div className="space-y-1">
        {assignedAccounts.map((acc) => {
          const code = codeByAccount[acc.id];
          const isSignedIn  = acc.status === "signed_in";
          const needsVerify = acc.status === "needs_code";
          const isFailed    = acc.status === "failed";

          return (
            <div key={acc.id}
              className={`flex items-center gap-2 px-2 py-2 rounded-sm border text-[11px] font-mono transition-colors
                ${isSignedIn  ? "bg-emerald-500/5 border-emerald-500/15"
                : needsVerify ? "bg-yellow-500/5 border-yellow-500/15"
                : isFailed    ? "bg-red-500/5 border-red-500/15"
                :               "bg-white/[0.02] border-white/5"}`}>

              {/* Status icon */}
              {isSignedIn  && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
              {needsVerify && <Mail className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0 animate-pulse" />}
              {isFailed    && <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
              {!isSignedIn && !needsVerify && !isFailed && <Clock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />}

              {/* Account info */}
              <span className="text-gray-200 truncate max-w-[80px]">{acc.label}</span>
              <span className="text-gray-600 truncate flex-1">{acc.email}</span>

              {/* Code status */}
              <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                <div className="text-right">
                  {isSignedIn && (
                    <span className="text-emerald-400">✓ signed in</span>
                  )}
                  {needsVerify && code && (
                    <span className="text-yellow-300">
                      code: <span className="font-bold tracking-widest">{code.code}</span>
                      <span className="text-gray-600 ml-1">
                        ({code.delivery_status === "auto_filled" ? "auto-filled" : "received"})
                      </span>
                    </span>
                  )}
                  {needsVerify && !code && (
                    <span className="text-yellow-600 animate-pulse">waiting for code…</span>
                  )}
                  {isFailed && <span className="text-red-400">login failed</span>}
                  {acc.status === "untested" && <span className="text-gray-600">launching…</span>}
                </div>

                {/* Take Control — brings the hidden browser to front, no re-launch */}
                {sessionByAccount[acc.id] && (
                  <button
                    onClick={() => focusBrowser(sessionByAccount[acc.id])}
                    title="Bring browser to front for manual control"
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 transition-colors flex-shrink-0"
                  >
                    <MonitorPlay className="w-3 h-3" />
                    Take Control
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer refresh indicator */}
      <div className="flex items-center gap-1 text-[9px] font-mono text-gray-700">
        <RefreshCw className="w-2.5 h-2.5" />
        <span>auto-refresh every 5s · last updated {new Date(lastRefresh).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
import { useState } from "react";
import { Trash2, Activity, Power, PowerOff } from "lucide-react";
import { db } from "@/lib/db";
import { checkProxy } from "@/lib/electronBridge";
import StatusBadge from "@/components/proxy/StatusBadge";
import toast from "react-hot-toast";

export default function ProxyRow({ proxy, onUpdate }) {
  const [checking, setChecking] = useState(false);

  const handleHealthCheck = async () => {
    setChecking(true);
    const result = await checkProxy(proxy);
    await db.Proxy.update(proxy.id, {
      status: result.ok ? "healthy" : "unhealthy",
      response_time_ms: result.ok ? result.responseTime : null,
      last_checked: new Date().toISOString(),
      fail_count: result.ok ? 0 : (proxy.fail_count || 0) + 1,
      health_hint: result.hint || null,
    });
    if (result.ok) {
      toast.success(`Proxy is healthy (${result.responseTime}ms)`);
    } else if (result.protocolMismatch) {
      toast.error(`Protocol mismatch: ${result.hint}`);
    } else {
      toast.error("Proxy is unreachable");
    }
    setChecking(false);
    onUpdate?.();
  };

  const handleToggleActive = async () => {
    await db.Proxy.update(proxy.id, { is_active: !proxy.is_active });
    onUpdate?.();
  };

  const handleDelete = async () => {
    await db.Proxy.delete(proxy.id);
    toast.success("Proxy removed");
    onUpdate?.();
  };

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
      proxy.is_active
        ? "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"
        : "border-white/5 bg-white/[0.01] opacity-50"
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm text-gray-200 truncate">
            {proxy.host}:{proxy.port}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-500">
            {proxy.protocol}
          </span>
          {proxy.label && (
            <span className="text-[10px] text-gray-500 truncate">{proxy.label}</span>
          )}
          {proxy.country && (
            <span className="text-[10px] font-mono text-gray-600">{proxy.country}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <StatusBadge status={proxy.status} />
          {proxy.response_time_ms && (
            <span className="text-[10px] font-mono text-gray-500">{proxy.response_time_ms}ms</span>
          )}
          {proxy.last_checked && (
            <span className="text-[10px] text-gray-600">
              checked {new Date(proxy.last_checked).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleHealthCheck}
          disabled={checking}
          className="p-1.5 rounded-md hover:bg-white/5 text-gray-500 hover:text-emerald-400 transition-colors"
          title="Test proxy"
        >
          <Activity className={`w-3.5 h-3.5 ${checking ? "animate-pulse" : ""}`} />
        </button>
        <button
          onClick={handleToggleActive}
          className="p-1.5 rounded-md hover:bg-white/5 text-gray-500 hover:text-yellow-400 transition-colors"
          title={proxy.is_active ? "Disable" : "Enable"}
        >
          {proxy.is_active ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={handleDelete}
          className="p-1.5 rounded-md hover:bg-white/5 text-gray-500 hover:text-red-400 transition-colors"
          title="Remove"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
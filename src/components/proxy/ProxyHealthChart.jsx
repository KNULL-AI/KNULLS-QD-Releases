import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

/**
 * Derives a per-proxy bar chart from the current proxy list.
 * Each bar = one proxy, showing healthy (green) vs fail_count (red).
 * Only shows proxies that have been checked at least once.
 */
export default function ProxyHealthChart({ proxies }) {
  const data = useMemo(() => {
    const checked = proxies.filter((p) => p.status !== "untested" && p.last_checked);
    // Sort: most failures first so worst offenders stand out on the left
    return checked
      .map((p) => ({
        label: p.label || `${p.host}:${p.port}`,
        healthy: p.status === "healthy" ? 1 : 0,
        failures: p.fail_count || 0,
        latency: p.response_time_ms || 0,
        status: p.status,
      }))
      .sort((a, b) => b.failures - a.failures)
      .slice(0, 40); // cap at 40 so bars stay readable
  }, [proxies]);

  if (data.length === 0) return null;

  const healthy = proxies.filter((p) => p.status === "healthy").length;
  const unhealthy = proxies.filter((p) => p.status === "unhealthy").length;
  const untested = proxies.filter((p) => p.status === "untested").length;
  const total = proxies.length;
  const successRate = total > 0 ? Math.round((healthy / (healthy + unhealthy || 1)) * 100) : 0;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-[#0d0d1a] border border-white/10 rounded-sm px-3 py-2 font-mono text-[10px] space-y-0.5 shadow-xl">
        <p className="text-gray-200 font-semibold truncate max-w-[180px]">{d.label}</p>
        <p className={d.status === "healthy" ? "text-emerald-400" : "text-red-400"}>
          Status: {d.status}
        </p>
        {d.latency > 0 && <p className="text-gray-400">Latency: {d.latency}ms</p>}
        <p className="text-red-400">Fail count: {d.failures}</p>
      </div>
    );
  };

  return (
    <div className="border border-white/5 rounded-sm bg-white/[0.02] p-4 space-y-3">
      {/* Header + summary stats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-semibold text-gray-200">Proxy Health Overview</p>
          <p className="font-mono text-[10px] text-gray-600 mt-0.5">
            {data.length} checked · sorted by failure count
          </p>
        </div>
        <div className="flex items-center gap-4 font-mono text-[10px]">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />
            <span className="text-gray-400">{healthy} healthy</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />
            <span className="text-gray-400">{unhealthy} unhealthy</span>
          </span>
          {untested > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-gray-600 inline-block" />
              <span className="text-gray-500">{untested} untested</span>
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-sm border font-semibold ${
            successRate >= 80 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : successRate >= 50 ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
            : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}>
            {successRate}% pass rate
          </span>
        </div>
      </div>

      {/* Bar chart: one bar per proxy colored by status */}
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} barSize={data.length > 20 ? 6 : 12} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <XAxis dataKey="label" tick={false} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "#4b5563", fontFamily: "monospace" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="failures" name="Failures" radius={[2, 2, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={
                  entry.status === "healthy" && entry.failures === 0
                    ? "#10b981"   // solid green — perfect
                    : entry.status === "healthy"
                    ? "#f59e0b"   // amber — healthy but has had failures
                    : "#ef4444"   // red — currently unhealthy
                }
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Latency sparkline — only if any latency data exists */}
      {data.some((d) => d.latency > 0) && (
        <>
          <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest pt-1">Response Time (ms) — checked proxies</p>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart
              data={[...data].sort((a, b) => a.latency - b.latency)}
              barSize={data.length > 20 ? 6 : 12}
              margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
            >
              <XAxis dataKey="label" tick={false} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "#4b5563", fontFamily: "monospace" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="latency" name="Latency" radius={[2, 2, 0, 0]}>
                {[...data]
                  .sort((a, b) => a.latency - b.latency)
                  .map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        entry.latency === 0 ? "#374151"
                        : entry.latency < 300 ? "#10b981"
                        : entry.latency < 800 ? "#f59e0b"
                        : "#ef4444"
                      }
                      fillOpacity={0.8}
                    />
                  ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
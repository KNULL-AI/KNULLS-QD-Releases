export default function StatusBadge({ status }) {
  const config = {
    healthy: { bg: "bg-emerald-500/15", text: "text-emerald-400", dot: "bg-emerald-400" },
    unhealthy: { bg: "bg-red-500/15", text: "text-red-400", dot: "bg-red-400" },
    untested: { bg: "bg-gray-500/15", text: "text-gray-400", dot: "bg-gray-500" },
    running: { bg: "bg-blue-500/15", text: "text-blue-400", dot: "bg-blue-400" },
    stopped: { bg: "bg-gray-500/15", text: "text-gray-400", dot: "bg-gray-500" },
    error: { bg: "bg-red-500/15", text: "text-red-400", dot: "bg-red-400" },
  };

  const c = config[status] || config.untested;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${status === "running" ? "animate-pulse" : ""}`} />
      {status}
    </span>
  );
}
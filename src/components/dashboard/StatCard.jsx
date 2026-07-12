export default function StatCard({ label, value, icon: Icon, color = "emerald" }) {
  const colorMap = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    blue: "text-blue-400 bg-blue-500/10",
    red: "text-red-400 bg-red-500/10",
    gray: "text-gray-400 bg-gray-500/10",
    yellow: "text-yellow-400 bg-yellow-500/10",
  };

  const c = colorMap[color] || colorMap.emerald;
  const [iconColor, iconBg] = c.split(" ");

  return (
    <div className="relative p-4 rounded-sm border border-white/5 bg-[#08080f] overflow-hidden group hover:border-emerald-500/20 transition-colors">
      {/* top-left bracket */}
      <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-emerald-500/30" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-emerald-500/10" />
      {/* faint bg glow */}
      <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity ${iconBg}`} style={{ filter: "blur(30px)" }} />
      <div className="relative flex items-center gap-3">
        <div className={`w-9 h-9 rounded-sm border border-white/5 ${iconBg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
        <div>
          <p className="text-2xl font-mono font-bold text-gray-100">{value}</p>
          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">{label}</p>
        </div>
      </div>
    </div>
  );
}
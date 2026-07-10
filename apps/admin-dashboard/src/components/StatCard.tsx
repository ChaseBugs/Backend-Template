interface Props {
  label: string;
  value: string | number;
  icon: string;
  color: string;   // tailwind bg class e.g. 'bg-blue-50'
  iconColor: string; // e.g. 'text-blue-500'
  sub?: string;
}

export default function StatCard({ label, value, icon, color, iconColor, sub }: Props) {
  return (
    <div className="card p-6 flex items-start gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${color} flex-shrink-0`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-sm text-slate-500 font-medium mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-slate-800 truncate">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

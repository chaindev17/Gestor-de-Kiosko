import React from 'react';

export default function StatCard({ label, value, hint, icon: Icon, tone = 'default' }) {
  const toneStyles = {
    default: 'bg-[#F4F2EC] text-[#3E4652]',
    brand: 'bg-[#0F5C4D]/10 text-[#0F5C4D]',
    navy: 'bg-[#1E3A5F]/10 text-[#1E3A5F]',
    amber: 'bg-[#B45309]/12 text-[#B45309]',
    red: 'bg-[#B91C1C]/10 text-[#B91C1C]',
  };

  return (
    <div className="card p-4 flex flex-col justify-between gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[#66707D]">{label}</span>
        {Icon && (
          <span className={`rounded-lg p-1.5 ${toneStyles[tone] || toneStyles.default}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="text-xl font-bold tracking-tight text-[#171C22] tabular-nums">{value}</div>
      {hint && <p className="text-xs text-[#66707D] leading-snug">{hint}</p>}
    </div>
  );
}

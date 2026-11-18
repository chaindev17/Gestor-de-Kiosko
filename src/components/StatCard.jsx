import React from 'react';

export default function StatCard({ label, value, hint, icon: Icon, tone = 'default' }) {
  const toneStyles = {
    default: 'bg-[#F3EFE7] text-[#3F3C37]',
    brand: 'bg-[#E7F3EE] text-[#15614B]',
    navy: 'bg-[#181715] text-[#FAF8F4]',
    amber: 'bg-[#FBEEE8] text-[#C2542D]',
    red: 'bg-red-50 text-red-700',
  };

  return (
    <div className="card p-5 flex flex-col justify-between gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7A746B]">
          {label}
        </span>
        {Icon && (
          <span className={`rounded-xl p-2 ${toneStyles[tone] || toneStyles.default}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="text-xl font-bold tracking-tight text-[#181715] tabular-nums">{value}</div>
      {hint && <p className="text-xs text-[#6E685F] leading-snug">{hint}</p>}
    </div>
  );
}

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-xl',
  printable = false,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[#171C22]/45 p-4 backdrop-blur-[1px] ${
        printable ? 'print:static print:bg-white print:p-0' : 'no-print'
      }`}
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-xl border border-[#DFDBD0] bg-white shadow-xl print:max-h-none print:shadow-none print:border-0`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#ECE9E0] bg-white px-5 py-4 print:static">
          <div>
            <h3 className="text-base font-semibold text-[#171C22]">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-[#656E7B]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#656E7B] hover:bg-[#F3F1EB] hover:text-[#171C22] no-print"
            aria-label="Cerrar ventana"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

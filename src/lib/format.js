export function formatCup(value, decimals = 2) {
  const num = Number(value) || 0;
  return `${num.toLocaleString('es-CU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} CUP`;
}

export function formatNumber(value, maxDecimals = 2) {
  const num = Number(value) || 0;
  return num.toLocaleString('es-CU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

export function formatDate(iso) {
  if (!iso) return '—';
  const clean = String(iso).slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const str = String(iso).replace('T', ' ').slice(0, 16);
  const [d, t] = str.split(' ');
  return `${formatDate(d)}${t ? ` · ${t}` : ''}`;
}

export const ROLE_META = {
  jefe: {
    label: 'Jefe del Negocio',
    short: 'Jefe',
    description: 'Dirección general, personal, turnos, aprobaciones e inspecciones',
    badgeClass: 'bg-[#0F5C4D]/12 text-[#0F5C4D] border-[#0F5C4D]/25',
  },
  economico: {
    label: 'Económico',
    short: 'Económico',
    description: 'Contabilidad NCIF, ONAT, fichas de costo MFP, bancarización y nómina',
    badgeClass: 'bg-[#1E3A5F]/12 text-[#1E3A5F] border-[#1E3A5F]/25',
  },
  almacenero: {
    label: 'Almacenero',
    short: 'Almacenero',
    description: 'Recepción SC-2-04, despacho al kiosko SC-2-09, submayor SC-2-14 y mermas',
    badgeClass: 'bg-[#8A4B08]/12 text-[#8A4B08] border-[#8A4B08]/25',
  },
  vendedor: {
    label: 'Vendedor de Turno',
    short: 'Vendedor',
    description: 'Punto de venta (CUP/Transfermóvil/EnZona), IPV en vivo y arqueo de caja',
    badgeClass: 'bg-[#5B3A70]/12 text-[#5B3A70] border-[#5B3A70]/25',
  },
};

export function downloadCsv(filename, headers, rows) {
  const escape = (val) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

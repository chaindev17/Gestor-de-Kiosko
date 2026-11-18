import React, { useMemo } from 'react';

function buildMatrix(seedText) {
  const size = 17;
  let hash = 2166136261;
  const s = String(seedText || 'kiosko-CONECTA');
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const nextBit = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return (hash >>> 0) % 2 === 1;
  };

  const inFinder = (r, c, fr, fc) => {
    const dr = r - fr;
    const dc = c - fc;
    if (dr < 0 || dr > 4 || dc < 0 || dc > 4) return null;
    if (dr === 0 || dr === 4 || dc === 0 || dc === 4) return true;
    if (dr === 2 && dc === 2) return true;
    return false;
  };

  const cells = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const f1 = inFinder(r, c, 0, 0);
      const f2 = inFinder(r, c, 0, size - 5);
      const f3 = inFinder(r, c, size - 5, 0);
      if (f1 !== null) {
        if (f1) cells.push([r, c]);
      } else if (f2 !== null) {
        if (f2) cells.push([r, c]);
      } else if (f3 !== null) {
        if (f3) cells.push([r, c]);
      } else if ((r === 5 && c < 6) || (c === 5 && r < 6)) {
        // quiet separator
      } else if ((r === 5 && c >= size - 6) || (c === size - 6 && r < 6)) {
        // quiet separator
      } else if ((r === size - 6 && c < 6) || (c === 5 && r >= size - 6)) {
        // quiet separator
      } else if (nextBit()) {
        cells.push([r, c]);
      }
    }
  }
  return { size, cells };
}

export default function QrCodeBadge({ value, size = 108, className = '' }) {
  const { size: grid, cells } = useMemo(() => buildMatrix(value), [value]);

  return (
    <div
      className={`inline-flex items-center justify-center rounded-2xl border border-[#E7E1D6] bg-white p-2.5 ${className}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${grid} ${grid}`}
        shapeRendering="crispEdges"
        aria-label={`Código QR ${value}`}
      >
        <rect width={grid} height={grid} fill="#FFFFFF" />
        {cells.map(([r, c]) => (
          <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#181715" />
        ))}
      </svg>
    </div>
  );
}

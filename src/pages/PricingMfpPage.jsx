import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Edit3, Printer, ShieldAlert, Wand2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatCup, formatDate, formatNumber } from '../lib/format.js';
import Modal from '../components/Modal.jsx';

export default function PricingMfpPage({ user, onRefreshBadges, notify }) {
  const [data, setData] = useState(null);
  const [viewMode, setViewMode] = useState(
    user.role === 'economico' || user.role === 'jefe' ? 'fichas' : 'tablilla'
  );
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    sale_price_cup: '',
    indirect_cost_pct: 8,
    is_price_capped: false,
    price_cap_cup: '',
    price_cap_resolution: 'Res. 225/2024 MFP',
    is_margin_regulated: true,
    reason: '',
  });
  const [busy, setBusy] = useState(false);

  const canEdit = user.role === 'economico' || user.role === 'jefe';

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/finance/cost-sheets');
      setData(res);
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openEditor(item) {
    setEditing(item);
    setForm({
      sale_price_cup: item.sale_price_cup,
      indirect_cost_pct: item.indirect_cost_pct,
      is_price_capped: Boolean(item.is_price_capped),
      price_cap_cup: item.price_cap_cup || '',
      price_cap_resolution: item.price_cap_resolution || 'Res. 225/2024 MFP',
      is_margin_regulated: Boolean(item.is_margin_regulated),
      reason: '',
    });
  }

  async function savePrice(e) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/finance/products/${editing.id}/price`, form);
      notify(
        `Ficha de Costo actualizada: ${editing.name} → ${formatCup(r.sale_price_cup)} (margen ${r.cost_sheet.margin_pct}%).`
      );
      setEditing(null);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function autoOptimize() {
    setBusy(true);
    try {
      const r = await api.post('/api/finance/auto-optimize-prices', {});
      notify(
        r.adjusted_count > 0
          ? `${r.adjusted_count} producto(s) ajustados automáticamente a límites legales MFP.`
          : 'Todos los productos cumplen ya los topes Res. 225/2024 y el margen máximo del 30%.'
      );
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="py-12 text-center text-sm text-[#66707D]">Cargando fichas de costo y precios...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#171C22]">
            Fichas de Costo y Tablilla Oficial de Precios (MFP)
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            Resolución 225/2024 MFP (6 productos topados) · Margen máximo {data.business.max_regulated_margin_pct}% · Decreto 30/2021 (DIS)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <div className="inline-flex rounded-lg border border-[#D5D0C4] bg-white p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('fichas')}
                className={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                  viewMode === 'fichas' ? 'bg-[#0F5C4D] text-white' : 'text-[#4C5561]'
                }`}
              >
                Fichas de Costo
              </button>
              <button
                type="button"
                onClick={() => setViewMode('tablilla')}
                className={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                  viewMode === 'tablilla' ? 'bg-[#0F5C4D] text-white' : 'text-[#4C5561]'
                }`}
              >
                Tablilla Mostrador
              </button>
            </div>
          )}
          {canEdit && (
            <button type="button" disabled={busy} onClick={autoOptimize} className="btn-secondary text-xs">
              <Wand2 className="h-3.5 w-3.5 text-[#0F5C4D]" />
              Auto-ajustar MFP
            </button>
          )}
          <button type="button" onClick={() => window.print()} className="btn-primary text-xs">
            <Printer className="h-3.5 w-3.5" />
            Imprimir Tablilla
          </button>
        </div>
      </div>

      {/* Res. 225/2024 Official Caps Reference Strip */}
      <div className="card p-4 bg-[#FAF9F5] no-print">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#66707D] mb-2">
          Topes Minoristas Oficiales Vigentes — Resolución 225/2024 del Ministerio de Finanzas y Precios
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs tabular-nums">
          {data.mfp_res_225_caps.map((cap) => (
            <div key={cap.key} className="rounded-lg border border-[#E3DFD5] bg-white px-2.5 py-2">
              <p className="font-medium text-[#171C22] truncate text-[11px]">{cap.name}</p>
              <p className="font-bold text-[#0F5C4D] mt-0.5">
                {cap.cap_cup} CUP/{cap.unit}
              </p>
            </div>
          ))}
        </div>
      </div>

      {viewMode === 'fichas' && canEdit ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Costo Compra</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Costo + Gasto</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Máx. 30%</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Tope MFP</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Precio Venta</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Margen</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Estado</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Ficha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
                {data.items.map((it) => {
                  const cs = it.cost_sheet;
                  return (
                    <tr key={it.id} className="hover:bg-[#FAF9F5]">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-[#171C22]">{it.name}</p>
                        <p className="text-[11px] text-[#6F7885]">
                          {it.sku} · UM: {it.unit}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right">{formatCup(cs.unit_cost_cup)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {formatCup(cs.full_cost_cup)}{' '}
                        <span className="text-[10px] text-[#7B8491]">(+{cs.indirect_pct}%)</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{formatCup(cs.max_price_by_margin_cup)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {cs.price_cap_cup ? (
                          <span className="font-semibold text-amber-800">{formatCup(cs.price_cap_cup, 0)}</span>
                        ) : (
                          <span className="text-[#8B93A0]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-[#0F5C4D]">
                        {formatCup(cs.sale_price_cup, 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold">{cs.margin_pct}%</td>
                      <td className="px-3 py-2.5 text-center">
                        {cs.compliance_status === 'OK' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            <CheckCircle2 className="h-3 w-3" /> Legal
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                            <ShieldAlert className="h-3 w-3" /> {cs.compliance_status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => openEditor(it)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5C4D] hover:underline cursor-pointer"
                        >
                          <Edit3 className="h-3 w-3" /> Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Printable Official Tablilla de Precios en CUP */
        <div className="card p-6 max-w-4xl mx-auto space-y-4">
          <div className="text-center border-b-2 border-[#171C22] pb-3 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#525B68]">
              Tablilla Oficial de Precios al Consumidor — Moneda Nacional (CUP)
            </p>
            <h2 className="text-lg font-bold text-[#171C22]">{data.business.business_name}</h2>
            <p className="text-xs text-[#4C5561]">
              NIT: {data.business.nit} · {data.business.address}, {data.business.municipality},{' '}
              {data.business.province}
            </p>
            <p className="text-xs font-medium text-[#0F5C4D]">
              Aceptamos Efectivo CUP · Transfermóvil ({data.business.transfermovil_merchant_code}) · EnZona (
              {data.business.enzona_merchant_code})
              {data.business.qr_discount_pct > 0
                ? ` · Bonificación electrónica: ${data.business.qr_discount_pct}%`
                : ''}
            </p>
          </div>

          <table className="w-full text-sm">
            <thead className="border-b border-[#171C22] text-xs uppercase text-[#4C5561]">
              <tr>
                <th className="py-2 text-left">Producto</th>
                <th className="py-2 text-center">Unidad</th>
                <th className="py-2 text-center">Disponibilidad</th>
                <th className="py-2 text-left">Norma</th>
                <th className="py-2 text-right">Precio Oficial (CUP)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE8DE] tabular-nums">
              {data.items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2 font-medium text-[#171C22]">{it.name}</td>
                  <td className="py-2 text-center text-xs text-[#525B68]">{it.unit}</td>
                  <td className="py-2 text-center text-xs">
                    {it.kiosk_stock > 0 ? `${formatNumber(it.kiosk_stock)} ${it.unit}` : 'En reposición'}
                  </td>
                  <td className="py-2 text-xs text-[#66707D]">
                    {it.is_price_capped
                      ? `${it.price_cap_resolution} (Tope ${it.price_cap_cup} CUP)`
                      : 'Ficha de Costo MFP'}
                  </td>
                  <td className="py-2 text-right font-bold text-[#171C22]">
                    {formatCup(it.sale_price_cup, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pt-4 border-t border-[#D5D0C4] flex justify-between text-xs text-[#525B68]">
            <span>Actualizado: {formatDate(new Date().toISOString())}</span>
            <span>Aprobado por Económico y Jefe del Negocio (Decreto 30/2021)</span>
          </div>
        </div>
      )}

      {/* Edit Cost Sheet Modal */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Ficha de Costo MFP — ${editing?.name || ''}`}
        subtitle="El sistema bloquea automáticamente precios superiores al tope Res. 225/2024 o al 30% de margen"
      >
        {editing && (
          <form onSubmit={savePrice} className="space-y-3.5 text-xs">
            <div className="rounded-lg bg-[#FAF9F5] border border-[#E3DFD5] p-3 space-y-1 tabular-nums">
              <div className="flex justify-between">
                <span>Costo unitario ponderado (Almacén):</span>
                <strong>{formatCup(editing.cost_sheet.unit_cost_cup)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Costo + Gastos reconocidos ({form.indirect_cost_pct}%):</span>
                <strong>
                  {formatCup(editing.cost_sheet.unit_cost_cup * (1 + Number(form.indirect_cost_pct || 0) / 100))}
                </strong>
              </div>
              <div className="flex justify-between text-[#0F5C4D]">
                <span>Máximo legal permitido:</span>
                <strong>
                  {editing.cost_sheet.legal_max_price_cup
                    ? formatCup(editing.cost_sheet.legal_max_price_cup)
                    : 'Libre formación'}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>Precio óptimo sugerido MFP:</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, sale_price_cup: editing.cost_sheet.suggested_price_cup })}
                  className="font-bold text-[#0F5C4D] underline cursor-pointer"
                >
                  Aplicar {formatCup(editing.cost_sheet.suggested_price_cup, 0)}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium mb-1">Precio minorista (CUP)</label>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  className="input-field tabular-nums font-bold"
                  value={form.sale_price_cup}
                  onChange={(e) => setForm({ ...form, sale_price_cup: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">% Gastos indirectos reconocidos</label>
                <input
                  type="number"
                  min="0"
                  max="25"
                  step="0.5"
                  className="input-field tabular-nums"
                  value={form.indirect_cost_pct}
                  onChange={(e) => setForm({ ...form, indirect_cost_pct: e.target.value })}
                />
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_price_capped}
                onChange={(e) => setForm({ ...form, is_price_capped: e.target.checked })}
              />
              Sujeto a precio topado oficial (MFP / Consejo de la Administración Municipal)
            </label>

            {form.is_price_capped && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Precio tope (CUP)</label>
                  <input
                    type="number"
                    min="1"
                    className="input-field tabular-nums"
                    value={form.price_cap_cup}
                    onChange={(e) => setForm({ ...form, price_cap_cup: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Resolución / Acuerdo</label>
                  <input
                    className="input-field"
                    value={form.price_cap_resolution}
                    onChange={(e) => setForm({ ...form, price_cap_resolution: e.target.value })}
                  />
                </div>
              </div>
            )}

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_margin_regulated}
                onChange={(e) => setForm({ ...form, is_margin_regulated: e.target.checked })}
              />
              Aplicar límite de margen comercial del {data.business.max_regulated_margin_pct}% sobre costos y gastos
            </label>

            <div>
              <label className="block font-medium mb-1">Motivo de actualización</label>
              <input
                className="input-field"
                placeholder="Ej. Variación de costo de adquisición en factura mayorista"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary text-xs">
                Cancelar
              </button>
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                Aprobar Ficha de Costo
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

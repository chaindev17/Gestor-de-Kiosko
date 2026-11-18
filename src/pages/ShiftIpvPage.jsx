import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  Download,
  Lock,
  Play,
  Printer,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { downloadCsv, formatCup, formatDate, formatDateTime, formatNumber } from '../lib/format.js';
import Modal from '../components/Modal.jsx';

export default function ShiftIpvPage({ user, onRefreshBadges, notify }) {
  const [activeRes, setActiveRes] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [viewedBundle, setViewedBundle] = useState(null);
  const [sellers, setSellers] = useState([]);

  // Close register modal state
  const [closingReg, setClosingReg] = useState(null);
  const [denoms, setDenoms] = useState({});
  const [closingNotes, setClosingNotes] = useState('');

  // Open shift/register modal state
  const [openModal, setOpenModal] = useState(false);
  const [openForm, setOpenForm] = useState({
    shift_template_id: '',
    register_number: 1,
    seller_id: '',
    opening_cash_cup: 3000,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [act, hist] = await Promise.all([
        api.get('/api/pos/active-shift'),
        api.get('/api/pos/shifts'),
      ]);
      setActiveRes(act);
      setSessions(hist.sessions || []);
      if (act.active) {
        setViewedBundle(act.active);
      } else if (hist.sessions?.length) {
        const first = await api.get(`/api/pos/shifts/${hist.sessions[0].id}/ipv`);
        setViewedBundle(first);
      }
      if (user.role === 'jefe') {
        const st = await api.get('/api/config/staff');
        const allowOwner = Boolean(st.config?.owner_can_operate_pos);
        setSellers(
          (st.staff || []).filter(
            (u) => u.active && (u.role === 'vendedor' || (allowOwner && u.role === 'jefe'))
          )
        );
      }
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify, user.role]);

  useEffect(() => {
    load();
  }, [load]);

  async function selectSession(id) {
    try {
      const b = await api.get(`/api/pos/shifts/${id}/ipv`);
      setViewedBundle(b);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  function startOpenModal(preferredReg = 1) {
    const defaultTpl =
      activeRes?.active?.session?.shift_template_id ||
      user.shift_template_id ||
      activeRes?.shift_templates?.[0]?.id ||
      '';
    setOpenForm({
      shift_template_id: defaultTpl,
      register_number: preferredReg,
      seller_id: user.role === 'vendedor' ? user.id : sellers[0]?.id || '',
      opening_cash_cup: activeRes?.payment_config?.petty_cash_fund_cup || 3000,
    });
    setOpenModal(true);
  }

  async function handleOpenRegister(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/pos/shifts/open', openForm);
      notify('Caja habilitada en el turno con IPV inicializado automáticamente.');
      setOpenModal(false);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function startCloseRegister(reg) {
    // Pre-fill exact bill breakdown matching expected_cash_cup for faster counting, editable by seller
    let rem = Math.floor(reg.expected_cash_cup);
    const bills = activeRes?.denominations || [1000, 500, 200, 100, 50, 20, 10, 5, 3, 1];
    const preset = {};
    for (const b of bills) {
      const q = Math.floor(rem / b);
      if (q > 0) {
        preset[b] = q;
        rem -= q * b;
      }
    }
    const cents = Math.round((reg.expected_cash_cup - Math.floor(reg.expected_cash_cup)) * 100) / 100;
    if (cents > 0) preset.monedas = cents;
    setDenoms(preset);
    setClosingNotes('');
    setClosingReg(reg);
  }

  const countedTotal = useMemo(() => {
    const bills = activeRes?.denominations || [1000, 500, 200, 100, 50, 20, 10, 5, 3, 1];
    let sum = 0;
    for (const b of bills) {
      sum += b * Math.max(0, Math.floor(Number(denoms[b] || 0)));
    }
    sum += Math.max(0, Number(denoms.monedas || 0));
    return Math.round(sum * 100) / 100;
  }, [denoms, activeRes]);

  async function handleCloseRegister(e) {
    e.preventDefault();
    if (!closingReg) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/pos/registers/${closingReg.id}/close`, {
        denominations: denoms,
        closing_notes: closingNotes,
      });
      const depositMsg = r.auto_deposit
        ? ` Orden de depósito ${r.auto_deposit.order_number} generada por ${formatCup(r.auto_deposit.amount_cup)} (Res. 111/2023 BCC).`
        : '';
      notify(
        `Caja ${r.register_number} arqueada (diferencia: ${formatCup(r.cash_difference_cup)}).${depositMsg}`
      );
      setClosingReg(null);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleAudit(sessionId) {
    setBusy(true);
    try {
      const r = await api.post(`/api/pos/shifts/${sessionId}/audit`, {});
      notify(`Turno ${r.session_code} auditado y firmado por Economía.`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function exportIpvCsv() {
    if (!viewedBundle) return;
    downloadCsv(
      `IPV-${viewedBundle.session.session_code}.csv`,
      ['SKU', 'Producto', 'UM', 'Inicio', 'Entradas', 'Mermas', 'Vendido', 'Final', 'Precio CUP', 'Importe CUP'],
      viewedBundle.ipv.map((r) => [
        r.sku,
        r.product_name,
        r.unit,
        r.opening_qty,
        r.entries_qty,
        r.losses_qty,
        r.sold_qty,
        r.closing_qty,
        r.sale_price_cup,
        r.sold_amount_cup,
      ])
    );
  }

  if (!activeRes) {
    return <div className="py-12 text-center text-sm text-[#66707D]">Cargando turnos e IPV...</div>;
  }

  const canOpen = user.role === 'vendedor' || user.role === 'jefe';
  const canAudit = user.role === 'economico' || user.role === 'jefe';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#171C22]">
            Control de Turnos, Doble Caja e IPV
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            2 vendedores por turno (Caja 1 y Caja 2) · Arqueo por denominación CUP · Informe de Producto a la Venta (IPV)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {sessions.length > 0 && (
            <select
              className="input-field text-xs py-1.5 w-auto"
              value={viewedBundle?.session?.id || ''}
              onChange={(e) => selectSession(Number(e.target.value))}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.session_code} — {s.shift_name} ({s.status})
                </option>
              ))}
            </select>
          )}
          {canOpen && (!activeRes.active || activeRes.active.registers.length < 2) && (
            <button
              type="button"
              onClick={() => startOpenModal(activeRes.active?.registers?.[0]?.register_number === 1 ? 2 : 1)}
              className="btn-primary text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              {activeRes.active ? 'Incorporar 2do Vendedor' : 'Abrir Nuevo Turno'}
            </button>
          )}
          {viewedBundle && (
            <>
              <button type="button" onClick={exportIpvCsv} className="btn-secondary text-xs">
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
              <button type="button" onClick={() => window.print()} className="btn-secondary text-xs">
                <Printer className="h-3.5 w-3.5" />
                Imprimir IPV
              </button>
            </>
          )}
        </div>
      </div>

      {viewedBundle && (
        <>
          {/* Session Summary Banner */}
          <div className="card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-[#171C22]">
                    {viewedBundle.session.shift_name} · {viewedBundle.session.session_code}
                  </h2>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      viewedBundle.session.status === 'ABIERTO'
                        ? 'bg-emerald-100 text-emerald-800'
                        : viewedBundle.session.status === 'AUDITADO'
                        ? 'bg-[#1E3A5F]/12 text-[#1E3A5F]'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {viewedBundle.session.status}
                  </span>
                </div>
                <p className="text-xs text-[#66707D] mt-0.5">
                  Fecha: {formatDate(viewedBundle.session.work_date)} · Apertura:{' '}
                  {formatDateTime(viewedBundle.session.opened_at)}
                  {viewedBundle.session.audited_by_name
                    ? ` · Auditado por: ${viewedBundle.session.audited_by_name}`
                    : ''}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right tabular-nums">
                  <p className="text-[11px] uppercase text-[#66707D]">Recaudación Total Turno</p>
                  <p className="text-lg font-bold text-[#0F5C4D]">
                    {formatCup(viewedBundle.totals.total_sales_cup)}
                  </p>
                </div>
                {canAudit && viewedBundle.session.status === 'CERRADO' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleAudit(viewedBundle.session.id)}
                    className="btn-primary text-xs"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Firmar Auditoría
                  </button>
                )}
              </div>
            </div>

            {/* 2 Seller Registers Side by Side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((regNum) => {
                const reg = viewedBundle.registers.find((r) => r.register_number === regNum);
                if (!reg) {
                  return (
                    <div
                      key={regNum}
                      className="rounded-xl border border-dashed border-[#D5D0C4] p-4 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-xs font-bold text-[#66707D]">Caja {regNum} — Sin vendedor asignado</p>
                        <p className="text-xs text-[#87909D]">Cupo disponible (2 vendedores por turno)</p>
                      </div>
                      {canOpen && viewedBundle.session.status === 'ABIERTO' && (
                        <button
                          type="button"
                          onClick={() => startOpenModal(regNum)}
                          className="btn-secondary text-xs py-1.5"
                        >
                          Abrir Caja {regNum}
                        </button>
                      )}
                    </div>
                  );
                }

                const canCloseThis =
                  reg.status === 'ABIERTA' &&
                  (user.role === 'jefe' || (user.role === 'vendedor' && reg.seller_id === user.id));

                return (
                  <div key={regNum} className="rounded-xl border border-[#E3DFD5] bg-[#FAF9F5] p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold uppercase text-[#0F5C4D]">
                          Caja {reg.register_number} · Vendedor {reg.register_number}
                        </span>
                        <p className="text-sm font-bold text-[#171C22]">{reg.seller_name}</p>
                        <p className="text-[11px] text-[#66707D]">
                          CI {reg.seller_ci} · {reg.sales_count} comprobantes
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          reg.status === 'ABIERTA'
                            ? 'bg-emerald-100 text-emerald-800'
                            : reg.status === 'VALIDADA'
                            ? 'bg-[#1E3A5F]/15 text-[#1E3A5F]'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {reg.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs tabular-nums border-t border-[#E6E2D8] pt-2.5">
                      <div>
                        <span className="text-[#66707D] block text-[11px]">Fondo fijo inicial</span>
                        <span className="font-semibold">{formatCup(reg.opening_cash_cup)}</span>
                      </div>
                      <div>
                        <span className="text-[#66707D] block text-[11px]">Ventas Efectivo</span>
                        <span className="font-semibold">{formatCup(reg.cash_sales_cup)}</span>
                      </div>
                      <div>
                        <span className="text-[#66707D] block text-[11px]">Transfermóvil QR</span>
                        <span className="font-semibold">{formatCup(reg.transfermovil_sales_cup)}</span>
                      </div>
                      <div>
                        <span className="text-[#66707D] block text-[11px]">EnZona QR</span>
                        <span className="font-semibold">{formatCup(reg.enzona_sales_cup)}</span>
                      </div>
                    </div>

                    <div className="border-t border-[#E6E2D8] pt-2.5 flex items-center justify-between text-xs tabular-nums">
                      <div>
                        <span className="text-[#66707D]">Efectivo esperado en caja: </span>
                        <strong className="text-[#171C22]">{formatCup(reg.expected_cash_cup)}</strong>
                        {reg.counted_cash_cup !== null && (
                          <p className="text-[11px] mt-0.5">
                            Contado: <strong>{formatCup(reg.counted_cash_cup)}</strong> · Dif:{' '}
                            <strong
                              className={
                                reg.cash_difference_cup < -0.5
                                  ? 'text-red-700'
                                  : reg.cash_difference_cup > 0.5
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                              }
                            >
                              {formatCup(reg.cash_difference_cup)}
                            </strong>
                          </p>
                        )}
                      </div>
                      {canCloseThis && (
                        <button
                          type="button"
                          onClick={() => startCloseRegister(reg)}
                          className="btn-primary text-xs py-1.5 px-3 no-print"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Arquear y Cerrar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Official Cuban IPV Table */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#ECE8DE] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[#171C22]">
                  IPV — Informe de Producto a la Venta (Automatizado)
                </h3>
                <p className="text-xs text-[#66707D]">
                  Fórmula oficial de control interno: Inicio + Entradas (SC-2-09) − Mermas (SC-2-16) − Final = Vendido
                </p>
              </div>
              <span className="text-xs font-bold text-[#0F5C4D] tabular-nums">
                Importe bruto IPV: {formatCup(viewedBundle.totals.ipv_sold_amount_cup)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Producto</th>
                    <th className="px-3 py-2.5 text-center font-semibold">UM</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Inicio</th>
                    <th className="px-3 py-2.5 text-right font-semibold">+ Entradas</th>
                    <th className="px-3 py-2.5 text-right font-semibold">− Bajas</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Vendido</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Final</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Precio CUP</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Importe CUP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
                  {viewedBundle.ipv.map((row) => (
                    <tr key={row.id} className="hover:bg-[#FAF9F5]">
                      <td className="px-4 py-2 font-medium text-[#171C22]">
                        {row.product_name}
                        {row.is_price_capped ? (
                          <span className="ml-1.5 rounded bg-amber-50 border border-amber-200 px-1 py-0.2 text-[10px] text-amber-800">
                            Topado
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-center text-[#66707D]">{row.unit}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(row.opening_qty)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">
                        {row.entries_qty > 0 ? `+${formatNumber(row.entries_qty)}` : '0'}
                      </td>
                      <td className="px-3 py-2 text-right text-red-700">
                        {row.losses_qty > 0 ? `-${formatNumber(row.losses_qty)}` : '0'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-[#171C22]">
                        {formatNumber(row.sold_qty)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${
                          row.closing_qty <= row.kiosk_min_stock ? 'text-amber-700' : 'text-[#3C4450]'
                        }`}
                      >
                        {formatNumber(row.closing_qty)}
                      </td>
                      <td className="px-3 py-2 text-right">{formatCup(row.sale_price_cup, 0)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-[#0F5C4D]">
                        {formatCup(row.sold_amount_cup)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Shift Sales Log */}
          <div className="card overflow-hidden no-print">
            <div className="px-5 py-3 border-b border-[#ECE8DE]">
              <h3 className="text-sm font-bold text-[#171C22]">
                Comprobantes emitidos en el turno ({viewedBundle.sales.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
                  <tr>
                    <th className="px-4 py-2 text-left">Ticket</th>
                    <th className="px-3 py-2 text-left">Caja / Vendedor</th>
                    <th className="px-3 py-2 text-left">Pago</th>
                    <th className="px-3 py-2 text-left">Ref. QR</th>
                    <th className="px-4 py-2 text-right">Total CUP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
                  {viewedBundle.sales.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2 font-mono font-semibold">{s.receipt_number}</td>
                      <td className="px-3 py-2">
                        Caja {s.register_number} — {s.seller_name}
                      </td>
                      <td className="px-3 py-2">{s.payment_method}</td>
                      <td className="px-3 py-2 font-mono text-[#66707D]">{s.electronic_ref || '—'}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatCup(s.total_cup)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Open Register Modal */}
      <Modal
        open={openModal}
        onClose={() => setOpenModal(false)}
        title={activeRes.active ? 'Incorporar Vendedor al Turno Activo' : 'Abrir Nuevo Turno de Kiosko'}
        subtitle="Máximo 2 vendedores simultáneos por turno (Caja 1 y Caja 2)"
      >
        <form onSubmit={handleOpenRegister} className="space-y-3.5 text-xs">
          {!activeRes.active && (
            <div>
              <label className="block font-medium mb-1">Turno a abrir</label>
              <select
                className="input-field"
                value={openForm.shift_template_id}
                onChange={(e) => setOpenForm({ ...openForm, shift_template_id: Number(e.target.value) })}
              >
                {activeRes.shift_templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.start_time}–{t.end_time})
                  </option>
                ))}
              </select>
            </div>
          )}

          {user.role === 'jefe' && (
            <div>
              <label className="block font-medium mb-1">Vendedor responsable de la caja</label>
              <select
                className="input-field"
                value={openForm.seller_id}
                onChange={(e) => setOpenForm({ ...openForm, seller_id: Number(e.target.value) })}
              >
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({s.shift_name} · Caja {s.default_register})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Número de caja</label>
              <select
                className="input-field"
                value={openForm.register_number}
                onChange={(e) => setOpenForm({ ...openForm, register_number: Number(e.target.value) })}
              >
                <option value={1}>Caja 1</option>
                <option value={2}>Caja 2</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Fondo fijo para cambio (CUP)</label>
              <input
                type="number"
                min="0"
                step="100"
                className="input-field tabular-nums"
                value={openForm.opening_cash_cup}
                onChange={(e) => setOpenForm({ ...openForm, opening_cash_cup: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenModal(false)} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Habilitar caja e IPV
            </button>
          </div>
        </form>
      </Modal>

      {/* Cash Denomination Arqueo Modal */}
      <Modal
        open={Boolean(closingReg)}
        onClose={() => setClosingReg(null)}
        title={`Arqueo de Caja ${closingReg?.register_number || ''} — Billetes CUP`}
        subtitle={`Responsable: ${closingReg?.seller_name || ''} · Al cerrar ambas cajas se genera la orden de depósito BCC`}
      >
        {closingReg && (
          <form onSubmit={handleCloseRegister} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(activeRes.denominations || [1000, 500, 200, 100, 50, 20, 10, 5, 3, 1]).map((bill) => (
                <div key={bill} className="rounded-lg border border-[#E3DFD5] bg-[#FAF9F5] p-2">
                  <label className="block text-[11px] font-bold text-[#171C22] mb-1 tabular-nums">
                    ${bill} CUP
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="input-field py-1 px-2 text-xs tabular-nums"
                    value={denoms[bill] ?? ''}
                    placeholder="0"
                    onChange={(e) => setDenoms({ ...denoms, [bill]: e.target.value })}
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="font-medium text-[#3C4450]">Fracción / monedas (CUP):</label>
              <input
                type="number"
                min="0"
                step="0.05"
                className="input-field w-32 py-1 text-right tabular-nums"
                value={denoms.monedas ?? ''}
                placeholder="0.00"
                onChange={(e) => setDenoms({ ...denoms, monedas: e.target.value })}
              />
            </div>

            <div className="rounded-xl border border-[#DFDBD0] bg-[#FAF9F5] p-3.5 space-y-1.5 tabular-nums">
              <div className="flex justify-between">
                <span className="text-[#525B68]">Efectivo esperado según sistema:</span>
                <span className="font-bold">{formatCup(closingReg.expected_cash_cup)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#525B68]">Efectivo físico contado:</span>
                <span className="font-bold text-[#0F5C4D]">{formatCup(countedTotal)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-[#E3DFD5] text-sm font-bold">
                <span>Diferencia de arqueo:</span>
                <span
                  className={
                    countedTotal - closingReg.expected_cash_cup < -0.5
                      ? 'text-red-700'
                      : countedTotal - closingReg.expected_cash_cup > 0.5
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                  }
                >
                  {formatCup(countedTotal - closingReg.expected_cash_cup)}
                </span>
              </div>
              {countedTotal - closingReg.expected_cash_cup < -0.5 && (
                <p className="text-[11px] text-red-700 pt-1">
                  El faltante se contabilizará automáticamente en la Cuenta 330 (Responsabilidad Material — Ley 116).
                </p>
              )}
            </div>

            <div>
              <label className="block font-medium mb-1">Observaciones del acta de entrega</label>
              <input
                className="input-field text-xs"
                placeholder="Ej. Entrega conforme al relevo de turno"
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setClosingReg(null)} className="btn-secondary text-xs">
                Cancelar
              </button>
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                <Calculator className="h-3.5 w-3.5" />
                Confirmar arqueo y cerrar caja
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

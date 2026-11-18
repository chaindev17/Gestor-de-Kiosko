import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  Banknote,
  CheckCircle2,
  Landmark,
  Plus,
  QrCode,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatCup, formatDate } from '../lib/format.js';
import StatCard from '../components/StatCard.jsx';
import Modal from '../components/Modal.jsx';

export default function FinanceDashboard({ onRefreshBadges, notify }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const [voucherModal, setVoucherModal] = useState(null);
  const [voucherRef, setVoucherRef] = useState('');

  const [expModal, setExpModal] = useState(false);
  const [expForm, setExpForm] = useState({
    category: 'Electricidad (UNE)',
    description: '',
    provider_name: '',
    invoice_ref: '',
    has_valid_receipt: true,
    amount_cup: '',
    payment_method: 'TRANSFERENCIA',
    payment_ref: '',
  });

  const [depModal, setDepModal] = useState(false);
  const [depForm, setDepForm] = useState({ amount_cup: '', bank_voucher_ref: '', notes: '' });

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/finance/banking');
      setData(res);
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function reconcileAllQr() {
    setBusy(true);
    try {
      const r = await api.post('/api/finance/reconcile-qr', {});
      notify(
        `${r.count} cobro(s) Transfermóvil/EnZona conciliados (${formatCup(r.total_cup)}) en Cuenta Fiscal — ${r.journal_entry}.`
      );
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeposit(e) {
    e.preventDefault();
    if (!voucherModal) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/finance/deposits/${voucherModal.id}/complete`, {
        bank_voucher_ref: voucherRef,
      });
      notify(`Depósito ${voucherModal.order_number} acreditado en Cuenta Fiscal (${r.journal_entry}).`);
      setVoucherModal(null);
      setVoucherRef('');
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitExpense(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/finance/expenses', expForm);
      notify(`Gasto ${r.doc_number} registrado y contabilizado automáticamente.`);
      setExpModal(false);
      setExpForm({
        category: 'Electricidad (UNE)',
        description: '',
        provider_name: '',
        invoice_ref: '',
        has_valid_receipt: true,
        amount_cup: '',
        payment_method: 'TRANSFERENCIA',
        payment_ref: '',
      });
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitManualDeposit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/finance/deposits', depForm);
      notify(`Depósito ${r.order_number} registrado.`);
      setDepModal(false);
      setDepForm({ amount_cup: '', bank_voucher_ref: '', notes: '' });
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="py-12 text-center text-sm text-[#66707D]">Cargando tesorería y bancarización...</div>;
  }

  const { balances, config, deposits, unreconciled_qr, expenses } = data;
  const cashLimit = Number(config.max_cash_provider_payment_cup || 5000);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#171C22]">
            Bancarización (BCC), Tesorería y Gastos
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            Resolución 111/2023 del Banco Central de Cuba · Cuenta Bancaria Fiscal {config.fiscal_account_cup} ({config.bank_name})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDepModal(true)} className="btn-secondary text-xs">
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Depósito bancario
          </button>
          <button type="button" onClick={() => setExpModal(true)} className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" />
            Registrar gasto
          </button>
        </div>
      </div>

      {/* Balances */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Cuenta Fiscal CUP (110)"
          value={formatCup(balances.bank_fiscal_cup)}
          hint={config.bank_name}
          icon={Landmark}
          tone="navy"
        />
        <StatCard
          label="Efectivo Caja General (101)"
          value={formatCup(balances.cash_general_cup)}
          hint={`Tope antes de depósito: ${formatCup(config.max_vault_cash_before_deposit_cup, 0)}`}
          icon={Banknote}
          tone={balances.cash_general_cup > config.max_vault_cash_before_deposit_cup ? 'amber' : 'brand'}
        />
        <StatCard
          label="Cobros QR por Conciliar (135)"
          value={formatCup(balances.qr_pending_cup)}
          hint={`${unreconciled_qr.length} operación(es) Transfermóvil / EnZona`}
          icon={QrCode}
          tone={unreconciled_qr.length > 0 ? 'amber' : 'default'}
        />
        <StatCard
          label="Faltantes Investig. (330)"
          value={formatCup(balances.faltantes_cup)}
          hint={`Fondo fijo cajas (102): ${formatCup(balances.cash_petty_cup, 0)}`}
          icon={ShieldAlert}
          tone={balances.faltantes_cup > 0 ? 'red' : 'default'}
        />
      </div>

      {/* Deposits + QR Reconciliation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="card p-5 lg:col-span-6 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-[#171C22]">
              Órdenes de Depósito Bancario (Res. 111/2023 BCC)
            </h2>
            <p className="text-xs text-[#66707D]">
              Se generan automáticamente al cerrar turno con el efectivo recaudado para depositar el próximo día hábil.
            </p>
          </div>
          <div className="space-y-2.5 text-xs">
            {deposits.map((d) => (
              <div
                key={d.id}
                className={`rounded-lg border p-3.5 flex flex-wrap items-center justify-between gap-2 ${
                  d.status === 'PENDIENTE'
                    ? 'border-amber-200 bg-amber-50/50'
                    : 'border-[#E3DFD5] bg-[#FAF9F5]'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-[#171C22]">{d.order_number}</span>
                    <span className="rounded bg-white border border-[#E3DFD5] px-1.5 py-0.2 text-[10px] font-semibold">
                      {d.origin}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                        d.status === 'DEPOSITADO'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {d.status}
                    </span>
                  </div>
                  <p className="font-bold text-sm text-[#171C22] tabular-nums">{formatCup(d.amount_cup)}</p>
                  <p className="text-[11px] text-[#58616E]">
                    Fecha límite: {formatDate(d.due_date)}
                    {d.bank_voucher_ref ? ` · Comprobante: ${d.bank_voucher_ref}` : ''}
                  </p>
                </div>
                {d.status === 'PENDIENTE' && (
                  <button
                    type="button"
                    onClick={() => {
                      setVoucherModal(d);
                      setVoucherRef('');
                    }}
                    className="btn-primary text-[11px] py-1.5 px-2.5"
                  >
                    Confirmar voucher
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5 lg:col-span-6 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#171C22]">
                Conciliación Electrónica Transfermóvil y EnZona
              </h2>
              <p className="text-xs text-[#66707D]">
                Acredita los cobros QR verificados en el estado de cuenta de la Cuenta Bancaria Fiscal (Cta. 110).
              </p>
            </div>
            {unreconciled_qr.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={reconcileAllQr}
                className="btn-primary text-xs shrink-0"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Conciliar ({unreconciled_qr.length})
              </button>
            )}
          </div>

          {unreconciled_qr.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-900 text-center">
              Todos los pagos por Transfermóvil y EnZona están conciliados con el banco.
            </div>
          ) : (
            <div className="divide-y divide-[#EFECE4] text-xs tabular-nums">
              {unreconciled_qr.map((q) => {
                const amt = q.transfermovil_amount_cup + q.enzona_amount_cup;
                return (
                  <div key={q.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[#171C22]">
                        {q.receipt_number} · {q.transfermovil_amount_cup > 0 ? 'Transfermóvil' : 'EnZona'}
                      </p>
                      <p className="text-[11px] text-[#66707D]">
                        Ref. <span className="font-mono font-semibold">{q.electronic_ref}</span> · Caja{' '}
                        {q.register_number} ({q.seller_name})
                      </p>
                    </div>
                    <span className="font-bold text-[#1E3A5F]">{formatCup(amt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Operating Expenses Table */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#ECE8DE]">
          <h2 className="text-sm font-bold text-[#171C22]">
            Registro de Gastos Operativos (Control de Justificantes ONAT)
          </h2>
          <p className="text-xs text-[#66707D]">
            Solo los gastos respaldados documentalmente se deducen al 100% en el cálculo de Utilidades / DJ-08.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
              <tr>
                <th className="px-4 py-2.5 text-left">Doc.</th>
                <th className="px-3 py-2.5 text-left">Fecha</th>
                <th className="px-3 py-2.5 text-left">Concepto / Proveedor</th>
                <th className="px-3 py-2.5 text-left">Pago</th>
                <th className="px-3 py-2.5 text-center">Deducible ONAT</th>
                <th className="px-4 py-2.5 text-right">Importe CUP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
              {expenses.map((ex) => (
                <tr key={ex.id}>
                  <td className="px-4 py-2 font-mono font-semibold">{ex.doc_number}</td>
                  <td className="px-3 py-2">{formatDate(ex.expense_date)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-[#171C22]">
                      {ex.category} — {ex.description}
                    </p>
                    <p className="text-[11px] text-[#66707D]">
                      {ex.provider_name} {ex.invoice_ref ? `(${ex.invoice_ref})` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    {ex.payment_method}
                    {ex.payment_ref ? <span className="block font-mono text-[10px] text-[#66707D]">{ex.payment_ref}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        ex.has_valid_receipt
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-amber-50 text-amber-800'
                      }`}
                    >
                      {ex.has_valid_receipt ? 'Con factura' : 'Sin justificante'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">{formatCup(ex.amount_cup)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Confirm Bank Deposit Modal */}
      <Modal
        open={Boolean(voucherModal)}
        onClose={() => setVoucherModal(null)}
        title={`Confirmar Depósito ${voucherModal?.order_number || ''}`}
        subtitle={`Importe: ${formatCup(voucherModal?.amount_cup || 0)} en ${config.bank_name}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={confirmDeposit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium mb-1">Nro. de comprobante bancario *</label>
            <input
              className="input-field font-mono"
              placeholder="Ej. BM-DEP-20261118-04"
              value={voucherRef}
              onChange={(e) => setVoucherRef(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setVoucherModal(null)} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Contabilizar depósito (110 vs 101)
            </button>
          </div>
        </form>
      </Modal>

      {/* Manual Deposit Modal */}
      <Modal
        open={depModal}
        onClose={() => setDepModal(false)}
        title="Registrar Depósito de Efectivo a Cuenta Fiscal"
        subtitle="Acredita efectivo de Caja General en la Cuenta Bancaria Fiscal CUP"
        maxWidth="max-w-md"
      >
        <form onSubmit={submitManualDeposit} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium mb-1">Importe a depositar (CUP)</label>
            <input
              type="number"
              min="1"
              className="input-field tabular-nums"
              value={depForm.amount_cup}
              onChange={(e) => setDepForm({ ...depForm, amount_cup: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block font-medium mb-1">
              Comprobante de banco (deje vacío para crear orden pendiente)
            </label>
            <input
              className="input-field font-mono"
              placeholder="BM-DEP-88412"
              value={depForm.bank_voucher_ref}
              onChange={(e) => setDepForm({ ...depForm, bank_voucher_ref: e.target.value })}
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Concepto</label>
            <input
              className="input-field"
              placeholder="Depósito recaudación de ventas"
              value={depForm.notes}
              onChange={(e) => setDepForm({ ...depForm, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setDepModal(false)} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Guardar
            </button>
          </div>
        </form>
      </Modal>

      {/* New Expense Modal */}
      <Modal
        open={expModal}
        onClose={() => setExpModal(false)}
        title="Registrar Gasto Operativo"
        subtitle={`Bloqueo automático en efectivo sobre ${formatCup(cashLimit, 0)} (Res. 111/2023 BCC)`}
      >
        <form onSubmit={submitExpense} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Categoría de gasto</label>
              <select
                className="input-field"
                value={expForm.category}
                onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}
              >
                <option>Electricidad (UNE)</option>
                <option>Arrendamiento Local</option>
                <option>Transporte y Acarreo</option>
                <option>Envases y Jabas</option>
                <option>Comunicaciones (ETECSA)</option>
                <option>Agua y Comunales</option>
                <option>Mantenimiento e Higiene</option>
                <option>Servicios Bancarios</option>
                <option>Otros Gastos</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Importe (CUP) *</label>
              <input
                type="number"
                min="1"
                step="0.5"
                className="input-field tabular-nums"
                value={expForm.amount_cup}
                onChange={(e) => setExpForm({ ...expForm, amount_cup: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Proveedor / Entidad *</label>
              <input
                className="input-field"
                placeholder="Ej. ETECSA, UNE, Transportista TCP"
                value={expForm.provider_name}
                onChange={(e) => setExpForm({ ...expForm, provider_name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Nro. Factura / Recibo</label>
              <input
                className="input-field font-mono"
                placeholder="FAC-00412"
                value={expForm.invoice_ref}
                onChange={(e) => setExpForm({ ...expForm, invoice_ref: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1">Descripción *</label>
            <input
              className="input-field"
              placeholder="Detalle del servicio o insumo adquirido"
              value={expForm.description}
              onChange={(e) => setExpForm({ ...expForm, description: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Medio de pago</label>
              <select
                className="input-field"
                value={expForm.payment_method}
                onChange={(e) => setExpForm({ ...expForm, payment_method: e.target.value })}
              >
                <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                <option value="TRANSFERMOVIL">Transfermóvil</option>
                <option value="ENZONA">EnZona</option>
                <option value="EFECTIVO">Efectivo CUP (≤ {cashLimit} CUP)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Referencia electrónica</label>
              <input
                className="input-field font-mono"
                placeholder={expForm.payment_method === 'EFECTIVO' ? 'No requerida' : 'Nro. operación *'}
                value={expForm.payment_ref}
                onChange={(e) => setExpForm({ ...expForm, payment_ref: e.target.value })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={expForm.has_valid_receipt}
              onChange={(e) => setExpForm({ ...expForm, has_valid_receipt: e.target.checked })}
            />
            Cuenta con comprobante fiscal válido (deducible ante la ONAT — Ley 113)
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setExpModal(false)} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Registrar y contabilizar
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

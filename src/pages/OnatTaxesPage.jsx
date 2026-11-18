import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Download, Printer, Receipt, Shield } from 'lucide-react';
import { api } from '../lib/api.js';
import { downloadCsv, formatCup, formatDate } from '../lib/format.js';
import StatCard from '../components/StatCard.jsx';
import Modal from '../components/Modal.jsx';

export default function OnatTaxesPage({ onRefreshBadges, notify }) {
  const [period, setPeriod] = useState('');
  const [data, setData] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [payRef, setPayRef] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (targetPeriod = period) => {
      try {
        const q = targetPeriod ? `?period=${encodeURIComponent(targetPeriod)}` : '';
        const res = await api.get(`/api/finance/onat${q}`);
        setData(res);
        if (!targetPeriod) setPeriod(res.period);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify, period]
  );

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmPay(e) {
    e.preventDefault();
    if (!payModal) return;
    setBusy(true);
    try {
      const r = await api.post('/api/finance/onat/pay', {
        period: data.period,
        tax_code: payModal.tax_code,
        payment_ref: payRef,
      });
      notify(`Tributo ONAT pagado (${formatCup(r.amount_cup)}) y contabilizado (${r.journal_entry}).`);
      setPayModal(null);
      setPayRef('');
      await load(data.period);
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!data) return;
    downloadCsv(
      `Liquidacion-ONAT-${data.period}.csv`,
      ['Párrafo ONAT', 'Tributo', 'Base Imponible CUP', 'Tipo %', 'Importe CUP', 'Vencimiento', 'Estado', 'Ref. Pago'],
      data.obligations.map((o) => [
        o.onat_paragraph,
        o.tax_name,
        o.taxable_base_cup,
        o.rate_pct,
        o.amount_cup,
        o.due_date,
        o.status,
        o.payment_ref,
      ])
    );
  }

  if (!data) {
    return <div className="py-12 text-center text-sm text-[#66707D]">Calculando liquidación ONAT...</div>;
  }

  const inc = data.income_statement;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#171C22]">
            Liquidación Tributaria Automatizada — ONAT
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            Ley 113 del Sistema Tributario ·{' '}
            {data.legal_form === 'MIPYME' ? 'Régimen MIPYME (DL 88/2024)' : 'Régimen General TCP (DL 90/2024)'} · NIT{' '}
            {data.business.nit} ({data.business.municipality})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input-field text-xs py-1.5 w-auto"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              load(e.target.value);
            }}
          >
            {data.available_periods.map((p) => (
              <option key={p} value={p}>
                Período {p}
              </option>
            ))}
          </select>
          <button type="button" onClick={exportCsv} className="btn-secondary text-xs">
            <Download className="h-3.5 w-3.5" />
            Exportar RC-04A
          </button>
          <button type="button" onClick={() => window.print()} className="btn-primary text-xs">
            <Printer className="h-3.5 w-3.5" />
            Imprimir Liquidación
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Ingresos Brutos Mes"
          value={formatCup(inc.gross_sales_cup)}
          hint={`${inc.sales_count} ventas · ${inc.electronic_share_pct}% vía QR electrónica`}
          icon={Receipt}
          tone="brand"
        />
        <StatCard
          label="Total Tributos ONAT"
          value={formatCup(data.totals.total_onat_cup)}
          hint={`Pagado: ${formatCup(data.totals.total_paid_cup, 0)} · Pendiente: ${formatCup(data.totals.total_pending_cup, 0)}`}
          icon={Calendar}
          tone="amber"
        />
        <StatCard
          label="Vencimiento Pago ONAT"
          value={formatDate(data.due_date)}
          hint="Hasta el día 20 del mes siguiente (evita recargo por mora)"
          icon={Calendar}
          tone="navy"
        />
        <StatCard
          label="Reserva Legal DL 88"
          value={formatCup(data.business.legal_reserve_balance_cup)}
          hint={`Provisión mes: +${formatCup(inc.legal_reserve_provision_cup)} (tope 20% capital)`}
          icon={Shield}
          tone="default"
        />
      </div>

      {/* ONAT Paragraphs Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#ECE8DE] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#171C22]">
              Desglose por Párrafos Tributarios ONAT — Período {data.period}
            </h2>
            <p className="text-xs text-[#66707D]">
              Calculado automáticamente a partir de ventas POS, gastos con justificante y nómina ({data.payroll_source})
            </p>
          </div>
          <span className="text-xs text-[#525B68]">
            Cuenta Fiscal de pago: <strong className="font-mono">{data.business.fiscal_account_cup}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Párrafo</th>
                <th className="px-3 py-2.5 text-left font-semibold">Tributo / Norma Legal</th>
                <th className="px-3 py-2.5 text-right font-semibold">Base Imponible</th>
                <th className="px-3 py-2.5 text-right font-semibold">Tipo</th>
                <th className="px-3 py-2.5 text-right font-semibold">A Pagar (CUP)</th>
                <th className="px-3 py-2.5 text-center font-semibold">Estado</th>
                <th className="px-4 py-2.5 text-right font-semibold no-print">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
              {data.obligations.map((ob) => (
                <tr key={ob.tax_code} className="hover:bg-[#FAF9F5]">
                  <td className="px-4 py-3 font-mono font-bold text-[#1E3A5F]">{ob.onat_paragraph}</td>
                  <td className="px-3 py-3">
                    <p className="font-semibold text-[#171C22]">{ob.tax_name}</p>
                    <p className="text-[11px] text-[#66707D]">
                      {ob.law_ref} · {ob.frequency}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right">{formatCup(ob.taxable_base_cup)}</td>
                  <td className="px-3 py-3 text-right">{ob.rate_pct}%</td>
                  <td className="px-3 py-3 text-right font-bold text-[#171C22]">
                    {formatCup(ob.amount_cup)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {ob.status === 'PAGADO' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        <CheckCircle2 className="h-3 w-3" /> PAGADO ({ob.payment_ref})
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#F2F0E9] px-2 py-0.5 text-[10px] font-semibold text-[#4C5561]">
                        {ob.amount_cup > 0 ? `Vence ${formatDate(ob.due_date)}` : 'Sin cuota'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right no-print">
                    {ob.status !== 'PAGADO' && ob.amount_cup > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPayModal(ob);
                          setPayRef('');
                        }}
                        className="btn-secondary text-[11px] py-1 px-2.5"
                      >
                        Registrar pago
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fiscal Determination Summary */}
      <div className="card p-5 max-w-2xl space-y-2 text-xs tabular-nums">
        <h3 className="text-sm font-bold text-[#171C22] mb-2">
          Determinación Automática de la Utilidad Fiscal ({data.period})
        </h3>
        <div className="flex justify-between py-1 border-b border-[#F2F0E9]">
          <span>(+) Ingresos netos por ventas minoristas</span>
          <strong className="text-[#171C22]">{formatCup(inc.gross_sales_cup)}</strong>
        </div>
        <div className="flex justify-between py-1 border-b border-[#F2F0E9] text-[#525B68]">
          <span>(−) Costo de mercancías vendidas (Cta. 810)</span>
          <span>−{formatCup(inc.cogs_cup)}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#F2F0E9] text-[#525B68]">
          <span>(−) Gastos operativos con justificante + mermas aprobadas</span>
          <span>−{formatCup(inc.deductible_expenses_cup + inc.mermas_cup)}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#F2F0E9] text-[#525B68]">
          <span>(−) Gasto de salarios + 9.09% vacaciones acumuladas</span>
          <span>−{formatCup(inc.payroll_gross_cup + inc.payroll_vacation_cup)}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#F2F0E9] text-[#525B68]">
          <span>(−) Tributos deducibles (Ventas 10% + CTDL 1% + IUFT 5% + SS 14%)</span>
          <span>−{formatCup(inc.deductible_taxes_cup)}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[#F2F0E9] font-semibold">
          <span>(=) Utilidad antes de Reserva e Impuesto sobre Utilidades</span>
          <span>{formatCup(inc.profit_before_tax_cup)}</span>
        </div>
        {data.legal_form === 'MIPYME' && (
          <div className="flex justify-between py-1 border-b border-[#F2F0E9] text-[#525B68]">
            <span>(−) Reserva para Pérdidas y Contingencias (10% — DL 88/2024)</span>
            <span>−{formatCup(inc.legal_reserve_provision_cup)}</span>
          </div>
        )}
        <div className="flex justify-between py-1 border-b border-[#F2F0E9] text-[#525B68]">
          <span>(−) Provisión Impuesto sobre Utilidades / Ingresos</span>
          <span>−{formatCup(inc.profit_tax_provision_cup)}</span>
        </div>
        <div className="flex justify-between pt-2 text-sm font-bold text-[#0F5C4D]">
          <span>(=) Resultado Neto del Período</span>
          <span>{formatCup(inc.net_profit_cup)}</span>
        </div>
      </div>

      {/* Pay Tax Modal */}
      <Modal
        open={Boolean(payModal)}
        onClose={() => setPayModal(null)}
        title="Registrar Pago Electrónico a la ONAT"
        subtitle={payModal ? `Párrafo ${payModal.onat_paragraph} — ${payModal.tax_name}` : ''}
        maxWidth="max-w-md"
      >
        {payModal && (
          <form onSubmit={confirmPay} className="space-y-3.5 text-xs">
            <div className="rounded-lg bg-[#FAF9F5] border border-[#E3DFD5] p-3 space-y-1 tabular-nums">
              <div className="flex justify-between">
                <span>Período tributario:</span>
                <strong>{data.period}</strong>
              </div>
              <div className="flex justify-between">
                <span>Importe a debitar de Cuenta Fiscal:</span>
                <strong className="text-[#0F5C4D] text-sm">{formatCup(payModal.amount_cup)}</strong>
              </div>
            </div>
            <div>
              <label className="block font-medium mb-1">
                Nro. comprobante RC-04A / Transfermóvil (bonif. ONAT) *
              </label>
              <input
                className="input-field font-mono"
                placeholder="Ej. ONAT-TM-202611-4821"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPayModal(null)} className="btn-secondary text-xs">
                Cancelar
              </button>
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                Confirmar pago y asiento NCIF
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

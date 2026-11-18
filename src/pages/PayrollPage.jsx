import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Printer, Send, Users, Wallet } from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META, downloadCsv, formatCup } from '../lib/format.js';
import StatCard from '../components/StatCard.jsx';
import Modal from '../components/Modal.jsx';

export default function PayrollPage({ onRefreshBadges, notify }) {
  const [data, setData] = useState(null);
  const [payModal, setPayModal] = useState(false);
  const [payRef, setPayRef] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/finance/payroll');
      setData(res);
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function executePayroll(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/finance/payroll/generate', {
        period: data.period,
        pay_now: true,
        payment_ref: payRef,
      });
      notify(`Nómina ${data.period} pagada por banco y contabilizada automáticamente (${r.journal_entry}).`);
      setPayModal(false);
      setPayRef('');
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="py-12 text-center text-sm text-[#66707D]">Calculando nómina laboral...</div>;
  }

  const activeList = data.saved_run ? data.saved_run.items : data.live_preview.items;
  const totals = data.saved_run || data.live_preview.totals;
  const isPaid = data.saved_run?.status === 'PAGADA';

  function exportCsv() {
    downloadCsv(
      `Nomina-${data.period}.csv`,
      [
        'Trabajador',
        'CI',
        'Cargo',
        'Básico CUP',
        'Estímulo Ventas CUP',
        'Devengado CUP',
        'Ret. SS 5% CUP',
        'Ret. IIP CUP',
        'Neto a Pagar CUP',
        'Vacaciones 9.09% CUP',
        'SS Entidad 14% CUP',
        'IUFT 5% CUP',
      ],
      activeList.map((i) => [
        i.full_name,
        i.ci,
        ROLE_META[i.role]?.label || i.role,
        i.base_salary_cup,
        i.commission_cup,
        i.gross_salary_cup,
        i.worker_ss_cup,
        i.worker_iip_cup,
        i.net_salary_cup,
        i.vacation_accrual_cup,
        i.employer_ss_cup,
        i.labor_tax_cup,
      ])
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#171C22]">
            Nómina Automatizada y Retenciones ({data.period})
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            Ley 116 (Código de Trabajo) + Ley 113 ONAT: Vacaciones {data.rules.vacation_provision_pct}% · Retención SS{' '}
            {data.rules.worker_ss_pct}% · IIP progresivo (exento hasta {formatCup(data.rules.iip_exempt_monthly_cup, 0)}) ·
            Aporte entidad {data.rules.employer_ss_pct}% SS + {data.rules.labor_force_tax_pct}% Fuerza de Trabajo
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={exportCsv} className="btn-secondary text-xs">
            <Download className="h-3.5 w-3.5" />
            CSV Nómina
          </button>
          <button type="button" onClick={() => window.print()} className="btn-secondary text-xs">
            <Printer className="h-3.5 w-3.5" />
            Imprimir
          </button>
          {!isPaid ? (
            <button type="button" onClick={() => setPayModal(true)} className="btn-primary text-xs">
              <Send className="h-3.5 w-3.5" />
              Aprobar y Pagar Nómina
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              Pagada ({data.saved_run.payment_ref})
            </span>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Devengado Bruto"
          value={formatCup(totals.total_gross_cup)}
          hint={`${activeList.length} trabajadores (incluye estímulo por ventas POS)`}
          icon={Users}
          tone="brand"
        />
        <StatCard
          label="Neto a Transferir"
          value={formatCup(totals.total_net_cup)}
          hint="Descontadas retenciones SS (5%) e Ingresos Personales"
          icon={Wallet}
          tone="navy"
        />
        <StatCard
          label="Retenciones ONAT (445)"
          value={formatCup(totals.total_worker_ss_cup + totals.total_worker_iip_cup)}
          hint={`SS: ${formatCup(totals.total_worker_ss_cup, 0)} · IIP: ${formatCup(totals.total_worker_iip_cup, 0)}`}
          tone="amber"
        />
        <StatCard
          label="Cargas Patronales + Vac."
          value={formatCup(
            totals.total_employer_ss_cup + totals.total_labor_tax_cup + totals.total_vacation_accrual_cup
          )}
          hint={`SS 14%: ${formatCup(totals.total_employer_ss_cup, 0)} · IUFT 5%: ${formatCup(totals.total_labor_tax_cup, 0)} · Vac 9.09%`}
          tone="default"
        />
      </div>

      {/* Payroll Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Trabajador / Cargo</th>
                <th className="px-3 py-2.5 text-right font-semibold">Básico</th>
                <th className="px-3 py-2.5 text-right font-semibold">Estímulo</th>
                <th className="px-3 py-2.5 text-right font-semibold">Devengado</th>
                <th className="px-3 py-2.5 text-right font-semibold">− SS (5%)</th>
                <th className="px-3 py-2.5 text-right font-semibold">− IIP</th>
                <th className="px-3 py-2.5 text-right font-semibold">Neto a Cobrar</th>
                <th className="px-3 py-2.5 text-right font-semibold">Vac. 9.09%</th>
                <th className="px-4 py-2.5 text-right font-semibold">SS 14% + IUFT 5%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
              {activeList.map((it) => (
                <tr key={it.user_id} className="hover:bg-[#FAF9F5]">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-[#171C22]">{it.full_name}</p>
                    <p className="text-[11px] text-[#66707D]">
                      {ROLE_META[it.role]?.short || it.role} · CI {it.ci}
                      {it.role === 'vendedor' ? ` · ${it.shifts_worked} turno(s)` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right">{formatCup(it.base_salary_cup)}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700">
                    {it.commission_cup > 0 ? `+${formatCup(it.commission_cup)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold">{formatCup(it.gross_salary_cup)}</td>
                  <td className="px-3 py-2.5 text-right text-red-700">−{formatCup(it.worker_ss_cup)}</td>
                  <td className="px-3 py-2.5 text-right text-red-700">−{formatCup(it.worker_iip_cup)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-[#0F5C4D]">
                    {formatCup(it.net_salary_cup)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#525B68]">
                    {formatCup(it.vacation_accrual_cup)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[#525B68]">
                    {formatCup(it.employer_ss_cup + it.labor_tax_cup)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pay Modal */}
      <Modal
        open={payModal}
        onClose={() => setPayModal(false)}
        title={`Pagar y Contabilizar Nómina (${data.period})`}
        subtitle="Emite asiento NCIF automático de salarios, provisión 9.09% vacaciones, retenciones ONAT y aportes patronales"
        maxWidth="max-w-md"
      >
        <form onSubmit={executePayroll} className="space-y-3.5 text-xs">
          <div className="rounded-lg bg-[#FAF9F5] border border-[#E3DFD5] p-3 space-y-1 tabular-nums">
            <div className="flex justify-between">
              <span>Neto a debitar en Cuenta Fiscal (110):</span>
              <strong className="text-[#0F5C4D] text-sm">{formatCup(totals.total_net_cup)}</strong>
            </div>
            <div className="flex justify-between text-[#525B68]">
              <span>Retenciones por pagar a ONAT (445):</span>
              <span>{formatCup(totals.total_worker_ss_cup + totals.total_worker_iip_cup)}</span>
            </div>
            <div className="flex justify-between text-[#525B68]">
              <span>Seg. Social (492) + Fuerza Trabajo (440):</span>
              <span>{formatCup(totals.total_employer_ss_cup + totals.total_labor_tax_cup)}</span>
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1">
              Referencia de transferencia nómina (Tarjetas / Banca Remota) *
            </label>
            <input
              className="input-field font-mono"
              placeholder="Ej. BM-NOM-202611-01"
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
              required
            />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPayModal(false)} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Confirmar pago de nómina
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

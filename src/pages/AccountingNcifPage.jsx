import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Printer } from 'lucide-react';
import { api } from '../lib/api.js';
import { downloadCsv, formatCup, formatDate } from '../lib/format.js';

export default function AccountingNcifPage({ notify }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('balance');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/finance/accounting');
      setData(res);
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return <div className="py-12 text-center text-sm text-[#66707D]">Cargando contabilidad NCIF...</div>;
  }

  function exportBalanceCsv() {
    downloadCsv(
      `Balance-Comprobacion-NCIF-${data.period}.csv`,
      ['Código', 'Cuenta NCIF', 'Débitos CUP', 'Créditos CUP', 'Saldo Deudor CUP', 'Saldo Acreedor CUP'],
      data.trial_balance.map((r) => [
        r.account_code,
        r.account_name,
        r.total_debit_cup,
        r.total_credit_cup,
        r.debit_balance_cup,
        r.credit_balance_cup,
      ])
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#171C22]">
            Contabilidad Automatizada (Normas Cubanas — NCIF)
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            Partida doble generada automáticamente en cada venta, recepción SC-2-04, despacho SC-2-09, gasto, nómina y pago ONAT
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportBalanceCsv} className="btn-secondary text-xs">
            <Download className="h-3.5 w-3.5" />
            Exportar Balance
          </button>
          <button type="button" onClick={() => window.print()} className="btn-primary text-xs">
            <Printer className="h-3.5 w-3.5" />
            Imprimir
          </button>
        </div>
      </div>

      {/* Tabs + Balance indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setTab('balance')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              tab === 'balance' ? 'bg-[#0F5C4D] text-white' : 'bg-white border border-[#E3DFD5] text-[#4C5561]'
            }`}
          >
            Balance de Comprobación
          </button>
          <button
            type="button"
            onClick={() => setTab('diario')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              tab === 'diario' ? 'bg-[#0F5C4D] text-white' : 'bg-white border border-[#E3DFD5] text-[#4C5561]'
            }`}
          >
            Libro Diario ({data.journal.length} asientos)
          </button>
        </div>

        {data.trial_totals.is_balanced && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Partida doble cuadrada (Debe = Haber = {formatCup(data.trial_totals.total_debit_cup)})
          </span>
        )}
      </div>

      {tab === 'balance' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Cta.</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Denominación Nomenclador Cubano (NCIF)</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Mov. Debe</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Mov. Haber</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Saldo Deudor</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Saldo Acreedor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
                {data.trial_balance.map((row) => (
                  <tr key={row.account_code} className="hover:bg-[#FAF9F5]">
                    <td className="px-4 py-2.5 font-mono font-bold text-[#1E3A5F]">{row.account_code}</td>
                    <td className="px-3 py-2.5 font-medium text-[#171C22]">{row.account_name}</td>
                    <td className="px-3 py-2.5 text-right text-[#525B68]">{formatCup(row.total_debit_cup)}</td>
                    <td className="px-3 py-2.5 text-right text-[#525B68]">{formatCup(row.total_credit_cup)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-[#0F5C4D]">
                      {row.debit_balance_cup > 0 ? formatCup(row.debit_balance_cup) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#1E3A5F]">
                      {row.credit_balance_cup > 0 ? formatCup(row.credit_balance_cup) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#FAF9F5] border-t-2 border-[#D5D0C4] font-bold text-[#171C22] tabular-nums">
                <tr>
                  <td colSpan={2} className="px-4 py-2.5">
                    TOTALES DE COMPROBACIÓN
                  </td>
                  <td className="px-3 py-2.5 text-right">{formatCup(data.trial_totals.total_debit_cup)}</td>
                  <td className="px-3 py-2.5 text-right">{formatCup(data.trial_totals.total_credit_cup)}</td>
                  <td className="px-3 py-2.5 text-right text-[#0F5C4D]">
                    {formatCup(data.trial_totals.debit_balance_cup)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[#1E3A5F]">
                    {formatCup(data.trial_totals.credit_balance_cup)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {data.journal.map((entry) => (
            <div key={entry.id} className="card p-4 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE4] pb-2">
                <div>
                  <span className="font-mono font-bold text-[#0F5C4D]">{entry.entry_number}</span>
                  <span className="mx-2 text-[#87909D]">·</span>
                  <span className="font-semibold text-[#171C22]">{entry.description}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#66707D]">
                  <span className="rounded bg-[#F2F0E9] px-1.5 py-0.5 font-semibold">{entry.source_type}</span>
                  <span>{formatDate(entry.entry_date)}</span>
                </div>
              </div>
              <table className="w-full tabular-nums">
                <tbody>
                  {entry.lines.map((ln) => (
                    <tr key={ln.id} className="text-[#3C4450]">
                      <td className="py-0.5 w-14 font-mono text-[#66707D]">{ln.account_code}</td>
                      <td className={`py-0.5 ${ln.credit_cup > 0 ? 'pl-5 text-[#58616E]' : 'font-medium'}`}>
                        {ln.account_name}
                      </td>
                      <td className="py-0.5 w-28 text-right">
                        {ln.debit_cup > 0 ? formatCup(ln.debit_cup) : ''}
                      </td>
                      <td className="py-0.5 w-28 text-right">
                        {ln.credit_cup > 0 ? formatCup(ln.credit_cup) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

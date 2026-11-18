import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Landmark,
  Package,
  RefreshCw,
  Scale,
  ShoppingBag,
  Sliders,
  TrendingUp,
  UserPlus,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatCup, formatDate, formatDateTime, formatNumber } from '../lib/format.js';
import StatCard from '../components/StatCard.jsx';

export default function JefeDashboard({ onNavigate, onRefreshBadges, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/config/overview');
      setData(res);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function decideMerma(id, decision) {
    setBusyAction(`merma-${id}`);
    try {
      const r = await api.post(`/api/warehouse/mermas/${id}/decide`, { decision });
      notify(
        decision === 'RECHAZAR'
          ? `Merma ${r.doc_number} rechazada.`
          : `Merma ${r.doc_number} aprobada y contabilizada (${r.journal_entry || 'NCIF'}).`
      );
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusyAction('');
    }
  }

  async function dispatchAllRestocks() {
    setBusyAction('restock-all');
    try {
      const r = await api.post('/api/warehouse/restock-requests/fulfill-all', {});
      notify(`${r.count} producto(s) transferidos automáticamente al mostrador e IPV.`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusyAction('');
    }
  }

  async function auditShift(id) {
    setBusyAction(`shift-${id}`);
    try {
      const r = await api.post(`/api/pos/shifts/${id}/audit`, {});
      notify(`Turno ${r.session_code} auditado y validado.`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusyAction('');
    }
  }

  if (loading && !data) {
    return <div className="py-12 text-center text-sm text-[#66707D]">Cargando panel ejecutivo...</div>;
  }
  if (!data) return null;

  const { today_sales, onat, inventory, active_shift, compliance, pending_approvals, automation_feed, top_products } =
    data;
  const inc = onat.income_statement;
  const totalPending =
    pending_approvals.mermas.length +
    pending_approvals.deposits.length +
    pending_approvals.restocks.length +
    pending_approvals.unvalidated_shifts.length;

  const activeModsCount = Object.values(data.config.modules || {}).filter(Boolean).length;
  const maxCajas = Number(data.config.max_sellers_per_shift || 2);
  const pendingAffs = Number(pending_approvals.affiliations_count || 0);

  return (
    <div className="space-y-6">
      {/* Editorial Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">
            {data.config.business_type || 'Comercio'} · Jornada {formatDate(data.today)}
          </p>
          <h1 className="mt-1 font-editorial text-3xl sm:text-4xl text-[#181715]">
            {data.config.business_name}
          </h1>
          <p className="text-xs text-[#6E685F] mt-1">
            {data.config.legal_form === 'MIPYME' ? 'Micro-MIPYME (DL 88/2024)' : 'TCP (DL 90/2024)'}
            {data.config.company_code ? (
              <>
                {' '}
                · Código de afiliación:{' '}
                <strong className="font-mono text-[#181715]">{data.config.company_code}</strong>
              </>
            ) : null}{' '}
            · {activeModsCount} módulos activos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} className="btn-secondary rounded-full text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => onNavigate('workspace-settings')}
            className="btn-primary rounded-full text-xs"
          >
            <Sliders className="h-3.5 w-3.5" />
            Configurar empresa y afiliados
          </button>
          {data.config.modules?.compliance !== false && (
            <button
              type="button"
              onClick={() => onNavigate('compliance')}
              className="btn-secondary rounded-full text-xs"
            >
              <Scale className="h-3.5 w-3.5" />
              Inspección
            </button>
          )}
        </div>
      </div>

      {/* Pending email affiliation alert banner */}
      {pendingAffs > 0 && (
        <div className="rounded-2xl border border-[#C2542D]/35 bg-[#FBEEE8] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-[#C2542D] p-2 text-white">
              <UserPlus className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-[#181715]">
                Tienes {pendingAffs} solicitud(es) de afiliación por correo esperando tu aprobación
              </p>
              <p className="text-xs text-[#6E493B]">
                Revisa quién ingresó tu código <span className="font-mono">{data.config.company_code}</span> y asígnale su puesto y turno.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('workspace-settings')}
            className="btn-primary rounded-full text-xs"
          >
            Revisar y aprobar →
          </button>
        </div>
      )}

      {/* Top 4 KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Ventas de Hoy"
          value={formatCup(today_sales.total_cup)}
          hint={`${today_sales.tickets} comprobantes · ${today_sales.electronic_pct}% cobro QR (Transfermóvil/EnZona)`}
          icon={ShoppingBag}
          tone="brand"
        />
        <StatCard
          label={`Utilidad Neta (${data.period})`}
          value={formatCup(inc.net_profit_cup)}
          hint={`Ventas mes ${formatCup(inc.gross_sales_cup, 0)} · Tributos ONAT ${formatCup(onat.totals.total_onat_cup, 0)}`}
          icon={TrendingUp}
          tone={inc.net_profit_cup >= 0 ? 'brand' : 'red'}
        />
        <StatCard
          label="Cuenta Bancaria Fiscal"
          value={formatCup(data.bank_balance_cup)}
          hint={`${data.config.bank_name} · ${data.config.fiscal_account_cup}`}
          icon={Landmark}
          tone="navy"
        />
        <StatCard
          label="Inventario Valorizado"
          value={formatCup(inventory.total_cost_cup)}
          hint={`Almacén ${formatCup(inventory.warehouse_cost_cup, 0)} · Kiosko ${formatCup(inventory.kiosk_cost_cup, 0)} (${inventory.low_kiosk_count} bajo mín.)`}
          icon={Package}
          tone={inventory.low_kiosk_count > 0 ? 'amber' : 'default'}
        />
      </div>

      {/* Live 2-Seller Shift Monitor + Pending Approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="card p-5 lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#181715]">
                Monitor de Turno en Vivo ({maxCajas} {maxCajas === 1 ? 'Caja' : 'Cajas'} por Turno)
              </h2>
              <p className="text-xs text-[#66707D]">
                {active_shift
                  ? `${active_shift.shift_name} (${active_shift.start_time}–${active_shift.end_time}) · Código ${active_shift.session_code}`
                  : 'Actualmente no hay un turno abierto en mostrador'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('shift-ipv')}
              className="text-xs font-semibold text-[#0F5C4D] hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              Ver IPV y arqueos <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {active_shift ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {[1, 2].map((regNum) => {
                const reg = active_shift.registers.find((r) => r.register_number === regNum);
                if (!reg) {
                  return (
                    <div
                      key={regNum}
                      className="rounded-xl border border-dashed border-[#D5D0C4] bg-[#FAF9F5] p-4 flex flex-col justify-between"
                    >
                      <div>
                        <span className="text-xs font-semibold text-[#66707D]">Caja {regNum} — Disponible</span>
                        <p className="mt-1 text-xs text-[#7B8491]">
                          Pendiente de incorporación del segundo vendedor del turno.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onNavigate('shift-ipv')}
                        className="mt-3 btn-secondary text-xs py-1.5"
                      >
                        Asignar vendedor
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={regNum} className="rounded-xl border border-[#E3DFD5] bg-[#FAF9F5] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-[#0F5C4D]">
                        Caja {reg.register_number}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          reg.status === 'ABIERTA'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-stone-200 text-stone-700'
                        }`}
                      >
                        {reg.status}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#171C22]">{reg.seller_name}</p>
                      <p className="text-xs text-[#66707D]">{reg.sales_count} ventas realizadas</p>
                    </div>
                    <div className="pt-2 border-t border-[#E6E2D8] space-y-1 text-xs tabular-nums">
                      <div className="flex justify-between font-bold text-[#171C22] text-sm">
                        <span>Total vendido</span>
                        <span>{formatCup(reg.total_sales_cup)}</span>
                      </div>
                      <div className="flex justify-between text-[#525B68]">
                        <span>Efectivo CUP</span>
                        <span>{formatCup(reg.cash_sales_cup)}</span>
                      </div>
                      <div className="flex justify-between text-[#525B68]">
                        <span>Transfermóvil QR</span>
                        <span>{formatCup(reg.transfermovil_sales_cup)}</span>
                      </div>
                      <div className="flex justify-between text-[#525B68]">
                        <span>EnZona QR</span>
                        <span>{formatCup(reg.enzona_sales_cup)}</span>
                      </div>
                      <div className="flex justify-between text-[#0F5C4D] font-medium pt-1">
                        <span>Esperado en gaveta</span>
                        <span>{formatCup(reg.expected_cash_cup)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#D5D0C4] p-6 text-center">
              <p className="text-sm text-[#525B68]">Ningún turno está abierto en este momento.</p>
              <button
                type="button"
                onClick={() => onNavigate('shift-ipv')}
                className="mt-3 btn-primary text-xs"
              >
                Abrir nuevo turno
              </button>
            </div>
          )}

          {/* Top Products */}
          <div className="pt-2 border-t border-[#ECE8DE]">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#66707D] mb-2.5">
              Productos de mayor facturación ({data.period})
            </h3>
            <div className="space-y-1.5">
              {top_products.map((tp) => (
                <div
                  key={tp.product_id}
                  className="flex items-center justify-between gap-2 text-xs py-1 border-b border-[#F2F0E9] last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium text-[#171C22]">{tp.product_name}</span>
                    {tp.is_price_capped ? (
                      <span className="shrink-0 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.2 text-[10px] font-medium text-amber-800">
                        Topado MFP
                      </span>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <span className="text-[#66707D] mr-3">
                      {formatNumber(tp.qty_sold)} {tp.unit}
                    </span>
                    <span className="font-semibold text-[#171C22]">{formatCup(tp.revenue_cup)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Action Queue */}
        <section className="card p-5 lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#171C22]">Decisiones y Tareas Automatizadas</h2>
              <p className="text-xs text-[#66707D]">Controles que requieren firma o ejecución</p>
            </div>
            <span className="rounded-full bg-[#F3F1EB] px-2.5 py-0.5 text-xs font-bold text-[#171C22] tabular-nums">
              {totalPending}
            </span>
          </div>

          {totalPending === 0 ? (
            <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-5 text-center space-y-1">
              <CheckCircle2 className="h-6 w-6 text-emerald-700 mx-auto" />
              <p className="text-sm font-semibold text-emerald-900">Todo al día</p>
              <p className="text-xs text-emerald-800">
                No hay mermas, reabastecimientos ni depósitos pendientes de aprobación.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Auto restocks */}
              {pending_approvals.restocks.length > 0 && (
                <div className="rounded-lg border border-[#E3DFD5] bg-[#FAF9F5] p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#8A4B08]">
                      Reabastecimiento automático ({pending_approvals.restocks.length})
                    </span>
                    <button
                      type="button"
                      disabled={busyAction === 'restock-all'}
                      onClick={dispatchAllRestocks}
                      className="btn-primary text-[11px] py-1 px-2.5"
                    >
                      Despachar todo (SC-2-09)
                    </button>
                  </div>
                  <ul className="space-y-1 text-xs text-[#4C5561]">
                    {pending_approvals.restocks.slice(0, 4).map((r) => (
                      <li key={r.id} className="flex justify-between gap-2 tabular-nums">
                        <span className="truncate">{r.product_name}</span>
                        <span className="shrink-0 font-medium">
                          +{r.suggested_qty} {r.unit} (quedan {r.kiosk_stock})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pending Mermas SC-2-16 */}
              {pending_approvals.mermas.map((m) => (
                <div key={m.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-amber-900">Acta de Merma {m.doc_number}</span>
                    <span className="font-semibold text-amber-900 tabular-nums">
                      {formatCup(m.total_cost_cup)}
                    </span>
                  </div>
                  <p className="text-xs text-[#3C4450]">
                    <strong>
                      {m.quantity} {m.unit}
                    </strong>{' '}
                    de {m.product_name} — {m.reason}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={busyAction === `merma-${m.id}`}
                      onClick={() => decideMerma(m.id, 'APROBAR')}
                      className="btn-primary text-[11px] py-1 px-2.5"
                    >
                      Aprobar y contabilizar
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === `merma-${m.id}`}
                      onClick={() => decideMerma(m.id, 'RECHAZAR')}
                      className="btn-secondary text-[11px] py-1 px-2.5"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              ))}

              {/* Pending BCC Bank Deposits */}
              {pending_approvals.deposits.map((d) => (
                <div key={d.id} className="rounded-lg border border-[#D4DEE9] bg-[#F4F7FA] p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#1E3A5F]">
                      Depósito BCC {d.order_number} (Res. 111/2023)
                    </span>
                    <span className="font-bold text-[#1E3A5F] tabular-nums">{formatCup(d.amount_cup)}</span>
                  </div>
                  <p className="text-xs text-[#4C5561]">
                    Límite bancario: <strong>{formatDate(d.due_date)}</strong>
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('banking')}
                    className="btn-secondary text-[11px] py-1 px-2.5 mt-1"
                  >
                    Registrar voucher de banco
                  </button>
                </div>
              ))}

              {/* Unvalidated shifts */}
              {pending_approvals.unvalidated_shifts.map((s) => (
                <div key={s.id} className="rounded-lg border border-[#E3DFD5] bg-white p-3.5 space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Auditoría pendiente: {s.session_code}</span>
                    <span className="tabular-nums">{formatCup(s.total_sales_cup)}</span>
                  </div>
                  <p className="text-xs text-[#66707D]">
                    Diferencia en arqueo: {formatCup(s.total_diff_cup)}
                  </p>
                  <button
                    type="button"
                    disabled={busyAction === `shift-${s.id}`}
                    onClick={() => auditShift(s.id)}
                    className="btn-primary text-[11px] py-1 px-2.5"
                  >
                    Validar cierre de turno
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Cuban Legal Semaphore + Live Automation Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="card p-5 lg:col-span-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#171C22]">
                Semáforo de Leyes Económicas Cubanas ({compliance.score}%)
              </h2>
              <p className="text-xs text-[#66707D]">
                {compliance.ok_count} en regla · {compliance.warning_count} atención · {compliance.critical_count} crítico
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('compliance')}
              className="text-xs font-semibold text-[#0F5C4D] hover:underline cursor-pointer"
            >
              Detalle legal
            </button>
          </div>
          <div className="divide-y divide-[#EFECE4] max-h-72 overflow-y-auto">
            {compliance.checks.map((ch) => (
              <div key={ch.code} className="py-2.5 flex items-start gap-2.5">
                {ch.status === 'OK' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                ) : (
                  <AlertTriangle
                    className={`h-4 w-4 shrink-0 mt-0.5 ${
                      ch.status === 'CRITICO' ? 'text-red-600' : 'text-amber-600'
                    }`}
                  />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#171C22]">
                    {ch.title}{' '}
                    <span className="font-normal text-[#6F7885]">({ch.authority})</span>
                  </p>
                  <p className="text-[11px] text-[#58616E] leading-snug mt-0.5">{ch.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5 lg:col-span-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#0F5C4D]" />
              <div>
                <h2 className="text-sm font-bold text-[#171C22]">Motor Automatizado en Acción</h2>
                <p className="text-xs text-[#66707D]">Procesos ejecutados sin intervención manual</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-[#EFECE4] max-h-72 overflow-y-auto">
            {automation_feed.map((ev) => (
              <div key={ev.id} className="py-2.5 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#171C22]">{ev.title}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      ev.severity === 'BLOQUEO'
                        ? 'bg-red-100 text-red-800'
                        : ev.severity === 'ALERTA'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-[#F1EFE8] text-[#4C5561]'
                    }`}
                  >
                    {ev.category}
                  </span>
                </div>
                <p className="text-[11px] text-[#58616E] leading-snug">{ev.detail}</p>
                <p className="text-[10px] text-[#87909D]">{formatDateTime(ev.created_at)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

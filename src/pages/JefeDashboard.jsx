import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  Landmark,
  MessageCircle,
  Package,
  RefreshCw,
  Scale,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Sliders,
  TrendingUp,
  UserPlus,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatCup, formatDate, formatDateTime, formatNumber } from '../lib/format.js';
import { canUserAccess } from '../lib/permissions.js';
import {
  buildCatalogUrl,
  buildWhatsappUrl,
  sanitizeWhatsappDigits,
} from '../lib/whatsapp.js';
import StatCard from '../components/StatCard.jsx';

export default function JefeDashboard({
  user,
  onNavigate,
  onOpenCatalogTab,
  onPreviewCatalog,
  onRefreshBadges,
  notify,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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
          : `Merma ${r.doc_number} aprobada y contabilizada.`
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
      notify(`${r.count} producto(s) pasados al mostrador.`);
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
      notify(`Turno ${r.session_code} validado.`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusyAction('');
    }
  }

  if (loading && !data) {
    return <div className="py-16 text-center text-sm text-[#6E685F]">Preparando tu negocio...</div>;
  }
  if (!data) return null;

  const {
    today_sales,
    onat,
    inventory,
    active_shift,
    compliance,
    pending_approvals,
    automation_feed,
    top_products,
    catalog_summary,
  } = data;

  const mods = data.config.modules || {};
  const isOn = (k) => mods[k] !== false;
  const canGo = (modId) => !user || canUserAccess(user, data.config, modId, 'canView');
  const inc = onat.income_statement;
  const maxCajas = Number(data.config.max_sellers_per_shift || 2);
  const pendingAffs = Number(pending_approvals.affiliations_count || 0);
  const pendingOrdersCount = Number(pending_approvals.orders_count || 0);
  const pendingOrdersList = pending_approvals.orders || [];
  const totalTasks =
    pendingOrdersCount +
    pending_approvals.mermas.length +
    pending_approvals.deposits.length +
    pending_approvals.restocks.length +
    pending_approvals.unvalidated_shifts.length;

  const companyCode = data.config.company_code || '';
  const catalogUrl = buildCatalogUrl(companyCode);
  const waPhone = catalog_summary?.whatsapp_phone || data.config.whatsapp_phone || '';
  const hasWhatsapp = sanitizeWhatsappDigits(waPhone).length >= 7;

  function copyCatalog() {
    navigator.clipboard?.writeText(catalogUrl);
    setCopiedLink(true);
    notify('¡Link del catálogo copiado! Envíalo por WhatsApp a tus clientes.');
    setTimeout(() => setCopiedLink(false), 2400);
  }

  function shareCatalogWhatsapp() {
    const msg = `¡Hola! 👋 Mira el catálogo actualizado de *${data.config.business_name}*, arma tu pedido y envíamelo por aquí:\n${catalogUrl}`;
    window.open(buildWhatsappUrl('', msg), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-6">
      {/* Clean Welcoming Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Hoy · {formatDate(data.today)}</p>
          <h1 className="mt-1 font-editorial text-3xl sm:text-4xl text-[#181715]">
            {data.config.business_name}
          </h1>
          <p className="mt-1 text-xs text-[#6E685F]">
            {active_shift
              ? `● ${active_shift.shift_name} abierto (${active_shift.registers?.filter((r) => r.status === 'ABIERTA').length || 0} caja activa)`
              : '○ Sin turno abierto todavía'}
            {companyCode ? ` · Código ${companyCode}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="btn-secondary rounded-full text-xs py-2 px-3.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizar
          </button>
          {canGo('workspace-settings') && (
            <button
              type="button"
              onClick={() => onNavigate('workspace-settings')}
              className="btn-secondary rounded-full text-xs py-2 px-3.5"
            >
              <Sliders className="h-3.5 w-3.5" />
              Mi Empresa y Modo
            </button>
          )}
        </div>
      </div>

      {/* Urgent Affiliation Alert (when an employee entered your company code) */}
      {pendingAffs > 0 && (
        <div className="rounded-2xl border border-[#C2542D]/35 bg-[#FBEEE8] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-[#C2542D] p-2 text-white">
              <UserPlus className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-[#181715]">
                {pendingAffs} persona(s) pidieron sumarse a tu equipo
              </p>
              <p className="text-xs text-[#6E493B]">
                Revisa su correo y asígnales su puesto y turno en un clic.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('workspace-settings')}
            className="btn-primary rounded-full text-xs"
          >
            Aprobar ahora →
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUPER-INTUITIVE 4-CARD QUICK LAUNCHPAD ("¿Qué quieres hacer?")    */}
      {/* ================================================================= */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {canGo('pos') && (
          <button
            type="button"
            onClick={() => onNavigate('pos')}
            className="group rounded-2xl bg-[#181715] text-[#FAF8F4] p-4 text-left flex flex-col justify-between gap-3 hover:bg-[#2B2925] transition cursor-pointer shadow-xs"
          >
            <div className="flex items-center justify-between">
              <span className="h-10 w-10 rounded-xl bg-white/12 flex items-center justify-center">
                <ShoppingCart className="h-5 w-5 text-white" />
              </span>
              <ArrowRight className="h-4 w-4 text-white/60 group-hover:translate-x-0.5 transition" />
            </div>
            <div>
              <p className="text-sm font-bold">Mostrador (POS)</p>
              <p className="text-[11px] text-[#C8C2B7]">Efectivo CUP, Transfermóvil o EnZona</p>
            </div>
          </button>
        )}

        {isOn('catalog') && canGo('catalog-wa') && (
          <button
            type="button"
            onClick={() => onNavigate('catalog-wa')}
            className="group rounded-2xl bg-[#E6F5EF] border border-[#BDE5D5] text-[#181715] p-4 text-left flex flex-col justify-between gap-3 hover:bg-[#D8EFE6] transition cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="h-10 w-10 rounded-xl bg-[#1DA851] text-white flex items-center justify-center">
                <MessageCircle className="h-5 w-5" />
              </span>
              {pendingOrdersCount > 0 ? (
                <span className="rounded-full bg-[#1DA851] text-white px-2.5 py-0.5 text-[11px] font-extrabold">
                  {pendingOrdersCount} {pendingOrdersCount === 1 ? 'pedido' : 'pedidos'}
                </span>
              ) : (
                <ArrowRight className="h-4 w-4 text-[#15614B] group-hover:translate-x-0.5 transition" />
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-[#113D2F]">Catálogo WhatsApp</p>
              <p className="text-[11px] text-[#286350]">
                {pendingOrdersCount > 0
                  ? `${pendingOrdersCount} por atender ahora`
                  : `${catalog_summary?.visible_products || 0} productos publicados`}
              </p>
            </div>
          </button>
        )}

        {isOn('warehouse') && canGo('warehouse') && (
          <button
            type="button"
            onClick={() => onNavigate('warehouse')}
            className="group rounded-2xl bg-white border border-[#E7E1D6] p-4 text-left flex flex-col justify-between gap-3 hover:border-[#C2B8A6] transition cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="h-10 w-10 rounded-xl bg-[#F3EFE7] text-[#181715] flex items-center justify-center">
                <Package className="h-5 w-5" />
              </span>
              {inventory.low_kiosk_count > 0 ? (
                <span className="rounded-full bg-[#FCECE6] text-[#B5421E] px-2 py-0.5 text-[10px] font-bold">
                  {inventory.low_kiosk_count} bajo mín.
                </span>
              ) : (
                <ArrowRight className="h-4 w-4 text-[#8A8379] group-hover:translate-x-0.5 transition" />
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-[#181715]">Almacén y Stock</p>
              <p className="text-[11px] text-[#6E685F]">
                Entradas, fotos y {inventory.total_products} productos
              </p>
            </div>
          </button>
        )}

        {canGo('staff') && (
          <button
            type="button"
            onClick={() => onNavigate('staff')}
            className="group rounded-2xl bg-white border border-[#E7E1D6] p-4 text-left flex flex-col justify-between gap-3 hover:border-[#C2B8A6] transition cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="h-10 w-10 rounded-xl bg-[#F3EFE7] text-[#181715] flex items-center justify-center">
                <UserPlus className="h-5 w-5" />
              </span>
              <ArrowRight className="h-4 w-4 text-[#8A8379] group-hover:translate-x-0.5 transition" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#181715]">Equipo y Turnos</p>
              <p className="text-[11px] text-[#6E685F] truncate">
                Permisos y código {companyCode || ''}
              </p>
            </div>
          </button>
        )}
      </section>

      {/* ================================================================= */}
      {/* RESUMEN EJECUTIVO HOY: EFECTIVO CUP · TRANSFERMÓVIL · ENZONA · CAJAS */}
      {/* ================================================================= */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-2xl bg-[#181715] text-[#FAF8F4] p-4 space-y-1">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-white/65">
            Ventas hoy (CUP)
          </p>
          <p className="text-lg sm:text-xl font-black tabular-nums">
            {formatCup(today_sales.total_cup)}
          </p>
          <p className="text-[11px] text-white/75">
            {today_sales.tickets} comprobante{today_sales.tickets === 1 ? '' : 's'} ·{' '}
            {today_sales.electronic_pct}% digital
          </p>
        </div>

        <div className="rounded-2xl bg-white border border-[#E7E1D6] p-4 space-y-1">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-[#756E64]">
            Efectivo CUP
          </p>
          <p className="text-base sm:text-lg font-extrabold text-[#181715] tabular-nums">
            {formatCup(today_sales.cash_cup ?? 0)}
          </p>
          <p className="text-[11px] text-[#6E685F]">Cobrado en billetes</p>
        </div>

        <div className="rounded-2xl bg-white border border-[#E7E1D6] p-4 space-y-1">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-[#15614B]">
            Transfermóvil QR
          </p>
          <p className="text-base sm:text-lg font-extrabold text-[#15614B] tabular-nums">
            {formatCup(today_sales.transfermovil_cup ?? 0)}
          </p>
          <p className="text-[11px] text-[#6E685F]">Pasarela ETECSA / BCC</p>
        </div>

        <div className="rounded-2xl bg-white border border-[#E7E1D6] p-4 space-y-1">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-[#1E3A5F]">
            EnZona QR
          </p>
          <p className="text-base sm:text-lg font-extrabold text-[#1E3A5F] tabular-nums">
            {formatCup(today_sales.enzona_cup ?? 0)}
          </p>
          <p className="text-[11px] text-[#6E685F]">Cobro electrónico XETID</p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('shift-ipv')}
          className="col-span-2 lg:col-span-1 rounded-2xl bg-white border border-[#E7E1D6] hover:border-[#181715] p-4 space-y-1 text-left transition cursor-pointer"
        >
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-[#756E64]">
            Cajas e IPV
          </p>
          <p className="text-base sm:text-lg font-extrabold text-[#181715] tabular-nums">
            {active_shift?.registers?.filter((r) => r.status === 'ABIERTA').length || 0} abiertas ·{' '}
            {(active_shift?.registers?.filter((r) => r.status !== 'ABIERTA').length || 0) +
              Number(data.closed_shifts_today || 0)}{' '}
            cerradas
          </p>
          <p className="text-[11px] text-[#6E685F]">
            {pending_approvals.mermas.length > 0
              ? `${pending_approvals.mermas.length} merma(s) por aprobar`
              : (pending_approvals.price_requests || []).length > 0
                ? `${pending_approvals.price_requests.length} precio(s) por aprobar`
                : `${inventory.low_kiosk_count || 0} alerta(s) de stock`}
          </p>
        </button>
      </section>

      {/* ================================================================= */}
      {/* READY-TO-SHARE CUSTOMER CATALOG STRIP                             */}
      {/* ================================================================= */}
      {isOn('catalog') && (
        <section className="rounded-2xl bg-white border border-[#E7E1D6] p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-bold text-[#181715]">
              Tu catálogo para clientes está listo para compartir
            </p>
            <p className="text-xs text-[#6E685F]">
              {hasWhatsapp ? (
                <>
                  Los clientes arman su pedido y te llega armado al WhatsApp{' '}
                  <strong className="text-[#15614B]">{waPhone}</strong>.
                </>
              ) : (
                <>
                  Agrega tu número de WhatsApp para recibir cada pedido listo en tu celular.{' '}
                  <button
                    type="button"
                    onClick={() =>
                      onOpenCatalogTab ? onOpenCatalogTab('settings') : onNavigate('catalog-wa')
                    }
                    className="font-bold text-[#C2542D] underline cursor-pointer"
                  >
                    Cargar mi WhatsApp →
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onPreviewCatalog && (
              <button
                type="button"
                onClick={() => onPreviewCatalog(companyCode)}
                className="btn-secondary rounded-full text-xs py-2 px-3.5"
              >
                <Eye className="h-3.5 w-3.5" />
                Probar catálogo
              </button>
            )}
            <button
              type="button"
              onClick={copyCatalog}
              className="btn-secondary rounded-full text-xs py-2 px-3.5"
            >
              {copiedLink ? <Check className="h-3.5 w-3.5 text-[#15614B]" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedLink ? '¡Copiado!' : 'Copiar link'}
            </button>
            <button
              type="button"
              onClick={shareCatalogWhatsapp}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1DA851] hover:bg-[#178F44] text-white text-xs font-bold px-4 py-2 transition cursor-pointer"
            >
              <Share2 className="h-3.5 w-3.5" />
              Enviar por WhatsApp
            </button>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* 4 CRYSTAL-CLEAR KEY NUMBERS                                       */}
      {/* ================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <StatCard
          label="Vendido hoy"
          value={formatCup(today_sales.total_cup)}
          hint={`${today_sales.tickets} ventas · ${today_sales.electronic_pct}% por QR`}
          icon={ShoppingBag}
          tone="brand"
        />
        <StatCard
          label="Ganancia del mes"
          value={formatCup(inc.net_profit_cup)}
          hint={`Ventas mes: ${formatCup(inc.gross_sales_cup, 0)}`}
          icon={TrendingUp}
          tone={inc.net_profit_cup >= 0 ? 'brand' : 'red'}
        />
        <StatCard
          label="Dinero en banco"
          value={formatCup(data.bank_balance_cup)}
          hint={data.config.bank_name}
          icon={Landmark}
          tone="navy"
        />
        <StatCard
          label="Mercadería en stock"
          value={formatCup(inventory.total_cost_cup)}
          hint={
            inventory.low_kiosk_count > 0
              ? `${inventory.low_kiosk_count} producto(s) por reponer`
              : `${inventory.total_products} productos al día`
          }
          icon={Package}
          tone={inventory.low_kiosk_count > 0 ? 'amber' : 'default'}
        />
      </div>

      {/* ================================================================= */}
      {/* PENDING TASKS (1-CLICK) + LIVE SHIFT REGISTERS                    */}
      {/* ================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Pending items — Orders, Restocks, Mermas, Shifts */}
        <section className="card p-5 lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#181715]">Para atender ahora</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                totalTasks > 0
                  ? 'bg-[#FCECE6] text-[#B5421E]'
                  : 'bg-[#E6F5EF] text-[#15614B]'
              }`}
            >
              {totalTasks === 0 ? 'Todo al día ✓' : `${totalTasks} pendiente(s)`}
            </span>
          </div>

          {totalTasks === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E2DCD0] p-7 text-center space-y-1">
              <CheckCircle2 className="h-7 w-7 text-[#15614B] mx-auto" />
              <p className="text-sm font-semibold text-[#181715]">Nada pendiente por resolver</p>
              <p className="text-xs text-[#6E685F]">
                Los pedidos de WhatsApp, reposiciones y cierres aparecerán aquí.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Incoming WhatsApp Orders */}
              {pendingOrdersList.slice(0, 3).map((ord) => (
                <div
                  key={ord.id}
                  className="rounded-2xl border border-[#BDE5D5] bg-[#E6F5EF]/60 p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#113D2F] truncate">
                      💬 Pedido {ord.order_code} · {ord.customer_name}
                    </p>
                    <p className="text-[11px] text-[#286350]">
                      {ord.delivery_mode === 'DOMICILIO' ? '🛵 Domicilio' : '🏪 Retiro'} ·{' '}
                      <strong>{formatCup(ord.total_cup)}</strong> ({ord.status.toLowerCase()})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('catalog-wa')}
                    className="shrink-0 rounded-full bg-[#15614B] text-white px-3 py-1.5 text-[11px] font-bold hover:bg-[#104B3A] cursor-pointer"
                  >
                    Atender
                  </button>
                </div>
              ))}

              {/* Restocks */}
              {pending_approvals.restocks.length > 0 && (
                <div className="rounded-2xl border border-[#E7E1D6] bg-[#FAF8F4] p-3.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-[#181715]">
                      📦 {pending_approvals.restocks.length} producto(s) bajos en mostrador
                    </p>
                    <p className="text-[11px] text-[#6E685F]">
                      Pásalos del almacén al mostrador en un clic.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction === 'restock-all'}
                    onClick={dispatchAllRestocks}
                    className="shrink-0 btn-primary rounded-full text-[11px] py-1.5 px-3.5"
                  >
                    Reponer
                  </button>
                </div>
              )}

              {/* Mermas */}
              {pending_approvals.mermas.map((m) => (
                <div
                  key={m.id}
                  className="rounded-2xl border border-[#E7E1D6] bg-[#FAF8F4] p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#181715] truncate">
                      Baja por merma: {formatNumber(m.quantity)} {m.unit} de {m.product_name}
                    </p>
                    <p className="text-[11px] text-[#6E685F] truncate">{m.reason}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busyAction === `merma-${m.id}`}
                      onClick={() => decideMerma(m.id, 'APROBAR')}
                      className="btn-primary rounded-full text-[11px] py-1 px-3"
                    >
                      Aprobar
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === `merma-${m.id}`}
                      onClick={() => decideMerma(m.id, 'RECHAZAR')}
                      className="btn-secondary rounded-full text-[11px] py-1 px-2.5"
                    >
                      No
                    </button>
                  </div>
                </div>
              ))}

              {/* Unvalidated closed shifts */}
              {pending_approvals.unvalidated_shifts.map((s) => (
                <div
                  key={s.id}
                  className="rounded-2xl border border-[#E7E1D6] bg-[#FAF8F4] p-3.5 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-xs font-bold text-[#181715]">
                      Turno cerrado {s.session_code} por validar
                    </p>
                    <p className="text-[11px] text-[#6E685F]">
                      Vendido: {formatCup(s.total_sales_cup)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction === `shift-${s.id}`}
                    onClick={() => auditShift(s.id)}
                    className="btn-secondary rounded-full text-[11px] py-1.5 px-3"
                  >
                    Validar
                  </button>
                </div>
              ))}

              {/* Pending bank deposits */}
              {pending_approvals.deposits.length > 0 && isOn('banking') && (
                <div className="rounded-2xl border border-[#E7E1D6] bg-[#FAF8F4] p-3.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-[#181715]">
                      🏦 {pending_approvals.deposits.length} depósito(s) al banco pendiente(s)
                    </p>
                    <p className="text-[11px] text-[#6E685F]">
                      Efectivo recaudado listo para depositar.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('banking')}
                    className="btn-secondary rounded-full text-[11px] py-1.5 px-3"
                  >
                    Ver
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Live Counter / Registers */}
        <section className="card p-5 lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#181715]">Cajas en mostrador</h2>
              <p className="text-xs text-[#6E685F]">
                {active_shift
                  ? `${active_shift.shift_name} (${active_shift.start_time}–${active_shift.end_time})`
                  : 'Abre una caja para empezar a cobrar'}
              </p>
            </div>
            {isOn('ipv') && (
              <button
                type="button"
                onClick={() => onNavigate('shift-ipv')}
                className="btn-secondary rounded-full text-xs py-1.5 px-3"
              >
                Ver turno
              </button>
            )}
          </div>

          {active_shift ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: Math.min(maxCajas, 4) }, (_, idx) => idx + 1).map((regNum) => {
                const reg = active_shift.registers?.find((r) => r.register_number === regNum);
                if (!reg) {
                  return (
                    <div
                      key={regNum}
                      className="rounded-2xl border border-dashed border-[#DDD6C8] p-4 flex flex-col justify-between text-xs text-[#8A8379]"
                    >
                      <div>
                        <p className="font-bold text-[#4A463F]">Caja {regNum}</p>
                        <p className="mt-0.5">Libre en este turno</p>
                      </div>
                      {isOn('ipv') && (
                        <button
                          type="button"
                          onClick={() => onNavigate('shift-ipv')}
                          className="mt-3 btn-secondary rounded-full text-[11px] py-1 px-3 self-start"
                        >
                          Abrir Caja {regNum}
                        </button>
                      )}
                    </div>
                  );
                }
                const qrTotal =
                  Number(reg.transfermovil_sales_cup || 0) + Number(reg.enzona_sales_cup || 0);
                return (
                  <div
                    key={regNum}
                    className="rounded-2xl border border-[#E7E1D6] bg-[#FAF8F4] p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-[#15614B]">
                        Caja {reg.register_number}
                      </span>
                      <span className="rounded-full bg-[#E6F5EF] text-[#15614B] px-2 py-0.5 text-[10px] font-bold">
                        {reg.status}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#181715] truncate">{reg.seller_name}</p>
                      <p className="text-[11px] text-[#6E685F]">{reg.sales_count} ventas</p>
                    </div>
                    <div className="pt-2 border-t border-[#E7E1D6] space-y-1 text-xs tabular-nums">
                      <div className="flex justify-between font-extrabold text-[#181715]">
                        <span>Vendido</span>
                        <span>{formatCup(reg.total_sales_cup)}</span>
                      </div>
                      <div className="flex justify-between text-[#6E685F]">
                        <span>Efectivo / QR</span>
                        <span>
                          {formatCup(reg.cash_sales_cup, 0)} / {formatCup(qrTotal, 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#DDD6C8] p-7 text-center space-y-3">
              <p className="text-sm text-[#5E584F]">Todavía no hay una caja abierta hoy.</p>
              <button
                type="button"
                onClick={() => onNavigate('pos')}
                className="btn-primary rounded-full text-xs py-2 px-5"
              >
                Ir a cobrar y abrir caja
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Progressive Disclosure: Toggle detailed Fiscal / Legal / Automation view */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs font-bold text-[#5E584F] hover:text-[#181715] inline-flex items-center gap-1.5 cursor-pointer"
        >
          <span>{showAdvanced ? '▾ Ocultar detalle de productos, impuestos y actividad' : '▸ Ver más vendidos, impuestos y actividad automática'}</span>
        </button>
      </div>

      {showAdvanced && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Top products */}
          <section className="card p-5 lg:col-span-5 space-y-3">
            <h3 className="text-sm font-bold text-[#181715]">Lo más vendido del mes</h3>
            {top_products?.length ? (
              <div className="divide-y divide-[#F3EFE7] text-xs">
                {top_products.slice(0, 6).map((p, idx) => (
                  <div key={p.id || idx} className="py-2.5 flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-[#181715]">
                      {idx + 1}. {p.name}
                    </span>
                    <span className="shrink-0 font-bold tabular-nums text-[#15614B]">
                      {formatCup(p.revenue_cup, 0)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#6E685F]">Tus primeras ventas aparecerán aquí.</p>
            )}
          </section>

          {/* Tax & Compliance snapshot */}
          <section className="card p-5 lg:col-span-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#181715]">Impuestos y cumplimiento</h3>
              {isOn('compliance') && (
                <span className="rounded-full bg-[#E6F5EF] text-[#15614B] px-2 py-0.5 text-[11px] font-bold">
                  {compliance.score}% OK
                </span>
              )}
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[#6E685F]">Ventas del mes</span>
                <strong className="tabular-nums">{formatCup(inc.gross_sales_cup)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6E685F]">Tributos estimados (ONAT)</span>
                <strong className="tabular-nums">{formatCup(onat.totals.total_onat_cup)}</strong>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#F3EFE7]">
                <span className="font-bold text-[#181715]">Utilidad neta</span>
                <strong className="tabular-nums text-[#15614B]">{formatCup(inc.net_profit_cup)}</strong>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {isOn('onat') && (
                <button
                  type="button"
                  onClick={() => onNavigate('onat')}
                  className="btn-secondary rounded-full text-[11px] py-1.5 px-3"
                >
                  Ver ONAT
                </button>
              )}
              {isOn('compliance') && (
                <button
                  type="button"
                  onClick={() => onNavigate('compliance')}
                  className="btn-secondary rounded-full text-[11px] py-1.5 px-3"
                >
                  <Scale className="h-3 w-3" />
                  Carpeta de Inspección
                </button>
              )}
            </div>
          </section>

          {/* Bitácora de Auditoría y Actividad Reciente */}
          <section className="card p-5 lg:col-span-3 space-y-3">
            <h3 className="text-sm font-bold text-[#181715] flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-[#C2542D]" />
              Bitácora de acciones
            </h3>
            <div className="space-y-2.5 max-h-56 overflow-y-auto text-xs">
              {(data.recent_audit?.length ? data.recent_audit : automation_feed || [])
                .slice(0, 7)
                .map((ev) => (
                  <div key={ev.id} className="border-b border-[#F3EFE7] pb-2 last:border-0">
                    <p className="font-semibold text-[#181715] leading-snug">
                      {ev.detail || ev.title}
                    </p>
                    <p className="text-[10px] text-[#8A8379] mt-0.5">
                      {ev.user_name ? `${ev.user_name} (${ev.user_role}) · ` : ''}
                      {formatDateTime(ev.created_at)}
                    </p>
                  </div>
                ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

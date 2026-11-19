import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Globe,
  History,
  Image as ImageIcon,
  Printer,
  QrCode,
  Wand2,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META, formatCup, formatDateTime, formatNumber } from '../lib/format.js';
import { canUserAccess, hasPermissionFlag } from '../lib/permissions.js';
import { buildCatalogUrl } from '../lib/whatsapp.js';
import Modal from '../components/Modal.jsx';

export default function PricingMfpPage({
  user,
  config,
  activeCompany,
  onPreviewCatalog,
  notify,
  onRefreshBadges,
}) {
  const canViewCosts = user.role === 'jefe' || hasPermissionFlag(user, config, 'view_costs');
  const canEditPrices = user.role === 'jefe' || hasPermissionFlag(user, config, 'edit_prices');
  const canPublishCatalog =
    user.role === 'jefe' || hasPermissionFlag(user, config, 'publish_catalog');
  const canApprovePrices = canUserAccess(user, config, 'pricing', 'canApprove');

  const [data, setData] = useState(null);
  const [viewMode, setViewMode] = useState(canViewCosts ? 'fichas' : 'tablilla');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareModal, setShareModal] = useState(false);

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

  function openEdit(item) {
    setEditing(item);
    setForm({
      sale_price_cup: item.sale_price_cup,
      indirect_cost_pct: item.indirect_cost_pct ?? 8,
      is_price_capped: Boolean(item.is_price_capped),
      price_cap_cup: item.price_cap_cup || '',
      price_cap_resolution: item.price_cap_resolution || 'Res. 225/2024 MFP',
      is_margin_regulated: Boolean(item.is_margin_regulated ?? true),
      catalog_visible: Boolean(item.catalog_visible),
      reason: 'Actualización de Ficha de Costo y Tablilla MFP',
    });
  }

  async function savePrice(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/api/finance/products/${editing.id}/price`, {
        ...form,
        sale_price_cup: Number(form.sale_price_cup),
        indirect_cost_pct: Number(form.indirect_cost_pct),
        price_cap_cup: form.is_price_capped ? Number(form.price_cap_cup) : null,
      });
      if (canPublishCatalog && Boolean(form.catalog_visible) !== Boolean(editing.catalog_visible)) {
        await api.put(`/api/warehouse/products/${editing.id}/ficha`, {
          catalog_visible: Boolean(form.catalog_visible),
        });
      }
      notify(`Precio de «${editing.name}» actualizado y sincronizado con POS y Catálogo.`);
      setEditing(null);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleCatalogPublic(item) {
    if (!canPublishCatalog) return;
    try {
      const next = !item.catalog_visible;
      await api.put(`/api/warehouse/products/${item.id}/ficha`, { catalog_visible: next });
      notify(
        next
          ? `«${item.name}» publicado en el Catálogo público.`
          : `«${item.name}» ocultado del Catálogo público.`
      );
      await load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function decidePriceRequest(id, decision) {
    setBusy(true);
    try {
      await api.post(`/api/finance/price-requests/${id}/decide`, { decision });
      notify(
        decision === 'APROBAR'
          ? 'Propuesta de precio aprobada y aplicada en POS, Tablilla y Catálogo.'
          : 'Propuesta de precio rechazada.'
      );
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
      const res = await api.post('/api/finance/auto-optimize-prices', {});
      notify(
        res.adjusted_count > 0
          ? `${res.adjusted_count} producto(s) ajustados automáticamente dentro del tope y margen MFP.`
          : 'Todos los precios vigentes ya cumplen estrictamente las normas MFP.'
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
    return <div className="text-sm text-[#66707D] py-10 text-center">Cargando Precios y Tablilla...</div>;
  }

  const companyCode =
    data.company_code || activeCompany?.company_code || config?.company_code || 'kiosko-CEIBA1';
  const catalogUrl = buildCatalogUrl(companyCode);
  const pendingRequests = (data.history || []).filter((h) => h.status === 'PENDIENTE_JEFE');
  const showFx = canViewCosts && Boolean(data.business?.show_fx_reference);
  const rateUsd = Number(data.business?.rate_usd_cup || 320);
  const rateMlc = Number(data.business?.rate_mlc_cup || 275);
  const rateEur = Number(data.business?.rate_eur_cup || 340);

  function handleCopyCatalog() {
    navigator.clipboard?.writeText(catalogUrl);
    setCopiedLink(true);
    notify('Enlace del Catálogo público copiado.');
    setTimeout(() => setCopiedLink(false), 2200);
  }

  return (
    <div className="space-y-5">
      {/* Cabecera y selector de vista */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <h1 className="text-lg font-bold text-[#171C22]">
            {canViewCosts
              ? 'Precios, Márgenes MFP, Tablilla Oficial y Catálogo Público'
              : 'Tablilla Oficial de Precios Minoristas en CUP'}
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            Res. 225/2024 MFP · Margen máx. {data.business.max_regulated_margin_pct}% · Decreto 30/2021
            {showFx &&
              ` · Ref. interna: 1 USD = ${rateUsd} CUP · 1 MLC = ${rateMlc} CUP · 1 EUR = ${rateEur} CUP`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canViewCosts && (
            <div className="inline-flex rounded-xl border border-[#D5D0C4] bg-white p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('fichas')}
                className={`rounded-lg px-2.5 py-1.5 font-semibold cursor-pointer ${
                  viewMode === 'fichas' ? 'bg-[#181715] text-white' : 'text-[#4C5561]'
                }`}
              >
                Precios y Catálogo
              </button>
              <button
                type="button"
                onClick={() => setViewMode('tablilla')}
                className={`rounded-lg px-2.5 py-1.5 font-semibold cursor-pointer ${
                  viewMode === 'tablilla' ? 'bg-[#181715] text-white' : 'text-[#4C5561]'
                }`}
              >
                Tablilla CUP
              </button>
              <button
                type="button"
                onClick={() => setViewMode('historial')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-semibold cursor-pointer ${
                  viewMode === 'historial' ? 'bg-[#181715] text-white' : 'text-[#4C5561]'
                }`}
              >
                <History className="h-3 w-3" />
                Historial ({(data.history || []).length})
              </button>
            </div>
          )}

          {data.business?.catalog_enabled !== false && (
            <>
              <button
                type="button"
                onClick={() => setShareModal(true)}
                className="btn-secondary text-xs"
              >
                <QrCode className="h-3.5 w-3.5 text-emerald-700" />
                Enlace / QR Catálogo
              </button>
              {onPreviewCatalog && (
                <button
                  type="button"
                  onClick={() => onPreviewCatalog(companyCode)}
                  className="btn-secondary text-xs"
                >
                  <Globe className="h-3.5 w-3.5 text-emerald-700" />
                  Vista previa
                </button>
              )}
            </>
          )}

          {canEditPrices && (
            <button
              type="button"
              disabled={busy}
              onClick={autoOptimize}
              className="btn-secondary text-xs"
            >
              <Wand2 className="h-3.5 w-3.5 text-[#0F5C4D]" />
              Auto-ajustar MFP
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setViewMode('tablilla');
              setTimeout(() => window.print(), 80);
            }}
            className="btn-primary text-xs"
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimir Tablilla
          </button>
        </div>
      </div>

      {/* Bandeja de propuestas de precio pendientes de aprobación del Jefe */}
      {pendingRequests.length > 0 && canApprovePrices && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 space-y-2.5 no-print">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-extrabold text-amber-950">
              {pendingRequests.length} propuesta(s) de precio pendiente(s) de tu aprobación
            </p>
            <span className="text-[11px] text-amber-800">Enviadas desde Almacén</span>
          </div>
          {pendingRequests.map((pr) => (
            <div
              key={pr.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-amber-200 px-3.5 py-2.5 text-xs"
            >
              <div>
                <p className="font-bold text-slate-900">
                  {pr.sku} — {pr.product_name}:{' '}
                  <span className="text-slate-500 line-through">{formatCup(pr.old_price_cup)}</span>{' '}
                  → <span className="text-emerald-800 font-black">{formatCup(pr.new_price_cup)}</span>
                </p>
                <p className="text-[11px] text-slate-500">
                  Propuesto por <strong>{pr.created_by_name || 'Almacén'}</strong> · Margen{' '}
                  {formatNumber(pr.margin_pct, 1)}% · {pr.reason}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decidePriceRequest(pr.id, 'APROBAR')}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 text-white px-3 py-1.5 font-bold hover:bg-emerald-800 cursor-pointer"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decidePriceRequest(pr.id, 'RECHAZAR')}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white text-red-700 px-3 py-1.5 font-bold hover:bg-red-50 cursor-pointer"
                >
                  <XCircle className="h-3.5 w-3.5" /> Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Franja de Topes Oficiales Res. 225/2024 MFP */}
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

      {/* VISTA 1: FICHAS DE COSTO, MÁRGENES Y PUBLICACIÓN EN CATÁLOGO */}
      {viewMode === 'fichas' && canViewCosts && (
        <div className="card overflow-hidden no-print">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Costo Privado</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Máx. Legal</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Precio Público CUP</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Margen</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Catálogo Público</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Norma MFP</th>
                  {canEditPrices && <th className="px-4 py-2.5 text-right font-semibold">Ajustar</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
                {data.items.map((it) => {
                  const cs = it.cost_sheet || {};
                  const totStock = Number(it.warehouse_stock || 0) + Number(it.kiosk_stock || 0);
                  const marginVal = cs.margin_on_cost_pct ?? cs.margin_pct ?? 0;
                  return (
                    <tr key={it.id} className="hover:bg-[#FAF9F5]">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                            {it.image_url ? (
                              <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" />
                            ) : (
                              <ImageIcon className="h-3.5 w-3.5 text-slate-300" />
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-[#171C22]">{it.name}</p>
                            <p className="text-[11px] text-[#6F7885]">
                              {it.sku} · UM: {it.unit} · Stock: {totStock}
                              {it.compatibility ? ` · ${it.compatibility}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-medium">{formatCup(cs.unit_cost_cup ?? it.unit_cost_cup)}</span>
                        <p className="text-[10px] text-[#7B8491]">
                          Total: {formatCup(cs.full_cost_cup)}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatCup(cs.max_legal_price_cup)}
                        {cs.price_cap_cup ? (
                          <p className="text-[10px] font-bold text-amber-800">
                            Tope {formatCup(cs.price_cap_cup, 0)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-extrabold text-[#171C22]">
                          {formatCup(it.sale_price_cup)}
                        </span>
                        {showFx && (
                          <p className="text-[10px] text-[#7B8491]">
                            ≈ {formatNumber(it.sale_price_cup / rateUsd, 2)} USD ·{' '}
                            {formatNumber(it.sale_price_cup / rateMlc, 2)} MLC
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold">
                        <span
                          className={
                            cs.below_cost
                              ? 'text-red-700'
                              : cs.exceeds_margin
                                ? 'text-amber-800'
                                : 'text-emerald-800'
                          }
                        >
                          {formatNumber(marginVal, 1)}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          disabled={!canPublishCatalog}
                          onClick={() => toggleCatalogPublic(it)}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${
                            it.catalog_visible
                              ? totStock <= 0
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-100 text-emerald-900'
                              : 'bg-stone-100 text-stone-500'
                          } ${canPublishCatalog ? 'hover:opacity-80 cursor-pointer' : ''}`}
                        >
                          {it.catalog_visible ? (
                            <Eye className="h-3 w-3" />
                          ) : (
                            <EyeOff className="h-3 w-3" />
                          )}
                          {!it.catalog_visible
                            ? 'Oculto'
                            : totStock <= 0
                              ? 'Agotado'
                              : 'Público'}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {cs.is_compliant !== false ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-800">
                            <CheckCircle2 className="h-3 w-3" /> Legal
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10.5px] font-semibold text-red-700">
                            <AlertTriangle className="h-3 w-3" /> Revisar
                          </span>
                        )}
                      </td>
                      {canEditPrices && (
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => openEdit(it)}
                            className="btn-secondary text-[11px] py-1 px-2.5"
                          >
                            <Edit3 className="h-3 w-3" /> Editar
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VISTA 2: TABLILLA OFICIAL DE PRECIOS EN CUP (IMPRIMIBLE / PÚBLICA) */}
      {(viewMode === 'tablilla' || !canViewCosts) && (
        <div className="card p-6 sm:p-8 bg-white">
          <div className="text-center border-b-2 border-[#181715] pb-4 mb-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#66707D]">
              República de Cuba · Tablilla Oficial de Precios Minoristas en CUP (Decreto 30 / Res. 225/2024 MFP)
            </p>
            <h2 className="text-xl font-black text-[#181715] mt-1">
              {data.business.business_name} ({data.business.legal_form})
            </h2>
            <p className="text-xs text-[#4C5561] mt-0.5">
              NIT: {data.business.nit} · {data.business.address}, {data.business.municipality},{' '}
              {data.business.province}
            </p>
            <p className="text-xs font-semibold text-[#0F5C4D] mt-1">
              Pago electrónico disponible: Transfermóvil ({data.business.transfermovil_merchant_code || 'activo'}) y
              EnZona ({data.business.enzona_merchant_code || 'activo'})
              {Number(data.business.qr_discount_pct) > 0
                ? ` · Bonificación QR ${data.business.qr_discount_pct}%`
                : ''}
            </p>
          </div>

          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b-2 border-[#181715] text-left">
                <th className="py-2 pr-2">Código</th>
                <th className="py-2 px-2">Producto / Especificación</th>
                <th className="py-2 px-2 text-center">UM</th>
                <th className="py-2 px-2 text-center">Disponibilidad</th>
                <th className="py-2 pl-2 text-right">Precio CUP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E1D7] tabular-nums">
              {data.items.map((it) => {
                const totStock = Number(it.warehouse_stock || 0) + Number(it.kiosk_stock || 0);
                return (
                  <tr key={it.id}>
                    <td className="py-2 pr-2 font-mono text-xs text-[#58616E]">{it.sku}</td>
                    <td className="py-2 px-2">
                      <span className="font-bold text-[#181715]">{it.name}</span>
                      {Boolean(it.is_price_capped) && (
                        <span className="ml-2 text-[10px] font-bold text-[#0F5C4D]">
                          [Regulado Res. 225 · Tope {it.price_cap_cup} CUP]
                        </span>
                      )}
                      {it.compatibility && (
                        <p className="text-[11px] text-[#66707D]">{it.compatibility}</p>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center">{it.unit}</td>
                    <td className="py-2 px-2 text-center text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 font-bold ${
                          totStock > 0
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-stone-100 text-stone-500'
                        }`}
                      >
                        {totStock > 0 ? 'Disponible' : 'Agotado'}
                      </span>
                    </td>
                    <td className="py-2 pl-2 text-right font-black text-[#181715]">
                      {formatCup(it.sale_price_cup)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* VISTA 3: HISTORIAL AUDITADO DE CAMBIOS DE PRECIOS */}
      {viewMode === 'historial' && canViewCosts && (
        <div className="card overflow-hidden no-print">
          <div className="px-4 py-3 border-b border-[#E5E1D7] bg-[#FAF9F5]">
            <h3 className="text-sm font-bold text-[#171C22]">
              Historial de Cambios de Precios (Quién lo hizo y cuándo)
            </h3>
            <p className="text-xs text-[#66707D]">
              Trazabilidad completa ante auditoría interna y revisión MFP / DIS.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
                <tr>
                  <th className="px-4 py-2.5 text-left">Fecha y hora</th>
                  <th className="px-3 py-2.5 text-left">Producto</th>
                  <th className="px-3 py-2.5 text-right">Anterior</th>
                  <th className="px-3 py-2.5 text-right">Nuevo</th>
                  <th className="px-3 py-2.5 text-right">Margen</th>
                  <th className="px-3 py-2.5 text-left">Ejecutado por</th>
                  <th className="px-3 py-2.5 text-left">Motivo</th>
                  <th className="px-4 py-2.5 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
                {(data.history || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-[#7B8491]">
                      Aún no se han registrado cambios de precio en este período.
                    </td>
                  </tr>
                ) : (
                  data.history.map((h) => (
                    <tr key={h.id} className="hover:bg-[#FAF9F5]">
                      <td className="px-4 py-2.5 text-[#58616E] whitespace-nowrap">
                        {formatDateTime(h.created_at)}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-[#171C22]">
                        {h.sku} — {h.product_name}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[#6F7885]">
                        {formatCup(h.old_price_cup)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-[#171C22]">
                        {formatCup(h.new_price_cup)}
                      </td>
                      <td className="px-3 py-2.5 text-right">{formatNumber(h.margin_pct, 1)}%</td>
                      <td className="px-3 py-2.5">
                        <span className="font-semibold text-[#171C22]">
                          {h.created_by_name || 'Sistema'}
                        </span>
                        {h.created_by_role && (
                          <span className="ml-1 text-[10px] text-[#6F7885]">
                            ({ROLE_META[h.created_by_role]?.short || h.created_by_role})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[#58616E] max-w-xs truncate">{h.reason}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            h.status === 'APLICADO'
                              ? 'bg-emerald-50 text-emerald-800'
                              : h.status === 'RECHAZADO'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {h.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Editar Ficha de Costo, Precio y Publicación en Catálogo */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Ficha de Precio — ${editing.sku} ${editing.name}` : ''}
        subtitle={
          editing
            ? `Costo compra: ${formatCup(editing.unit_cost_cup)} · Máx. legal MFP: ${formatCup(editing.cost_sheet?.max_legal_price_cup)}`
            : ''
        }
      >
        {editing && (
          <form onSubmit={savePrice} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-semibold text-slate-700">Precio de venta público (CUP) *</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={form.sale_price_cup}
                  onChange={(e) => setForm({ ...form, sale_price_cup: e.target.value })}
                  className="input-field mt-1 font-bold"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">% Gasto indirecto asignado</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="40"
                  value={form.indirect_cost_pct}
                  onChange={(e) => setForm({ ...form, indirect_cost_pct: e.target.value })}
                  className="input-field mt-1"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_price_capped}
                onChange={(e) => setForm({ ...form, is_price_capped: e.target.checked })}
              />
              Sujeto a precio minorista topado (Res. 225/2024 MFP o Acuerdo CAP)
            </label>

            {form.is_price_capped && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-semibold text-slate-700">Tope oficial (CUP)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.price_cap_cup}
                    onChange={(e) => setForm({ ...form, price_cap_cup: e.target.value })}
                    className="input-field mt-1"
                  />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">Resolución</span>
                  <input
                    value={form.price_cap_resolution}
                    onChange={(e) => setForm({ ...form, price_cap_resolution: e.target.value })}
                    className="input-field mt-1"
                  />
                </label>
              </div>
            )}

            {canPublishCatalog && (
              <label className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.catalog_visible}
                  onChange={(e) => setForm({ ...form, catalog_visible: e.target.checked })}
                  className="h-4 w-4 accent-emerald-700"
                />
                <div>
                  <p className="font-bold text-emerald-950">Publicado en Catálogo público</p>
                  <p className="text-[10.5px] text-emerald-800">
                    El cliente verá este precio CUP y su foto (el costo y margen jamás se exponen).
                  </p>
                </div>
              </label>
            )}

            <label className="block">
              <span className="font-semibold text-slate-700">Motivo del cambio (queda en historial)</span>
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className="input-field mt-1"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="btn-secondary text-xs"
              >
                Cancelar
              </button>
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                {busy ? 'Guardando...' : 'Guardar y sincronizar'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Enlace y QR del Catálogo Público */}
      <Modal
        open={shareModal}
        onClose={() => setShareModal(false)}
        title="Enlace del Catálogo Público de Clientes"
        subtitle="Comparte esta dirección o muéstrala al cliente para que vea fotos, precios en CUP y pida por WhatsApp"
      >
        <div className="space-y-4 text-xs">
          <div className="rounded-xl bg-[#FAF8F4] border border-[#E2DDD1] p-3.5 space-y-2">
            <p className="text-[11px] font-bold text-[#66707D]">Enlace público directo</p>
            <p className="font-mono text-[11.5px] text-[#181715] break-all bg-white border border-[#E5E1D7] rounded-lg px-3 py-2">
              {catalogUrl}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={handleCopyCatalog} className="btn-primary text-xs">
                {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedLink ? 'Enlace copiado' : 'Copiar enlace'}
              </button>
              {onPreviewCatalog && (
                <button
                  type="button"
                  onClick={() => {
                    setShareModal(false);
                    onPreviewCatalog(companyCode);
                  }}
                  className="btn-secondary text-xs"
                >
                  <Globe className="h-3.5 w-3.5 text-emerald-700" />
                  Abrir vista cliente
                </button>
              )}
            </div>
          </div>
          <p className="text-[11px] text-[#66707D]">
            Privacidad garantizada: el cliente solo ve foto optimizada, nombre, compatibilidad/descripción, precio CUP y disponibilidad («Disponible» / «Agotado»). Nunca se muestran costos, proveedores ni mermas.
          </p>
        </div>
      </Modal>
    </div>
  );
}

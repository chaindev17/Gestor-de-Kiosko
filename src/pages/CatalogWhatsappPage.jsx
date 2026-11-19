import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bike,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  MessageCircle,
  Package,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  Share2,
  ShoppingBag,
  Star,
  Store,
  XCircle,
} from 'lucide-react';
import { api, isStaticBackend } from '../lib/api.js';
import { formatCup, formatDateTime, formatNumber } from '../lib/format.js';
import { hasPermissionFlag } from '../lib/permissions.js';
import {
  ORDER_STATUS_META,
  PAYMENT_LABELS,
  buildCatalogUrl,
  buildWhatsappUrl,
  encodeCatalogSnapshot,
  getCategoryVisual,
  sanitizeWhatsappDigits,
} from '../lib/whatsapp.js';
import QrCodeBadge from '../components/QrCodeBadge.jsx';
import Modal from '../components/Modal.jsx';
import ImagePickerField from '../components/ImagePickerField.jsx';

const DEFAULT_CATEGORIES = [
  'Cárnicos y Embutidos',
  'Alimentos Básicos',
  'Bebidas y Refrescos',
  'Lácteos',
  'Panadería y Confituras',
  'Aseo y Hogar',
  'Frutas y Verduras',
  'General',
];

export default function CatalogWhatsappPage({
  user,
  config,
  initialTab = 'orders',
  onPreviewCatalog,
  onRefreshBadges,
  onConfigUpdated,
  notify,
}) {
  const canSeeCost =
    hasPermissionFlag(user, config, 'view_costs') ||
    hasPermissionFlag(user, config, 'view_entry_cost');
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [orderFilter, setOrderFilter] = useState('ACTIVOS');
  const [prodSearch, setProdSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Settings form
  const [settingsForm, setSettingsForm] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Quick add / edit product modal
  const [addOpen, setAddOpen] = useState(false);
  const [newProd, setNewProd] = useState({
    name: '',
    category: 'Alimentos Básicos',
    unit: 'u',
    sale_price_cup: '',
    initial_stock: '20',
    unit_cost_cup: '',
    catalog_description: '',
    image_url: '',
    catalog_featured: false,
  });
  const [editingProd, setEditingProd] = useState(null);
  const [savingProd, setSavingProd] = useState(false);

  // Printable QR modal
  const [qrModalOpen, setQrModalOpen] = useState(false);

  const canManageCatalog = ['jefe', 'almacenero', 'economico'].includes(user.role);
  const canEditPrices = user.role === 'jefe' || user.role === 'economico';
  const canEditSettings = user.role === 'jefe' || user.role === 'economico';
  const canCheckout = user.role === 'jefe' || user.role === 'vendedor';

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/catalog-admin/overview');
      setData(res);
      setSettingsForm(res.settings);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // Shareable URL: clean short URL for QR & server, plus portable snapshot on static deployments for non-demo companies
  const shortCatalogUrl = useMemo(
    () => (data ? buildCatalogUrl(data.company_code) : ''),
    [data]
  );

  const shareableCatalogUrl = useMemo(() => {
    if (!data) return '';
    if (isStaticBackend() && data.company_code !== 'kiosko-CEIBA1' && data.public_preview) {
      const snap = encodeCatalogSnapshot(data.public_preview);
      if (snap && snap.length < 3500) {
        return buildCatalogUrl(data.company_code, { snapshot: snap });
      }
    }
    return shortCatalogUrl;
  }, [data, shortCatalogUrl]);

  function copyLink() {
    navigator.clipboard?.writeText(shareableCatalogUrl);
    setCopied(true);
    notify('¡Link del catálogo copiado! Pégalo en tu WhatsApp, estado o Instagram.');
    setTimeout(() => setCopied(false), 2400);
  }

  function shareOnWhatsapp() {
    const biz = data?.settings?.business_name || 'nuestro local';
    const msg = `¡Hola! 👋 Mira el catálogo actualizado de *${biz}*, arma tu pedido en segundos y envíamelo por aquí:\n${shareableCatalogUrl}`;
    window.open(buildWhatsappUrl('', msg), '_blank', 'noopener,noreferrer');
  }

  async function handleStatusChange(order, nextStatus, openWa = false) {
    setBusyId(order.id);
    try {
      const res = await api.put(`/api/catalog-admin/orders/${order.id}/status`, { status: nextStatus });
      notify(`Pedido ${order.order_code} marcado como ${ORDER_STATUS_META[nextStatus]?.label || nextStatus}.`);
      if (openWa && res.customer_whatsapp_url) {
        window.open(res.customer_whatsapp_url, '_blank', 'noopener,noreferrer');
      }
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCheckoutOrder(order) {
    setBusyId(order.id);
    try {
      const res = await api.post(`/api/catalog-admin/orders/${order.id}/checkout`, {
        payment_method: order.payment_method,
      });
      notify(
        `¡Pedido ${order.order_code} cobrado! Comprobante ${res.receipt_number} (${formatCup(res.total_cup)}) y stock descontado.`
      );
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleProductFlag(prod, field) {
    try {
      await api.put(`/api/catalog-admin/products/${prod.id}`, {
        [field]: !prod[field],
      });
      await load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function handleCreateQuickProduct(e) {
    e.preventDefault();
    setSavingProd(true);
    try {
      await api.post('/api/catalog-admin/products/quick', {
        name: newProd.name,
        category: newProd.category,
        compatibility: newProd.compatibility || '',
        unit: newProd.unit,
        sale_price_cup: Number(newProd.sale_price_cup),
        initial_stock: Number(newProd.initial_stock || 0),
        unit_cost_cup: newProd.unit_cost_cup ? Number(newProd.unit_cost_cup) : undefined,
        catalog_description: newProd.catalog_description,
        image_url: newProd.image_url,
        catalog_featured: newProd.catalog_featured,
      });
      notify(`"${newProd.name}" agregado al catálogo y a la caja.`);
      setAddOpen(false);
      setNewProd({
        name: '',
        category: 'Alimentos Básicos',
        compatibility: '',
        unit: 'u',
        sale_price_cup: '',
        initial_stock: '20',
        unit_cost_cup: '',
        catalog_description: '',
        image_url: '',
        catalog_featured: false,
      });
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingProd(false);
    }
  }

  async function handleSaveEditProduct(e) {
    e.preventDefault();
    if (!editingProd) return;
    setSavingProd(true);
    try {
      const payload = {
        name: editingProd.name,
        category: editingProd.category,
        compatibility: editingProd.compatibility || '',
        catalog_description: editingProd.catalog_description,
        image_url: editingProd.image_url,
        catalog_visible: editingProd.catalog_visible,
        catalog_featured: editingProd.catalog_featured,
      };
      if (canEditPrices) {
        payload.sale_price_cup = Number(editingProd.sale_price_cup);
      }
      await api.put(`/api/catalog-admin/products/${editingProd.id}`, payload);
      notify(`"${editingProd.name}" actualizado.`);
      setEditingProd(null);
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingProd(false);
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    if (!settingsForm) return;
    setSavingSettings(true);
    try {
      const res = await api.put('/api/catalog-admin/settings', settingsForm);
      notify('Configuración de tu catálogo y WhatsApp guardada.');
      onConfigUpdated?.(res.config);
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingSettings(false);
    }
  }

  const visibleOrders = useMemo(() => {
    const all = data?.orders || [];
    if (orderFilter === 'ACTIVOS') {
      return all.filter((o) => ['NUEVO', 'PREPARANDO', 'LISTO'].includes(o.status));
    }
    if (orderFilter === 'ENTREGADOS') {
      return all.filter((o) => o.status === 'ENTREGADO');
    }
    return all;
  }, [data, orderFilter]);

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    const list = data?.products || [];
    if (!q) return list;
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
  }, [data, prodSearch]);

  if (loading && !data) {
    return (
      <div className="py-16 text-center text-sm text-[#6E685F]">
        Cargando tu catálogo y pedidos de WhatsApp...
      </div>
    );
  }
  if (!data) return null;

  const hasWaNumber = sanitizeWhatsappDigits(data.settings.whatsapp_phone).length >= 7;
  const liveWaDigits = sanitizeWhatsappDigits(settingsForm?.whatsapp_phone || '');

  return (
    <div className="space-y-5">
      {/* Header + 1-click Share Controls */}
      <div className="rounded-3xl bg-white border border-[#E7E1D6] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  data.settings.catalog_enabled
                    ? 'bg-[#E6F5EF] text-[#15614B]'
                    : 'bg-[#F3EFE7] text-[#6E685F]'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    data.settings.catalog_enabled ? 'bg-[#1DA851]' : 'bg-[#8A8379]'
                  }`}
                />
                {data.settings.catalog_enabled ? 'Catálogo activo' : 'Catálogo en pausa'}
              </span>
              {hasWaNumber ? (
                <span className="text-xs text-[#5E584F]">
                  Recibiendo en WhatsApp <strong className="text-[#181715]">{data.settings.whatsapp_phone}</strong>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setTab('settings')}
                  className="text-xs font-semibold text-[#C2542D] hover:underline cursor-pointer"
                >
                  ⚠️ Falta cargar tu número de WhatsApp → Configurarlo
                </button>
              )}
            </div>
            <h1 className="mt-1.5 font-editorial text-3xl sm:text-4xl text-[#181715]">
              Catálogo y Pedidos por WhatsApp
            </h1>
            <p className="mt-1 text-sm text-[#6E685F]">
              Comparte tu link o QR: el cliente elige sus productos, te llega el pedido armado a tu WhatsApp y lo cobras en 1 clic.
            </p>
          </div>

          {/* 3 unmistakable primary actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onPreviewCatalog?.(data.company_code)}
              className="btn-secondary rounded-full text-xs py-2.5 px-4"
            >
              <Eye className="h-4 w-4" />
              Ver como cliente
            </button>
            <button
              type="button"
              onClick={copyLink}
              className="btn-secondary rounded-full text-xs py-2.5 px-4"
            >
              {copied ? <Check className="h-4 w-4 text-[#15614B]" /> : <Copy className="h-4 w-4" />}
              {copied ? '¡Link copiado!' : 'Copiar link'}
            </button>
            <button
              type="button"
              onClick={shareOnWhatsapp}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1DA851] hover:bg-[#178F44] text-white font-semibold text-xs px-4 py-2.5 shadow-xs transition cursor-pointer"
            >
              <Share2 className="h-4 w-4" />
              Enviar catálogo por WhatsApp
            </button>
            <button
              type="button"
              onClick={() => setQrModalOpen(true)}
              className="btn-secondary rounded-full text-xs py-2.5 px-3.5"
              title="Ver e imprimir cartel QR para el mostrador"
            >
              <QrCode className="h-4 w-4" />
              QR
            </button>
          </div>
        </div>

        {/* Clean 3-tab navigation */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#F3EFE7]">
          <button
            type="button"
            onClick={() => setTab('orders')}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition cursor-pointer ${
              tab === 'orders'
                ? 'bg-[#181715] text-white'
                : 'bg-[#FAF8F4] text-[#4A463F] hover:bg-[#F3EFE7]'
            }`}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Pedidos entrantes
            {data.stats.active_count > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                  tab === 'orders' ? 'bg-[#1DA851] text-white' : 'bg-[#C2542D] text-white'
                }`}
              >
                {data.stats.active_count}
              </span>
            )}
          </button>

          {canManageCatalog && (
            <button
              type="button"
              onClick={() => setTab('products')}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition cursor-pointer ${
                tab === 'products'
                  ? 'bg-[#181715] text-white'
                  : 'bg-[#FAF8F4] text-[#4A463F] hover:bg-[#F3EFE7]'
              }`}
            >
              <Package className="h-3.5 w-3.5" />
              Productos del catálogo
              <span
                className={`text-[11px] ${tab === 'products' ? 'text-[#C8C2B7]' : 'text-[#8A8379]'}`}
              >
                {data.stats.visible_products}/{data.stats.total_products}
              </span>
            </button>
          )}

          {canEditSettings && (
            <button
              type="button"
              onClick={() => setTab('settings')}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition cursor-pointer ${
                tab === 'settings'
                  ? 'bg-[#181715] text-white'
                  : 'bg-[#FAF8F4] text-[#4A463F] hover:bg-[#F3EFE7]'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              Mi WhatsApp, Envío y QR
            </button>
          )}

          <button
            type="button"
            onClick={load}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[#6E685F] hover:text-[#181715] hover:bg-[#F3EFE7] cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizar
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: INCOMING WHATSAPP ORDERS                                     */}
      {/* =================================================================== */}
      {tab === 'orders' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {[
                { id: 'ACTIVOS', label: `Por atender (${data.stats.active_count})` },
                { id: 'ENTREGADOS', label: `Entregados (${data.stats.delivered_count})` },
                { id: 'TODOS', label: `Todos (${data.orders.length})` },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setOrderFilter(f.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    orderFilter === f.id
                      ? 'bg-[#15614B] text-white'
                      : 'bg-white border border-[#E7E1D6] text-[#5E584F] hover:border-[#C9C0B1]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {data.stats.delivered_total_cup > 0 && (
              <p className="text-xs text-[#6E685F]">
                Vendido por catálogo:{' '}
                <strong className="text-[#181715]">{formatCup(data.stats.delivered_total_cup)}</strong>
              </p>
            )}
          </div>

          {visibleOrders.length === 0 ? (
            <div className="card p-10 text-center space-y-4">
              <div className="h-14 w-14 mx-auto rounded-2xl bg-[#E6F5EF] text-[#15614B] flex items-center justify-center">
                <MessageCircle className="h-7 w-7" />
              </div>
              <div className="max-w-md mx-auto">
                <h2 className="font-editorial text-2xl text-[#181715]">
                  {orderFilter === 'ACTIVOS'
                    ? 'Todo al día — no hay pedidos pendientes'
                    : 'Aún no hay pedidos en esta vista'}
                </h2>
                <p className="mt-1 text-sm text-[#6E685F]">
                  Comparte el enlace de tu catálogo por WhatsApp o prueba hacer un pedido como cliente para ver cómo llega.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onPreviewCatalog?.(data.company_code)}
                  className="btn-pill text-xs py-2.5 px-5"
                >
                  <Eye className="h-4 w-4" />
                  Probar armar un pedido
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  className="btn-pill-outline text-xs py-2.5 px-5"
                >
                  <Copy className="h-4 w-4" />
                  Copiar link del catálogo
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {visibleOrders.map((o) => {
                const meta = ORDER_STATUS_META[o.status] || ORDER_STATUS_META.NUEVO;
                const isActive = ['NUEVO', 'PREPARANDO', 'LISTO'].includes(o.status);
                const changeNeeded =
                  o.payment_method === 'EFECTIVO' && Number(o.cash_tendered_cup) > Number(o.total_cup)
                    ? Math.round((Number(o.cash_tendered_cup) - Number(o.total_cup)) * 100) / 100
                    : 0;

                return (
                  <article
                    key={o.id}
                    className={`rounded-2xl bg-white border p-5 flex flex-col justify-between gap-4 ${
                      o.status === 'NUEVO'
                        ? 'border-[#C2542D]/50 ring-2 ring-[#C2542D]/10'
                        : 'border-[#E7E1D6]'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Top row */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-extrabold text-[#181715]">
                              {o.order_code}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${meta.badge}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                              {meta.label}
                            </span>
                            {o.receipt_number && (
                              <span className="rounded-full bg-[#E6F5EF] text-[#15614B] px-2 py-0.5 text-[10px] font-mono font-semibold">
                                Cobrado · {o.receipt_number}
                              </span>
                            )}
                          </div>
                          <h3 className="mt-1.5 text-base font-bold text-[#181715]">{o.customer_name}</h3>
                          <p className="text-xs text-[#6E685F]">
                            {o.customer_phone ? `${o.customer_phone} · ` : ''}
                            {formatDateTime(o.created_at)}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-lg font-extrabold text-[#181715] tabular-nums">
                            {formatCup(o.total_cup)}
                          </p>
                          <p className="text-[11px] font-medium text-[#6E685F]">
                            {PAYMENT_LABELS[o.payment_method] || o.payment_method}
                          </p>
                          {changeNeeded > 0 && (
                            <p className="text-[11px] font-semibold text-[#15614B]">
                              Llevar vuelto: {formatCup(changeNeeded, 0)}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Delivery badge */}
                      <div className="rounded-xl bg-[#FAF8F4] border border-[#ECE6DA] px-3 py-2 text-xs flex items-start gap-2">
                        {o.delivery_mode === 'DOMICILIO' ? (
                          <>
                            <Bike className="h-4 w-4 text-[#C2542D] shrink-0 mt-0.5" />
                            <div>
                              <strong className="text-[#181715]">Envío a domicilio</strong>
                              {Number(o.delivery_fee_cup) > 0 && (
                                <span className="text-[#6E685F]">
                                  {' '}
                                  (incluye {formatCup(o.delivery_fee_cup, 0)} de envío)
                                </span>
                              )}
                              <p className="text-[#4A463F]">{o.delivery_address}</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <Store className="h-4 w-4 text-[#15614B] shrink-0 mt-0.5" />
                            <span className="font-semibold text-[#181715]">Retira en el local</span>
                          </>
                        )}
                      </div>

                      {/* Order items */}
                      <ul className="space-y-1 text-xs">
                        {(o.items || []).map((it) => (
                          <li key={it.id} className="flex items-center justify-between gap-2 text-[#2E2C28]">
                            <span>
                              <strong className="font-bold">{formatNumber(it.quantity)}×</strong>{' '}
                              {it.product_name}
                            </span>
                            <span className="tabular-nums text-[#6E685F]">{formatCup(it.subtotal_cup)}</span>
                          </li>
                        ))}
                      </ul>

                      {o.notes && (
                        <p className="rounded-xl bg-[#FEF8E8] border border-[#F0DFB4] px-3 py-2 text-xs text-[#6E4E0E]">
                          <strong>Nota:</strong> {o.notes}
                        </p>
                      )}
                    </div>

                    {/* Clear Action Row */}
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#F3EFE7]">
                      {o.customer_whatsapp_url && (
                        <a
                          href={o.customer_whatsapp_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EF] hover:bg-[#D4EDE2] text-[#15614B] font-bold text-xs px-3.5 py-2 transition"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          Avisar por WhatsApp
                        </a>
                      )}

                      {isActive && o.status === 'NUEVO' && (
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => handleStatusChange(o, 'PREPARANDO', false)}
                          className="btn-secondary rounded-full text-xs py-2 px-3.5"
                        >
                          Preparar
                        </button>
                      )}

                      {isActive && o.status === 'PREPARANDO' && (
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => handleStatusChange(o, 'LISTO', false)}
                          className="btn-secondary rounded-full text-xs py-2 px-3.5"
                        >
                          Marcar listo
                        </button>
                      )}

                      {isActive && canCheckout && !o.sale_id && (
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => handleCheckoutOrder(o)}
                          className="btn-primary rounded-full text-xs py-2 px-4 ml-auto"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Cobrar y descontar stock
                        </button>
                      )}

                      {isActive && (
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => handleStatusChange(o, 'CANCELADO', false)}
                          className="rounded-full p-2 text-[#968F84] hover:text-[#9E2A2B] hover:bg-[#FBEAEA] transition cursor-pointer"
                          title="Cancelar pedido"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: CATALOG PRODUCTS (SUPER EASY VISUAL TOGGLES)                 */}
      {/* =================================================================== */}
      {tab === 'products' && canManageCatalog && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="h-4 w-4 text-[#8A8379] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={prodSearch}
                onChange={(e) => setProdSearch(e.target.value)}
                placeholder="Buscar producto..."
                className="input-field bg-white pl-10 rounded-full"
              />
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="btn-primary rounded-full text-xs py-2.5 px-5"
            >
              <Plus className="h-4 w-4" />
              Agregar producto rápido
            </button>
          </div>

          <p className="text-xs text-[#6E685F]">
            Los productos y precios están sincronizados con tu caja y almacén. Usa los botones para mostrar u ocultar en el catálogo o destacar tus favoritos arriba del todo.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredProducts.map((p) => {
              const vis = getCategoryVisual(p.category);
              return (
                <div
                  key={p.id}
                  className={`rounded-2xl bg-white border p-4 flex flex-col justify-between gap-3 transition ${
                    p.catalog_visible ? 'border-[#E7E1D6]' : 'border-dashed border-[#D8D1C4] opacity-65'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        className="h-12 w-12 rounded-xl object-cover border border-[#E7E1D6] shrink-0"
                      />
                    ) : (
                      <div
                        className={`h-12 w-12 rounded-xl ${vis.bg} flex items-center justify-center text-xl shrink-0`}
                      >
                        {vis.emoji}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-[#181715] leading-snug">{p.name}</p>
                      <p className="text-[11px] text-[#8A8379]">
                        {p.category} · Disponible: <strong>{formatNumber(p.available_stock)} {p.unit}</strong>
                      </p>
                      {p.catalog_description && (
                        <p className="mt-1 text-xs text-[#5E584F] line-clamp-1">{p.catalog_description}</p>
                      )}
                    </div>
                    <p className="text-sm font-extrabold text-[#181715] tabular-nums shrink-0">
                      {formatCup(p.sale_price_cup, 0)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-1.5 pt-2.5 border-t border-[#F3EFE7]">
                    <button
                      type="button"
                      onClick={() => toggleProductFlag(p, 'catalog_visible')}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition cursor-pointer ${
                        p.catalog_visible
                          ? 'bg-[#E6F5EF] text-[#15614B]'
                          : 'bg-[#F3EFE7] text-[#6E685F]'
                      }`}
                    >
                      {p.catalog_visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      {p.catalog_visible ? 'En catálogo' : 'Oculto'}
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleProductFlag(p, 'catalog_featured')}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition cursor-pointer ${
                        p.catalog_featured
                          ? 'bg-[#FEF4E0] text-[#945B10]'
                          : 'bg-[#FAF8F4] text-[#8A8379] hover:text-[#181715]'
                      }`}
                    >
                      <Star className={`h-3.5 w-3.5 ${p.catalog_featured ? 'fill-current' : ''}`} />
                      {p.catalog_featured ? 'Destacado' : 'Destacar'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingProd({ ...p })}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold text-[#4A463F] hover:bg-[#F3EFE7] cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Editar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: WHATSAPP NUMBER, DELIVERY OPTIONS & COUNTER QR CARD          */}
      {/* =================================================================== */}
      {tab === 'settings' && canEditSettings && settingsForm && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <form onSubmit={handleSaveSettings} className="card p-6 lg:col-span-7 space-y-5">
            <div>
              <p className="kicker">Paso clave</p>
              <h2 className="font-editorial text-2xl text-[#181715]">
                ¿A qué WhatsApp llegan los pedidos?
              </h2>
            </div>

            {/* Big friendly WhatsApp field */}
            <div className="rounded-2xl bg-[#EDF7ED] border border-[#C6E4C6] p-4 space-y-2.5">
              <label className="block text-xs font-bold text-[#18261C]">
                Tu número de WhatsApp (con código de país)
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  type="tel"
                  className="input-field bg-white flex-1 min-w-[200px] text-base font-semibold"
                  placeholder="Ej: +598 99 123 456  o  +53 5 284 9102"
                  value={settingsForm.whatsapp_phone}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, whatsapp_phone: e.target.value })
                  }
                />
                {liveWaDigits.length >= 7 && (
                  <a
                    href={buildWhatsappUrl(
                      settingsForm.whatsapp_phone,
                      `¡Prueba exitosa! Aquí recibiré los pedidos del catálogo de ${settingsForm.business_name}.`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#1DA851] hover:bg-[#178F44] text-white text-xs font-bold px-4 py-2.5"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Probar
                  </a>
                )}
              </div>
              <p className="text-[11px] text-[#2B5938]">
                {liveWaDigits.length >= 7
                  ? `✓ Enlace activo: wa.me/${liveWaDigits} — cada pedido se abrirá listo en tu chat.`
                  : 'Escribe tu celular con código de país (+598 Uruguay, +53 Cuba, +54 Argentina, +34 España, +1 EE.UU.).'}
              </p>
            </div>

            {/* Open / Pause toggle */}
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-[#E7E1D6] p-3.5 cursor-pointer">
              <div>
                <p className="text-sm font-bold text-[#181715]">Recibir pedidos en el catálogo</p>
                <p className="text-xs text-[#6E685F]">
                  Si cierras por hoy, puedes pausarlo sin borrar tus productos.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[#15614B]"
                checked={Boolean(settingsForm.catalog_enabled)}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, catalog_enabled: e.target.checked })
                }
              />
            </label>

            {/* Welcome, Hours & Address */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#181715] mb-1">
                  Mensaje de bienvenida para tus clientes
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Armá tu pedido y envialo directo a nuestro WhatsApp."
                  value={settingsForm.catalog_welcome}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, catalog_welcome: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#181715] mb-1">
                  Horario visible
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Todos los días · 8:00 a 22:00"
                  value={settingsForm.catalog_hours}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, catalog_hours: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#181715] mb-1">
                  Dirección del local
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={settingsForm.address}
                  onChange={(e) => setSettingsForm({ ...settingsForm, address: e.target.value })}
                />
              </div>
            </div>

            {/* Pickup & Delivery */}
            <div className="space-y-3 pt-2 border-t border-[#F3EFE7]">
              <p className="text-xs font-bold uppercase tracking-wider text-[#8A8379]">
                Entrega y envío
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center justify-between gap-2 rounded-2xl border border-[#E7E1D6] p-3 cursor-pointer">
                  <span className="text-xs font-bold text-[#181715]">🏪 Retiro en el local</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#15614B]"
                    checked={Boolean(settingsForm.catalog_allow_pickup)}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, catalog_allow_pickup: e.target.checked })
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-2xl border border-[#E7E1D6] p-3 cursor-pointer">
                  <span className="text-xs font-bold text-[#181715]">🛵 Envío a domicilio</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#15614B]"
                    checked={Boolean(settingsForm.catalog_allow_delivery)}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, catalog_allow_delivery: e.target.checked })
                    }
                  />
                </label>
              </div>

              {settingsForm.catalog_allow_delivery && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl bg-[#FAF8F4] border border-[#E7E1D6] p-3.5">
                  <div>
                    <label className="block text-xs font-medium text-[#4A463F] mb-1">
                      Costo de envío (0 = gratis)
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="input-field bg-white"
                      value={settingsForm.catalog_delivery_fee_cup}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          catalog_delivery_fee_cup: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#4A463F] mb-1">
                      Envío gratis desde (0 = no aplica)
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="input-field bg-white"
                      value={settingsForm.catalog_free_delivery_from_cup}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          catalog_free_delivery_from_cup: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Stock preferences */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#F3EFE7]">
              <label className="flex items-center justify-between gap-2 rounded-2xl border border-[#E7E1D6] p-3 cursor-pointer">
                <span className="text-xs font-medium text-[#181715]">Mostrar productos agotados</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#15614B]"
                  checked={Boolean(settingsForm.catalog_show_out_of_stock)}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      catalog_show_out_of_stock: e.target.checked,
                    })
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-2xl border border-[#E7E1D6] p-3 cursor-pointer">
                <span className="text-xs font-medium text-[#181715]">Mostrar cantidad exacta de stock</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#15614B]"
                  checked={Boolean(settingsForm.catalog_show_stock_qty)}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      catalog_show_stock_qty: e.target.checked,
                    })
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-2xl border border-[#E7E1D6] p-3 cursor-pointer">
                <span className="text-xs font-medium text-[#181715]">Permitir encargo sin stock</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#15614B]"
                  checked={Boolean(settingsForm.catalog_allow_backorder)}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      catalog_allow_backorder: e.target.checked,
                    })
                  }
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="btn-pill w-full sm:w-auto"
            >
              {savingSettings ? 'Guardando...' : 'Guardar configuración'}
            </button>
          </form>

          {/* Counter QR Card — pure Conecta vibe! */}
          <div className="card p-6 lg:col-span-5 text-center space-y-4">
            <p className="kicker">Para tu mostrador y redes</p>
            <h3 className="font-editorial text-2xl text-[#181715]">
              Escaneá y pedí por WhatsApp
            </h3>
            <div className="inline-flex p-4 rounded-3xl bg-[#FAF8F4] border border-[#E7E1D6]">
              <QrCodeBadge value={shortCatalogUrl} size={172} />
            </div>
            <p className="text-xs text-[#6E685F] max-w-xs mx-auto">
              Pon este QR en la vidriera o el mostrador, o pega el link en tu estado de WhatsApp e Instagram.
            </p>
            <div className="rounded-xl bg-[#FAF8F4] border border-[#E7E1D6] px-3 py-2 text-[11px] font-mono text-[#4A463F] truncate">
              {shortCatalogUrl}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={copyLink} className="btn-secondary rounded-full text-xs py-2.5">
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copiado' : 'Copiar link'}
              </button>
              <button
                type="button"
                onClick={() => setQrModalOpen(true)}
                className="btn-primary rounded-full text-xs py-2.5"
              >
                <Printer className="h-3.5 w-3.5" />
                Imprimir cartel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Product Modal — 4 effortless fields! */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Agregar producto al catálogo y caja"
      >
        <form onSubmit={handleCreateQuickProduct} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#181715] mb-1">Nombre del producto *</label>
            <input
              type="text"
              required
              autoFocus
              className="input-field"
              placeholder="Ej: Empanada de jamón y queso"
              value={newProd.name}
              onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#181715] mb-1">Precio de venta *</label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                className="input-field"
                placeholder="250"
                value={newProd.sale_price_cup}
                onChange={(e) => setNewProd({ ...newProd, sale_price_cup: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#181715] mb-1">Stock disponible</label>
              <input
                type="number"
                step="1"
                min="0"
                className="input-field"
                value={newProd.initial_stock}
                onChange={(e) => setNewProd({ ...newProd, initial_stock: e.target.value })}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-bold text-[#181715] mb-1">Unidad</label>
              <select
                className="input-field"
                value={newProd.unit}
                onChange={(e) => setNewProd({ ...newProd, unit: e.target.value })}
              >
                <option value="u">Unidad (c/u)</option>
                <option value="kg">Kilogramo (kg)</option>
                <option value="lb">Libra (lb)</option>
                <option value="L">Litro (L)</option>
                <option value="paq">Paquete</option>
                <option value="lata">Lata</option>
                <option value="bot">Botella</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#181715] mb-1">Categoría</label>
              <input
                type="text"
                list="catalog-categories"
                className="input-field"
                value={newProd.category}
                onChange={(e) => setNewProd({ ...newProd, category: e.target.value })}
              />
              <datalist id="catalog-categories">
                {DEFAULT_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            {canSeeCost && (
              <div>
                <label className="block text-xs font-semibold text-[#6E685F] mb-1">
                  Costo unitario (opcional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input-field"
                  placeholder="Se calcula solo si lo dejas vacío"
                  value={newProd.unit_cost_cup}
                  onChange={(e) => setNewProd({ ...newProd, unit_cost_cup: e.target.value })}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#6E685F] mb-1">
              Compatibilidad / Formato / Especificación (opcional)
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Ej: Botella 1L · Modelo universal · Talla M"
              value={newProd.compatibility || ''}
              onChange={(e) => setNewProd({ ...newProd, compatibility: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#6E685F] mb-1">
              Descripción breve para el cliente (opcional)
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Ej: Recién horneada, entrega inmediata"
              value={newProd.catalog_description}
              onChange={(e) => setNewProd({ ...newProd, catalog_description: e.target.value })}
            />
          </div>

          <ImagePickerField
            value={newProd.image_url || ''}
            onChange={(img) => setNewProd((p) => ({ ...p, image_url: img }))}
            label="Foto del producto (subir o tomar con cámara · ≤800×800 WebP/JPEG)"
          />

          <label className="flex items-center gap-2 text-xs font-semibold text-[#181715] cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#15614B]"
              checked={newProd.catalog_featured}
              onChange={(e) => setNewProd({ ...newProd, catalog_featured: e.target.checked })}
            />
            ⭐ Destacar arriba del todo en el catálogo
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="btn-secondary rounded-full text-xs"
            >
              Cancelar
            </button>
            <button type="submit" disabled={savingProd} className="btn-primary rounded-full text-xs px-5">
              {savingProd ? 'Guardando...' : 'Publicar producto'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Product Modal */}
      <Modal
        open={Boolean(editingProd)}
        onClose={() => setEditingProd(null)}
        title="Editar producto del catálogo"
      >
        {editingProd && (
          <form onSubmit={handleSaveEditProduct} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#181715] mb-1">Nombre</label>
              <input
                type="text"
                required
                className="input-field"
                value={editingProd.name}
                onChange={(e) => setEditingProd({ ...editingProd, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#181715] mb-1">Categoría</label>
                <input
                  type="text"
                  list="catalog-categories"
                  className="input-field"
                  value={editingProd.category}
                  onChange={(e) => setEditingProd({ ...editingProd, category: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#181715] mb-1">Precio de venta</label>
                <input
                  type="number"
                  step="0.01"
                  disabled={!canEditPrices}
                  className="input-field"
                  value={editingProd.sale_price_cup}
                  onChange={(e) =>
                    setEditingProd({ ...editingProd, sale_price_cup: e.target.value })
                  }
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#181715] mb-1">
                Compatibilidad / Especificaciones
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej: Formato 1 kg · Compatible con modelo X"
                value={editingProd.compatibility || ''}
                onChange={(e) =>
                  setEditingProd({ ...editingProd, compatibility: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#181715] mb-1">
                Descripción para el cliente
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="Breve detalle que verá el cliente en el catálogo"
                value={editingProd.catalog_description || ''}
                onChange={(e) =>
                  setEditingProd({ ...editingProd, catalog_description: e.target.value })
                }
              />
            </div>
            <ImagePickerField
              value={editingProd.image_url || ''}
              onChange={(img) => setEditingProd((p) => ({ ...p, image_url: img }))}
              label="Foto del producto (subir o tomar con cámara · ≤800×800 WebP/JPEG)"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProd(null)}
                className="btn-secondary rounded-full text-xs"
              >
                Cancelar
              </button>
              <button type="submit" disabled={savingProd} className="btn-primary rounded-full text-xs px-5">
                {savingProd ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Printable Counter QR Sign Modal */}
      <Modal
        open={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        title="Cartel QR para tu mostrador"
      >
        <div className="text-center space-y-4 py-2">
          <div className="rounded-3xl border-2 border-[#181715] bg-[#FAF8F4] p-7 space-y-4">
            <p className="kicker">Catálogo Digital</p>
            <h3 className="font-editorial text-3xl text-[#181715]">
              {data.settings.business_name}
            </h3>
            <div className="inline-flex p-4 bg-white rounded-2xl border border-[#E7E1D6]">
              <QrCodeBadge value={shortCatalogUrl} size={196} />
            </div>
            <p className="text-sm font-semibold text-[#181715]">
              Escaneá con tu cámara, armá tu pedido y envialo a nuestro WhatsApp
            </p>
            {data.settings.whatsapp_phone && (
              <p className="text-xs font-mono text-[#15614B] font-bold">
                WhatsApp: {data.settings.whatsapp_phone}
              </p>
            )}
          </div>
          <div className="flex justify-center gap-2 no-print">
            <button type="button" onClick={copyLink} className="btn-secondary rounded-full text-xs">
              <Copy className="h-3.5 w-3.5" />
              Copiar link
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-primary rounded-full text-xs px-5"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir cartel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

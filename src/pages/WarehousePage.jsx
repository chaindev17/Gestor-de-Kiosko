import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardList,
  Edit3,
  Eye,
  EyeOff,
  FileWarning,
  Globe,
  Image as ImageIcon,
  Lock,
  Package,
  PackagePlus,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Truck,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatCup, formatDate, formatDateTime, formatNumber } from '../lib/format.js';
import { canUserAccess, hasPermissionFlag } from '../lib/permissions.js';
import StatCard from '../components/StatCard.jsx';
import Modal from '../components/Modal.jsx';
import ImagePickerField from '../components/ImagePickerField.jsx';

const CATEGORIES = [
  'Alimentos Básicos',
  'Cárnicos y Embutidos',
  'Lácteos',
  'Bebidas y Refrescos',
  'Confituras y Panadería',
  'Aseo y Hogar',
  'Ferretería y Piezas',
  'Electrónica y Accesorios',
  'Útiles y Miscelánea',
  'Otros',
];

const UNITS = [
  { value: 'u', label: 'Unidad (u)' },
  { value: 'kg', label: 'Kilogramo (kg)' },
  { value: 'lb', label: 'Libra (lb)' },
  { value: 'L', label: 'Litro (L)' },
  { value: 'paq', label: 'Paquete (paq)' },
  { value: 'caja', label: 'Caja' },
  { value: 'par', label: 'Par' },
  { value: 'm', label: 'Metro (m)' },
];

export default function WarehousePage({
  user,
  config,
  activeCompany,
  onPreviewCatalog,
  onRefreshBadges,
  notify,
}) {
  const [products, setProducts] = useState([]);
  const [privacy, setPrivacy] = useState({
    canViewGlobalCosts: false,
    canViewEntryCost: false,
    canEditPrices: false,
    canUploadPhotos: false,
    canPublishCatalog: false,
    canRegisterMermas: false,
  });
  const [catalogSettings, setCatalogSettings] = useState({
    catalog_enabled: true,
    catalog_show_out_of_stock: true,
    catalog_show_stock_qty: false,
  });
  const [fxRates, setFxRates] = useState(null);
  const [restocks, setRestocks] = useState([]);
  const [movements, setMovements] = useState([]);
  const [caps, setCaps] = useState([]);
  const [maxCash, setMaxCash] = useState(5000);
  const [tab, setTab] = useState('inventory');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const canEdit = canUserAccess(user, config, 'warehouse', 'canEdit');
  const canApprove = canUserAccess(user, config, 'warehouse', 'canApprove');
  const canReportMerma =
    user.role === 'jefe' || privacy.canRegisterMermas || hasPermissionFlag(user, config, 'register_mermas');
  const canRequestRestock = user.role === 'vendedor' || canEdit;
  const companyCode = activeCompany?.company_code || config?.company_code || 'kiosko-CEIBA1';

  // Modal unificado de Entrada de Almacén en 2 niveles:
  // entryMode: 'existing' (Nivel 1: producto ya creado) | 'new_with_entry' (Nivel 2: crear + foto + entrada en 1 paso)
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryMode, setEntryMode] = useState('existing');
  const [existingSearch, setExistingSearch] = useState('');
  const [receiptForm, setReceiptForm] = useState({
    product_id: '',
    quantity: 20,
    unit_cost_cup: '',
    destination: 'ALMACEN',
    kiosk_quantity: 10,
    supplier_name: 'Proveedor Mayorista',
    supplier_nit: '',
    invoice_number: '',
    payment_method: 'TRANSFERENCIA',
    payment_ref: '',
    batch_code: '',
    expiry_date: '',
    catalog_visible: true,
    reason: '',
  });

  const [newEntryForm, setNewEntryForm] = useState({
    name: '',
    sku: '',
    category: 'Alimentos Básicos',
    compatibility: '',
    image_url: '',
    catalog_description: '',
    quantity: 15,
    unit: 'u',
    destination: 'KIOSKO',
    kiosk_quantity: 10,
    warehouse_min_stock: 6,
    kiosk_min_stock: 3,
    kiosk_target_stock: 15,
    unit_cost_cup: '',
    sale_price_cup: '',
    catalog_visible: true,
    catalog_featured: false,
    is_price_capped: false,
    price_cap_cup: '',
    price_cap_resolution: 'Res. 225/2024 MFP',
    batch_code: '',
    expiry_date: '',
    supplier_name: 'Proveedor directo',
    invoice_number: '',
    payment_method: 'TRANSFERENCIA',
    payment_ref: '',
  });

  // Modal de edición integral de Ficha / Foto / Compatibilidad / Catálogo / Precio
  const [fichaModal, setFichaModal] = useState(null);
  const [fichaReturnToEntry, setFichaReturnToEntry] = useState(false);

  // Pase Almacén -> POS y Acta de Merma SC-2-16
  const [transferModal, setTransferModal] = useState(null);
  const [mermaModal, setMermaModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pRes, rRes, mRes] = await Promise.all([
        api.get('/api/warehouse/products'),
        api.get('/api/warehouse/restock-requests').catch(() => ({ requests: [] })),
        api.get('/api/warehouse/movements').catch(() => ({ movements: [] })),
      ]);
      setProducts(pRes.products || []);
      if (pRes.privacy) setPrivacy(pRes.privacy);
      if (pRes.catalog_settings) setCatalogSettings(pRes.catalog_settings);
      setFxRates(pRes.fx_rates || null);
      setCaps(pRes.mfp_res_225_caps || []);
      setMaxCash(pRes.max_cash_provider_payment_cup || 5000);
      setRestocks(rRes.requests || []);
      setMovements(mRes.movements || []);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingRestocks = useMemo(
    () => restocks.filter((r) => r.status === 'PENDIENTE'),
    [restocks]
  );
  const pendingMermas = useMemo(
    () => movements.filter((m) => m.type === 'MERMA' && m.status === 'PENDIENTE_APROBACION'),
    [movements]
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchQ =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.compatibility || '').toLowerCase().includes(q) ||
        (p.catalog_description || '').toLowerCase().includes(q);
      if (!matchQ) return false;
      const tot = Number(p.warehouse_stock || 0) + Number(p.kiosk_stock || 0);
      if (filter === 'LOW') return p.low_kiosk || p.low_warehouse;
      if (filter === 'OUT') return tot <= 0;
      if (filter === 'CATALOG') return Boolean(p.catalog_visible);
      if (filter === 'NO_PHOTO') return !p.image_url;
      if (filter === 'EXPIRING') return p.expiry_status !== 'VIGENTE';
      if (filter === 'CAPPED') return Boolean(p.is_price_capped);
      return true;
    });
  }, [products, search, filter]);

  const matchingExistingProducts = useMemo(() => {
    const q = existingSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.compatibility || '').toLowerCase().includes(q)
    );
  }, [products, existingSearch]);

  const selectedExisting = useMemo(
    () => products.find((p) => p.id === Number(receiptForm.product_id)) || null,
    [products, receiptForm.product_id]
  );

  const receiptTotal =
    (Number(receiptForm.quantity) || 0) * (Number(receiptForm.unit_cost_cup) || 0);
  const receiptBlocksCash =
    receiptForm.payment_method === 'EFECTIVO' &&
    receiptTotal > maxCash &&
    config?.strict_bancarizacion_block !== 0;

  const newEntryTotal =
    (Number(newEntryForm.quantity) || 0) * (Number(newEntryForm.unit_cost_cup) || 0);
  const newEntryBlocksCash =
    newEntryForm.payment_method === 'EFECTIVO' &&
    newEntryTotal > maxCash &&
    config?.strict_bancarizacion_block !== 0;

  const suggestedNewPrice = useMemo(() => {
    const cost = Number(newEntryForm.unit_cost_cup) || 0;
    if (cost <= 0) return 0;
    const indirect = Number(config?.indirect_cost_alloc_pct ?? 8);
    const maxM = Number(config?.max_regulated_margin_pct ?? 30);
    const targetM = Math.min(25, Math.max(8, maxM - 4));
    let p = Math.round(cost * (1 + indirect / 100) * (1 + targetM / 100));
    if (newEntryForm.is_price_capped && Number(newEntryForm.price_cap_cup) > 0) {
      p = Math.min(p, Number(newEntryForm.price_cap_cup));
    }
    return p;
  }, [newEntryForm.unit_cost_cup, newEntryForm.is_price_capped, newEntryForm.price_cap_cup, config]);

  function openEntryModal(mode = 'existing', preselectProduct = null) {
    const p = preselectProduct || products[0] || null;
    const stamp = new Date().toISOString().slice(5, 10).replace('-', '');
    setEntryMode(mode);
    setExistingSearch('');
    if (p) {
      setReceiptForm({
        product_id: p.id,
        quantity: 20,
        unit_cost_cup: p.unit_cost_cup ?? '',
        destination: 'ALMACEN',
        kiosk_quantity: 10,
        supplier_name: 'Proveedor Mayorista',
        supplier_nit: '',
        invoice_number: `FAC-${stamp}-${String(p.id).padStart(2, '0')}`,
        payment_method: 'TRANSFERENCIA',
        payment_ref: `TR-${Date.now().toString().slice(-6)}`,
        batch_code: p.current_batch || `LT-${stamp}`,
        expiry_date: p.next_expiry_date || '',
        catalog_visible: Boolean(p.catalog_visible),
        reason: 'Entrada de mercancía según factura/conduce',
      });
    }
    setNewEntryForm((f) => ({
      ...f,
      name: '',
      sku: '',
      compatibility: '',
      image_url: '',
      catalog_description: '',
      quantity: 15,
      unit_cost_cup: '',
      sale_price_cup: '',
      catalog_visible: true,
      catalog_featured: false,
      is_price_capped: false,
      price_cap_cup: '',
      batch_code: `LT-${stamp}`,
      expiry_date: '',
      invoice_number: `FAC-${stamp}-N`,
      payment_ref: `TR-${Date.now().toString().slice(-6)}`,
    }));
    setEntryOpen(true);
  }

  function openFichaModal(product, returnToEntry = false) {
    setFichaReturnToEntry(returnToEntry);
    if (returnToEntry) setEntryOpen(false);
    setFichaModal({
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      compatibility: product.compatibility || '',
      unit: product.unit,
      image_url: product.image_url || '',
      catalog_description: product.catalog_description || '',
      catalog_visible: Boolean(product.catalog_visible),
      catalog_featured: Boolean(product.catalog_featured),
      unit_cost_cup: product.unit_cost_cup ?? '',
      sale_price_cup: product.sale_price_cup,
      original_price_cup: product.sale_price_cup,
      price_reason: '',
      warehouse_min_stock: product.warehouse_min_stock,
      kiosk_min_stock: product.kiosk_min_stock,
      kiosk_target_stock: product.kiosk_target_stock,
      current_batch: product.current_batch || '',
      next_expiry_date: product.next_expiry_date || '',
      pending_price_request: product.pending_price_request || null,
      cost_sheet: product.cost_sheet || null,
    });
  }

  async function handleReceiptSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/api/warehouse/receipts', {
        ...receiptForm,
        product_id: Number(receiptForm.product_id),
        quantity: Number(receiptForm.quantity),
        unit_cost_cup: Number(receiptForm.unit_cost_cup),
        kiosk_quantity: Number(receiptForm.kiosk_quantity || 0),
      });
      notify(
        `Entrada ${res.doc_number} registrada${res.transfer_doc ? ` + pase a POS ${res.transfer_doc}` : ''}. Stock y catálogo actualizados al instante.`
      );
      setEntryOpen(false);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateWithEntry(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...newEntryForm,
        quantity: Number(newEntryForm.quantity || 0),
        kiosk_quantity: Number(newEntryForm.kiosk_quantity || 0),
        unit_cost_cup: Number(newEntryForm.unit_cost_cup || 0),
        sale_price_cup: Number(newEntryForm.sale_price_cup || suggestedNewPrice || 0),
        warehouse_min_stock: Number(newEntryForm.warehouse_min_stock || 0),
        kiosk_min_stock: Number(newEntryForm.kiosk_min_stock || 0),
        kiosk_target_stock: Number(newEntryForm.kiosk_target_stock || 10),
        price_cap_cup: newEntryForm.is_price_capped ? Number(newEntryForm.price_cap_cup) : null,
      };
      const res = await api.post('/api/warehouse/products/create-with-entry', payload);
      const pendingNote =
        res.price_status === 'PENDING_APPROVAL'
          ? ' (precio personalizado enviado a aprobación del Jefe)'
          : '';
      notify(
        `Producto ${res.sku} «${res.name}» creado con entrada${res.doc_number ? ` ${res.doc_number}` : ''}${res.catalog_visible ? ' y publicado en Catálogo público' : ''}${pendingNote}.`
      );
      setEntryOpen(false);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveFicha(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: fichaModal.name,
        category: fichaModal.category,
        compatibility: fichaModal.compatibility,
        unit: fichaModal.unit,
        image_url: fichaModal.image_url,
        catalog_description: fichaModal.catalog_description,
        catalog_visible: fichaModal.catalog_visible,
        catalog_featured: fichaModal.catalog_featured,
        sale_price_cup: Number(fichaModal.sale_price_cup),
        price_reason: fichaModal.price_reason,
        warehouse_min_stock: Number(fichaModal.warehouse_min_stock),
        kiosk_min_stock: Number(fichaModal.kiosk_min_stock),
        kiosk_target_stock: Number(fichaModal.kiosk_target_stock),
        current_batch: fichaModal.current_batch,
        next_expiry_date: fichaModal.next_expiry_date,
      };
      if (privacy.canViewGlobalCosts && fichaModal.unit_cost_cup !== '') {
        payload.unit_cost_cup = Number(fichaModal.unit_cost_cup);
      }
      const res = await api.put(`/api/warehouse/products/${fichaModal.id}/ficha`, payload);
      if (res.price_status === 'PENDING_APPROVAL') {
        notify(
          'Ficha y foto guardadas al instante. Tu propuesta de precio quedó pendiente de aprobación del Jefe.'
        );
      } else {
        notify('Ficha, foto y estado en Catálogo actualizados correctamente.');
      }
      const backToEntry = fichaReturnToEntry;
      const editedId = fichaModal.id;
      setFichaModal(null);
      setFichaReturnToEntry(false);
      await load();
      onRefreshBadges?.();
      if (backToEntry) {
        setReceiptForm((f) => ({ ...f, product_id: editedId }));
        setEntryMode('existing');
        setEntryOpen(true);
      }
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickToggleCatalog(p) {
    if (!privacy.canPublishCatalog && user.role !== 'jefe') {
      notify('No tienes permiso para cambiar la visibilidad pública del catálogo.', 'error');
      return;
    }
    try {
      const next = !p.catalog_visible;
      await api.put(`/api/warehouse/products/${p.id}/ficha`, { catalog_visible: next });
      notify(
        next
          ? `«${p.name}» visible en el Catálogo público.`
          : `«${p.name}» ocultado del Catálogo público.`
      );
      await load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function handleTransfer(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/api/warehouse/transfers', {
        product_id: transferModal.product.id,
        quantity: Number(transferModal.quantity),
        reason: transferModal.reason,
      });
      notify(`Vale SC-2-09 ${res.doc_number} despachado a Mostrador (POS) e IPV actualizado.`);
      setTransferModal(null);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestRestock(p) {
    try {
      await api.post('/api/warehouse/restock-requests', {
        product_id: p.id,
        notes: `Reposición solicitada desde Almacén y Stock por ${user.full_name}`,
      });
      notify(`Solicitud de reposición enviada para «${p.name}».`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function handleFulfillRestock(id) {
    try {
      const res = await api.post(`/api/warehouse/restock-requests/${id}/fulfill`, {});
      notify(`Despachado ${res.doc_number} a Mostrador (POS) e IPV en vivo actualizado.`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function handleFulfillAll() {
    try {
      const res = await api.post('/api/warehouse/restock-requests/fulfill-all', {});
      notify(`${res.count} productos despachados automáticamente a Mostrador (POS).`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function handleCreateMerma(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/api/warehouse/mermas', {
        product_id: Number(mermaModal.product_id),
        quantity: Number(mermaModal.quantity),
        location: mermaModal.location,
        reason: mermaModal.reason,
      });
      notify(`Acta de Merma ${res.doc_number} registrada para aprobación del Jefe / Economía.`);
      setMermaModal(null);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDecideMerma(id, decision) {
    try {
      const res = await api.post(`/api/warehouse/mermas/${id}/decide`, { decision });
      notify(
        decision === 'APROBAR'
          ? `Merma ${res.doc_number} aprobada: stock, IPV y Catálogo público sincronizados.`
          : `Merma ${res.doc_number} rechazada.`
      );
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  const totalWhCost = products.reduce((a, p) => a + Number(p.warehouse_value_cup || 0), 0);
  const totalKioskCost = products.reduce((a, p) => a + Number(p.kiosk_value_cup || 0), 0);
  const outOfStockCount = products.filter(
    (p) => Number(p.warehouse_stock || 0) + Number(p.kiosk_stock || 0) <= 0
  ).length;
  const publishedCount = products.filter((p) => p.catalog_visible).length;
  const withPhotoCount = products.filter((p) => Boolean(p.image_url)).length;
  const lowCount = products.filter((p) => p.low_kiosk || p.low_warehouse).length;

  return (
    <div className="space-y-5">
      {/* Cabecera de acciones principales */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Almacén, Entradas y Sincronización con Catálogo
          </h2>
          <p className="text-xs text-slate-500">
            {privacy.canViewGlobalCosts
              ? 'Control integral SC-2-04 / SC-2-09 / SC-2-16, costos privados, fotos optimizadas y publicación directa en Catálogo.'
              : canEdit
                ? 'Entradas de mercancía, fotos optimizadas, pases a Mostrador (POS) y publicación en Catálogo. Cambios de precio requieren aprobación del Jefe.'
                : 'Consulta rápida de existencias, compatibilidad, fotos y precios públicos de venta (costos y proveedores reservados).'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => openEntryModal('existing')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 shadow-xs cursor-pointer"
              >
                <Truck className="h-3.5 w-3.5" />
                Entrada de mercancía
              </button>
              <button
                type="button"
                onClick={() => openEntryModal('new_with_entry')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-800 shadow-xs cursor-pointer"
              >
                <PackagePlus className="h-3.5 w-3.5" />
                Nuevo + Entrada y Foto
              </button>
            </>
          )}
          {canReportMerma && (
            <button
              type="button"
              onClick={() =>
                setMermaModal({
                  product_id: products[0]?.id || '',
                  quantity: 1,
                  location: canEdit ? 'ALMACEN' : 'KIOSKO',
                  reason: '',
                })
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 cursor-pointer"
            >
              <FileWarning className="h-3.5 w-3.5" />
              Merma (SC-2-16)
            </button>
          )}
          {catalogSettings.catalog_enabled && onPreviewCatalog && (
            <button
              type="button"
              onClick={() => onPreviewCatalog(companyCode)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5 text-emerald-600" />
              Ver Catálogo
            </button>
          )}
        </div>
      </div>

      {/* KPIs adaptados estrictamente a la visibilidad del usuario */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {privacy.canViewGlobalCosts ? (
          <>
            <StatCard
              label="Valor en Almacén (189)"
              value={formatCup(totalWhCost)}
              sub={
                fxRates
                  ? `≈ ${formatNumber(totalWhCost / fxRates.usd, 0)} USD ref. · ${products.length} productos`
                  : `${products.length} productos activos`
              }
              icon={Package}
              accent="blue"
            />
            <StatCard
              label="Valor en Mostrador (190)"
              value={formatCup(totalKioskCost)}
              sub="Existencias listas para POS"
              icon={Truck}
              accent="emerald"
            />
          </>
        ) : (
          <>
            <StatCard
              label="Productos en inventario"
              value={`${products.length} ítems`}
              sub={`${products.length - outOfStockCount} con stock disponible`}
              icon={Package}
              accent="blue"
            />
            <StatCard
              label="Stock bajo o agotado"
              value={`${lowCount} alertas`}
              sub={outOfStockCount > 0 ? `${outOfStockCount} agotado(s) (0 stock)` : 'Sin productos en cero'}
              icon={AlertTriangle}
              accent={lowCount > 0 ? 'amber' : 'emerald'}
            />
          </>
        )}
        <StatCard
          label="Catálogo y Fotos"
          value={`${publishedCount} / ${products.length}`}
          sub={`${withPhotoCount} con foto · 0 stock → ${catalogSettings.catalog_show_out_of_stock ? '«Agotado»' : 'Oculto'}`}
          icon={Camera}
          accent="emerald"
        />
        <StatCard
          label="Reposición y Mermas"
          value={`${pendingRestocks.length} / ${pendingMermas.length}`}
          sub={`${pendingRestocks.length} pases POS · ${pendingMermas.length} mermas pendientes`}
          icon={ClipboardList}
          accent={pendingRestocks.length + pendingMermas.length > 0 ? 'amber' : 'slate'}
        />
      </div>

      {/* Pestañas */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'inventory', label: `Inventario y Fichas (${products.length})` },
            ...(canEdit || pendingRestocks.length > 0
              ? [{ id: 'restocks', label: `Pases a POS (${pendingRestocks.length})` }]
              : []),
            ...(canEdit || canApprove
              ? [
                  { id: 'kardex', label: `Movimientos SC (${movements.length})` },
                  ...(pendingMermas.length > 0
                    ? [{ id: 'mermas', label: `Aprobar Mermas (${pendingMermas.length})` }]
                    : []),
                ]
              : []),
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'inventory' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre, SKU o compatibilidad..."
                className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs w-56 focus:border-slate-900 focus:outline-none"
              />
            </div>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="ALL">Todos</option>
              <option value="LOW">Stock crítico</option>
              <option value="OUT">Agotados (0 stock)</option>
              <option value="CATALOG">En Catálogo público</option>
              <option value="NO_PHOTO">Sin foto cargada</option>
              <option value="EXPIRING">Vencidos / por vencer</option>
              <option value="CAPPED">Topados MFP Res. 225</option>
            </select>
          </div>
        )}
      </div>

      {/* TAB 1: INVENTARIO, FOTOS Y CATÁLOGO */}
      {tab === 'inventory' && (
        <div className="rounded-2xl bg-white border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3.5 py-3 text-left">Producto / Compatibilidad</th>
                  <th className="px-3 py-3 text-right">Almacén</th>
                  <th className="px-3 py-3 text-right">Mostrador (POS)</th>
                  {privacy.canViewEntryCost && (
                    <th className="px-3 py-3 text-right">
                      <span className="inline-flex items-center gap-1">
                        <Lock className="h-2.5 w-2.5 text-slate-400" />
                        Costo CUP
                      </span>
                    </th>
                  )}
                  <th className="px-3 py-3 text-right">Precio CUP</th>
                  <th className="px-3 py-3 text-center">Catálogo público</th>
                  <th className="px-3.5 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Cargando inventario...
                    </td>
                  </tr>
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Ningún producto coincide con la búsqueda o filtro actual.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p) => {
                    const totalStock = Number(p.warehouse_stock || 0) + Number(p.kiosk_stock || 0);
                    const isOut = totalStock <= 0;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/70">
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center gap-3">
                            {/* Miniatura de foto optimizada */}
                            <button
                              type="button"
                              onClick={() =>
                                (canEdit || privacy.canUploadPhotos) && openFichaModal(p, false)
                              }
                              title={
                                canEdit || privacy.canUploadPhotos
                                  ? 'Subir o editar foto y ficha'
                                  : p.name
                              }
                              className={`h-11 w-11 shrink-0 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center ${
                                canEdit || privacy.canUploadPhotos
                                  ? 'hover:border-slate-900 cursor-pointer'
                                  : ''
                              }`}
                            >
                              {p.image_url ? (
                                <img
                                  src={p.image_url}
                                  alt={p.name}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-4 w-4 text-slate-300" />
                              )}
                            </button>

                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-slate-900">{p.name}</span>
                                {Boolean(p.is_price_capped) && (
                                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9.5px] font-bold text-blue-700">
                                    Res. 225
                                  </span>
                                )}
                                {p.expiry_status === 'PROXIMO_VENCER' && (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-800">
                                    Vence {formatDate(p.next_expiry_date)}
                                  </span>
                                )}
                                {p.expiry_status === 'VENCIDO' && (
                                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9.5px] font-bold text-red-700">
                                    VENCIDO
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 truncate max-w-md">
                                <span className="font-mono font-semibold text-slate-600">{p.sku}</span>
                                {' · '}
                                {p.category}
                                {p.compatibility ? ` · ${p.compatibility}` : ''}
                              </p>
                              {p.pending_price_request && (
                                <p className="text-[10px] font-bold text-amber-700 mt-0.5">
                                  Propuesta pendiente Jefe: {formatCup(p.pending_price_request.new_price_cup)}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <span
                            className={`font-bold ${
                              p.low_warehouse ? 'text-amber-700' : 'text-slate-900'
                            }`}
                          >
                            {formatNumber(p.warehouse_stock, p.warehouse_stock % 1 ? 2 : 0)} {p.unit}
                          </span>
                          <p className="text-[10px] text-slate-400">mín. {p.warehouse_min_stock}</p>
                        </td>

                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${
                              p.kiosk_stock <= 0
                                ? 'bg-red-100 text-red-800'
                                : p.low_kiosk
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            {formatNumber(p.kiosk_stock, p.kiosk_stock % 1 ? 2 : 0)} {p.unit}
                          </span>
                          <p className="text-[10px] text-slate-400 mt-0.5">mín. {p.kiosk_min_stock}</p>
                        </td>

                        {privacy.canViewEntryCost && (
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                            {p.unit_cost_cup !== null ? formatCup(p.unit_cost_cup) : '—'}
                            {privacy.canViewGlobalCosts && p.cost_sheet?.margin_pct !== undefined && (
                              <p className="text-[10px] text-slate-400">
                                margen {formatNumber(p.cost_sheet.margin_pct, 1)}%
                              </p>
                            )}
                          </td>
                        )}

                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <span className="font-extrabold text-slate-900">
                            {formatCup(p.sale_price_cup)}
                          </span>
                          {fxRates && (
                            <p className="text-[10px] text-slate-400">
                              ≈ {formatNumber(p.sale_price_cup / fxRates.usd, 2)} USD
                            </p>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-center">
                          <div className="inline-flex flex-col items-center gap-0.5">
                            <button
                              type="button"
                              disabled={!privacy.canPublishCatalog && user.role !== 'jefe'}
                              onClick={() => handleQuickToggleCatalog(p)}
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold transition-colors ${
                                p.catalog_visible
                                  ? isOut
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-emerald-100 text-emerald-900'
                                  : 'bg-slate-100 text-slate-500'
                              } ${
                                privacy.canPublishCatalog || user.role === 'jefe'
                                  ? 'hover:opacity-80 cursor-pointer'
                                  : 'cursor-default'
                              }`}
                            >
                              {p.catalog_visible ? (
                                <Eye className="h-3 w-3" />
                              ) : (
                                <EyeOff className="h-3 w-3" />
                              )}
                              {!p.catalog_visible
                                ? 'Oculto'
                                : isOut
                                  ? catalogSettings.catalog_show_out_of_stock
                                    ? 'Agotado'
                                    : 'Auto-oculto'
                                  : 'Publicado'}
                            </button>
                          </div>
                        </td>

                        <td className="px-3.5 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            {canEdit && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEntryModal('existing', p)}
                                  title="Dar entrada SC-2-04 a este producto"
                                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-800 cursor-pointer"
                                >
                                  <Plus className="h-3 w-3" />
                                  Entrada
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openFichaModal(p, false)}
                                  title="Editar ficha, foto, compatibilidad, catálogo o precio"
                                  className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 hover:border-slate-900 px-2 py-1 text-[11px] font-semibold text-slate-800 cursor-pointer"
                                >
                                  <Edit3 className="h-3 w-3" />
                                  Ficha
                                </button>
                                <button
                                  type="button"
                                  disabled={p.warehouse_stock <= 0}
                                  onClick={() =>
                                    setTransferModal({
                                      product: p,
                                      quantity: Math.min(
                                        p.warehouse_stock,
                                        Math.max(1, p.kiosk_target_stock - p.kiosk_stock)
                                      ),
                                      reason: `Pase a Mostrador (FEFO ${p.current_batch || 'vigente'})`,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-35 cursor-pointer"
                                >
                                  POS <ArrowRight className="h-3 w-3" />
                                </button>
                              </>
                            )}
                            {!canEdit && canRequestRestock && p.warehouse_stock > 0 && p.low_kiosk && (
                              <button
                                type="button"
                                onClick={() => handleRequestRestock(p)}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer"
                              >
                                <Send className="h-3 w-3" />
                                Pedir a almacén
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: ÓRDENES DE REABASTECIMIENTO AL MOSTRADOR */}
      {tab === 'restocks' && (
        <div className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Órdenes de Pase Almacén → Mostrador (Modelo SC-2-09)
              </h3>
              <p className="text-xs text-slate-500">
                Actualizan existencias de mostrador, IPV del turno activo y cuenta 190 NCIF al instante.
              </p>
            </div>
            {pendingRestocks.length > 0 && canEdit && (
              <button
                type="button"
                onClick={handleFulfillAll}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Despachar las {pendingRestocks.length} órdenes ahora
              </button>
            )}
          </div>

          <div className="space-y-2">
            {restocks.map((r) => (
              <div
                key={r.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
                  r.status === 'PENDIENTE'
                    ? 'border-amber-200 bg-amber-50/50'
                    : 'border-slate-100 bg-slate-50/60'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{r.product_name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        r.status === 'PENDIENTE'
                          ? r.priority === 'URGENTE'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-200 text-amber-900'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {r.status === 'PENDIENTE' ? r.priority : 'DESPACHADA'}
                    </span>
                    <span className="text-[11px] text-slate-400">Origen: {r.origin}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Solicitado: <strong>{r.suggested_qty} {r.unit}</strong> · Mostrador: {r.kiosk_stock}{' '}
                    {r.unit} · Almacén: {r.warehouse_stock} {r.unit}
                  </p>
                </div>
                {r.status === 'PENDIENTE' && canEdit && (
                  <button
                    type="button"
                    onClick={() => handleFulfillRestock(r.id)}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    Emitir SC-2-09
                  </button>
                )}
              </div>
            ))}
            {restocks.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-8">
                Sin órdenes de pase pendientes.
              </p>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: KARDEX OFICIAL SC */}
      {tab === 'kardex' && (
        <div className="rounded-2xl bg-white border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">Modelo SC</th>
                  <th className="px-3 py-3 text-left">Tipo</th>
                  <th className="px-3 py-3 text-left">Producto</th>
                  <th className="px-3 py-3 text-right">Cantidad</th>
                  {privacy.canViewEntryCost && (
                    <th className="px-3 py-3 text-right">Importe Costo</th>
                  )}
                  <th className="px-3 py-3 text-left">Proveedor / Detalle</th>
                  <th className="px-3 py-3 text-left">Ejecutado por</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 font-mono font-bold text-slate-900">{m.doc_number}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                        {m.type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{m.product_name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold">
                      {m.quantity} {m.unit}
                    </td>
                    {privacy.canViewEntryCost && (
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {m.total_cost_cup !== null ? formatCup(m.total_cost_cup) : '—'}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-slate-500 max-w-xs truncate">
                      {m.supplier_name
                        ? `${m.supplier_name} (${m.payment_method || ''})`
                        : m.reason}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">
                      <p className="font-medium text-slate-700">{m.created_by_name || 'Sistema'}</p>
                      <p className="text-[10px] text-slate-400">{formatDateTime(m.created_at)}</p>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          m.status === 'APLICADO'
                            ? 'bg-emerald-50 text-emerald-700'
                            : m.status === 'RECHAZADO'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: APROBACIÓN DE ACTAS DE MERMA SC-2-16 */}
      {tab === 'mermas' && canApprove && (
        <div className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-xs space-y-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Aprobación de Actas de Merma y Rotura (Modelo SC-2-16 — Res. 60/22)
            </h3>
            <p className="text-xs text-slate-500">
              Al aprobar se descuenta del stock real, actualiza el IPV y marca «Agotado» en el Catálogo si llega a 0.
            </p>
          </div>
          {pendingMermas.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-xs"
            >
              <div>
                <p className="font-bold text-slate-900">
                  {m.doc_number} — {m.product_name} ({m.quantity} {m.unit})
                </p>
                <p className="text-slate-600 mt-0.5">{m.reason}</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Reportado por: <strong>{m.created_by_name}</strong>
                  {m.total_cost_cup !== null ? (
                    <>
                      {' · '}Impacto contable: <strong>{formatCup(m.total_cost_cup)}</strong>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDecideMerma(m.id, 'APROBAR')}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar SC-2-16
                </button>
                <button
                  type="button"
                  onClick={() => handleDecideMerma(m.id, 'RECHAZAR')}
                  className="inline-flex items-center gap-1 rounded-lg bg-white border border-red-200 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                >
                  <XCircle className="h-3.5 w-3.5" /> Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ========================================================================
          MODAL UNIFICADO: ENTRADA DE ALMACÉN EN 2 NIVELES (SC-2-04 + FOTO + CATÁLOGO)
         ======================================================================== */}
      <Modal
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        title="Entrada de Almacén (2 modalidades)"
        subtitle="Ingresa mercancía a un producto existente o crea ficha + foto optimizada + entrada en un solo paso"
        maxWidth="max-w-3xl"
      >
        {/* Selector de los 2 niveles */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 mb-4">
          <button
            type="button"
            onClick={() => setEntryMode('existing')}
            className={`rounded-lg py-2 px-3 text-xs font-bold transition-all cursor-pointer ${
              entryMode === 'existing'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            1. Producto ya existente
          </button>
          <button
            type="button"
            onClick={() => setEntryMode('new_with_entry')}
            className={`rounded-lg py-2 px-3 text-xs font-bold transition-all cursor-pointer ${
              entryMode === 'new_with_entry'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            2. Crear producto nuevo + Entrada
          </button>
        </div>

        {/* NIVEL 1: ENTRADA DE PRODUCTO YA EXISTENTE */}
        {entryMode === 'existing' && (
          <form onSubmit={handleReceiptSubmit} className="space-y-4 text-xs">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
              <div className="grid sm:grid-cols-2 gap-2.5">
                <label className="block">
                  <span className="font-semibold text-slate-700">Filtrar por nombre, SKU o compatibilidad</span>
                  <input
                    value={existingSearch}
                    onChange={(e) => {
                      const val = e.target.value;
                      setExistingSearch(val);
                      const first = products.find(
                        (x) =>
                          x.name.toLowerCase().includes(val.toLowerCase()) ||
                          x.sku.toLowerCase().includes(val.toLowerCase()) ||
                          (x.compatibility || '').toLowerCase().includes(val.toLowerCase())
                      );
                      if (first) {
                        setReceiptForm((f) => ({
                          ...f,
                          product_id: first.id,
                          unit_cost_cup: first.unit_cost_cup ?? f.unit_cost_cup,
                          batch_code: first.current_batch || f.batch_code,
                          catalog_visible: Boolean(first.catalog_visible),
                        }));
                      }
                    }}
                    placeholder="Buscar producto..."
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">Producto seleccionado *</span>
                  <select
                    value={receiptForm.product_id}
                    onChange={(e) => {
                      const prod = products.find((x) => x.id === Number(e.target.value));
                      setReceiptForm((f) => ({
                        ...f,
                        product_id: e.target.value,
                        unit_cost_cup: prod?.unit_cost_cup ?? f.unit_cost_cup,
                        batch_code: prod?.current_batch || f.batch_code,
                        catalog_visible: Boolean(prod?.catalog_visible ?? true),
                      }));
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium"
                  >
                    {matchingExistingProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name} (Alm: {p.warehouse_stock} / POS: {p.kiosk_stock} {p.unit})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Resumen del producto seleccionado + Botón directo Editar ficha / Foto / Precio */}
              {selectedExisting && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-slate-200 p-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                      {selectedExisting.image_url ? (
                        <img
                          src={selectedExisting.image_url}
                          alt={selectedExisting.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Camera className="h-4 w-4 text-slate-300" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">{selectedExisting.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        Precio público: <strong>{formatCup(selectedExisting.sale_price_cup)}</strong> ·{' '}
                        {selectedExisting.image_url ? 'Con foto' : 'Sin foto'} ·{' '}
                        {selectedExisting.catalog_visible ? 'En Catálogo' : 'Oculto en Catálogo'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openFichaModal(selectedExisting, true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-3 py-1.5 text-[11px] font-bold hover:bg-slate-800 cursor-pointer shrink-0"
                  >
                    <Edit3 className="h-3 w-3" />
                    Editar ficha / Foto / Precio
                  </button>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="font-semibold text-slate-700">Cantidad a ingresar *</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  required
                  value={receiptForm.quantity}
                  onChange={(e) => setReceiptForm({ ...receiptForm, quantity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Costo de entrada (CUP, privado) *</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={receiptForm.unit_cost_cup}
                  onChange={(e) => setReceiptForm({ ...receiptForm, unit_cost_cup: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Destino de la mercancía</span>
                <select
                  value={receiptForm.destination}
                  onChange={(e) => setReceiptForm({ ...receiptForm, destination: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="ALMACEN">Almacén (reserva)</option>
                  <option value="KIOSKO">Directo a Mostrador (POS)</option>
                  <option value="MIXTO">Repartir Almacén + POS</option>
                </select>
              </label>
            </div>

            {receiptForm.destination === 'MIXTO' && (
              <label className="block">
                <span className="font-semibold text-slate-700">
                  ¿Cuántas unidades pasan ahora mismo al Mostrador (POS)?
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={receiptForm.quantity}
                  value={receiptForm.kiosk_quantity}
                  onChange={(e) => setReceiptForm({ ...receiptForm, kiosk_quantity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="font-semibold text-slate-700">Proveedor *</span>
                <input
                  required
                  value={receiptForm.supplier_name}
                  onChange={(e) => setReceiptForm({ ...receiptForm, supplier_name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Nº Factura / Conduce / Documento *</span>
                <input
                  required
                  value={receiptForm.invoice_number}
                  onChange={(e) => setReceiptForm({ ...receiptForm, invoice_number: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Medio de pago (Res. 111 BCC)</span>
                <select
                  value={receiptForm.payment_method}
                  onChange={(e) => setReceiptForm({ ...receiptForm, payment_method: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="TRANSFERENCIA">Transferencia Cuenta Fiscal</option>
                  <option value="TRANSFERMOVIL">Transfermóvil B2B</option>
                  <option value="ENZONA">EnZona B2B</option>
                  <option value="CREDITO">Crédito proveedor (Cta. 405)</option>
                  <option value="EFECTIVO">Efectivo (solo ≤ {formatCup(maxCash)})</option>
                </select>
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Referencia bancaria</span>
                <input
                  value={receiptForm.payment_ref}
                  onChange={(e) => setReceiptForm({ ...receiptForm, payment_ref: e.target.value })}
                  placeholder="Ej. TR-884920"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Código de lote</span>
                <input
                  value={receiptForm.batch_code}
                  onChange={(e) => setReceiptForm({ ...receiptForm, batch_code: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Fecha de vencimiento (FEFO)</span>
                <input
                  type="date"
                  value={receiptForm.expiry_date}
                  onChange={(e) => setReceiptForm({ ...receiptForm, expiry_date: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </div>

            {privacy.canPublishCatalog && (
              <label className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3.5 py-2.5 cursor-pointer">
                <div>
                  <p className="font-bold text-emerald-950">Mostrar en Catálogo público de clientes</p>
                  <p className="text-[11px] text-emerald-800">
                    Solo muestra foto, nombre, compatibilidad, precio CUP y disponibilidad (jamás el costo ni proveedor).
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={receiptForm.catalog_visible}
                  onChange={(e) => setReceiptForm({ ...receiptForm, catalog_visible: e.target.checked })}
                  className="h-4 w-4 accent-emerald-700"
                />
              </label>
            )}

            <div
              className={`rounded-xl border p-3 flex items-center justify-between ${
                receiptBlocksCash
                  ? 'border-red-300 bg-red-50 text-red-800'
                  : 'border-slate-200 bg-slate-50 text-slate-800'
              }`}
            >
              <div>
                <p className="text-[11px] font-semibold">Importe total SC-2-04 (interno)</p>
                <p className="text-base font-extrabold tabular-nums">{formatCup(receiptTotal)}</p>
              </div>
              {receiptBlocksCash && (
                <div className="flex items-center gap-1.5 text-[11px] font-bold max-w-xs text-right">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  Res. 111/2023 BCC: supera {formatCup(maxCash)} en efectivo.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEntryOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-600 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || receiptBlocksCash || !receiptForm.product_id}
                className="rounded-lg bg-slate-900 px-5 py-2 font-bold text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                {saving ? 'Registrando...' : 'Registrar entrada SC-2-04'}
              </button>
            </div>
          </form>
        )}

        {/* NIVEL 2: CREAR PRODUCTO NUEVO + FOTO OPTIMIZADA + ENTRADA EN 1 SOLO PASO */}
        {entryMode === 'new_with_entry' && (
          <form onSubmit={handleCreateWithEntry} className="space-y-4 text-xs">
            {/* 1. Identificación */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                1. Identificación y Compatibilidad
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block sm:col-span-2">
                  <span className="font-semibold text-slate-700">Nombre del producto *</span>
                  <input
                    required
                    value={newEntryForm.name}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, name: e.target.value })}
                    placeholder="Ej. Aceite girasol 1L / Batería 12V / Café molido 250g"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">Código / SKU (opcional)</span>
                  <input
                    value={newEntryForm.sku}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, sku: e.target.value })}
                    placeholder="Auto si se deja vacío"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">Categoría *</span>
                  <select
                    value={newEntryForm.category}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, category: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="font-semibold text-slate-700">
                    Compatibilidad / Formato / Especificación
                  </span>
                  <input
                    value={newEntryForm.compatibility}
                    onChange={(e) =>
                      setNewEntryForm({ ...newEntryForm, compatibility: e.target.value })
                    }
                    placeholder="Ej. Envase PET 1L · Modelo universal 110V · Talla M/L"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
            </div>

            {/* 2. Imagen optimizada y Catálogo */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                2. Foto del producto (optimizada para datos móviles) y Descripción pública
              </p>
              <ImagePickerField
                value={newEntryForm.image_url}
                onChange={(img) => setNewEntryForm((f) => ({ ...f, image_url: img }))}
                label="Subir foto o tomar con cámara"
                disabled={!privacy.canUploadPhotos && user.role !== 'jefe'}
              />
              <label className="block">
                <span className="font-semibold text-slate-700">
                  Descripción corta para el cliente en el Catálogo
                </span>
                <input
                  value={newEntryForm.catalog_description}
                  onChange={(e) =>
                    setNewEntryForm({ ...newEntryForm, catalog_description: e.target.value })
                  }
                  placeholder="Ej. Sellado de fábrica, entrega inmediata o retiro en mostrador"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </div>

            {/* 3. Existencias y Ubicación */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                3. Existencias iniciales y Ubicación
              </p>
              <div className="grid sm:grid-cols-4 gap-3">
                <label className="block">
                  <span className="font-semibold text-slate-700">Cantidad inicial *</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={newEntryForm.quantity}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, quantity: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                  />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">Unidad *</span>
                  <select
                    value={newEntryForm.unit}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, unit: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    {UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">Stock mínimo alerta</span>
                  <input
                    type="number"
                    min="0"
                    value={newEntryForm.kiosk_min_stock}
                    onChange={(e) =>
                      setNewEntryForm({
                        ...newEntryForm,
                        kiosk_min_stock: e.target.value,
                        warehouse_min_stock: Math.max(2, Number(e.target.value || 0) * 2),
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-700">Ubicación entrada</span>
                  <select
                    value={newEntryForm.destination}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, destination: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="KIOSKO">Directo a Mostrador (POS)</option>
                    <option value="ALMACEN">Solo Almacén</option>
                    <option value="MIXTO">Almacén + Mostrador</option>
                  </select>
                </label>
              </div>

              {newEntryForm.destination === 'MIXTO' && (
                <label className="block">
                  <span className="font-semibold text-slate-700">Unidades que pasan a Mostrador (POS)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={newEntryForm.quantity}
                    value={newEntryForm.kiosk_quantity}
                    onChange={(e) =>
                      setNewEntryForm({ ...newEntryForm, kiosk_quantity: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              )}

              {Number(newEntryForm.quantity) > 0 && (
                <div className="grid sm:grid-cols-4 gap-3 pt-1">
                  <label className="block">
                    <span className="font-semibold text-slate-700">Proveedor (privado)</span>
                    <input
                      value={newEntryForm.supplier_name}
                      onChange={(e) =>
                        setNewEntryForm({ ...newEntryForm, supplier_name: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                    />
                  </label>
                  <label className="block">
                    <span className="font-semibold text-slate-700">Factura / Lote</span>
                    <input
                      value={newEntryForm.invoice_number}
                      onChange={(e) =>
                        setNewEntryForm({
                          ...newEntryForm,
                          invoice_number: e.target.value,
                          batch_code: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                    />
                  </label>
                  <label className="block">
                    <span className="font-semibold text-slate-700">Pago proveedor</span>
                    <select
                      value={newEntryForm.payment_method}
                      onChange={(e) =>
                        setNewEntryForm({ ...newEntryForm, payment_method: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                    >
                      <option value="TRANSFERENCIA">Transferencia</option>
                      <option value="TRANSFERMOVIL">Transfermóvil</option>
                      <option value="ENZONA">EnZona</option>
                      <option value="CREDITO">Crédito</option>
                      <option value="EFECTIVO">Efectivo</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="font-semibold text-slate-700">Vencimiento (opc.)</span>
                    <input
                      type="date"
                      value={newEntryForm.expiry_date}
                      onChange={(e) =>
                        setNewEntryForm({ ...newEntryForm, expiry_date: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* 4. Costo Privado, Precio Público CUP y Publicación en Catálogo */}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                4. Costo privado, Precio de venta público (CUP) y Catálogo
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                    <Lock className="h-3 w-3 text-amber-700" />
                    Costo unitario de entrada CUP (SOLO INTERNO) *
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={newEntryForm.unit_cost_cup}
                    onChange={(e) =>
                      setNewEntryForm({ ...newEntryForm, unit_cost_cup: e.target.value })
                    }
                    placeholder="Nunca visible al cliente ni en POS"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">
                    Precio de venta público (CUP){' '}
                    {suggestedNewPrice > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setNewEntryForm((f) => ({ ...f, sale_price_cup: suggestedNewPrice }))
                        }
                        className="ml-1 text-[10.5px] font-bold text-emerald-700 underline cursor-pointer"
                      >
                        Usar sugerido MFP: {suggestedNewPrice} CUP
                      </button>
                    )}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newEntryForm.sale_price_cup}
                    onChange={(e) =>
                      setNewEntryForm({ ...newEntryForm, sale_price_cup: e.target.value })
                    }
                    placeholder={
                      suggestedNewPrice > 0
                        ? `Auto MFP: ${suggestedNewPrice} CUP`
                        : 'Precio minorista CUP'
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                  />
                  {!privacy.canEditPrices && user.role !== 'jefe' && (
                    <p className="text-[10px] text-amber-700 mt-0.5">
                      Si difiere del precio sugerido MFP, quedará pendiente de aprobación del Jefe.
                    </p>
                  )}
                </label>
              </div>

              {/* Tope MFP Res. 225 opcional */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newEntryForm.is_price_capped}
                    onChange={(e) =>
                      setNewEntryForm({ ...newEntryForm, is_price_capped: e.target.checked })
                    }
                  />
                  Producto regulado por Res. 225/2024 MFP (precio topado)
                </label>
                {newEntryForm.is_price_capped && (
                  <select
                    onChange={(e) => {
                      const c = caps.find((x) => x.key === e.target.value);
                      if (c) {
                        setNewEntryForm((f) => ({
                          ...f,
                          price_cap_cup: c.cap_cup,
                          unit: c.unit,
                        }));
                      }
                    }}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-900"
                  >
                    <option value="">Elegir tope oficial...</option>
                    {caps.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.name} — {c.cap_cup} CUP/{c.unit}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Interruptor Mostrar en Catálogo público */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5">
                <label className="flex items-center gap-2.5 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={newEntryForm.catalog_visible}
                    onChange={(e) =>
                      setNewEntryForm({ ...newEntryForm, catalog_visible: e.target.checked })
                    }
                    className="h-4 w-4 accent-emerald-700"
                  />
                  <div>
                    <p className="font-bold text-emerald-950">Mostrar en Catálogo público</p>
                    <p className="text-[10.5px] text-emerald-800">
                      Aparece automáticamente con su foto, compatibilidad y precio en POS y en el Catálogo WhatsApp.
                    </p>
                  </div>
                </label>
                {newEntryForm.catalog_visible && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEntryForm.catalog_featured}
                      onChange={(e) =>
                        setNewEntryForm({ ...newEntryForm, catalog_featured: e.target.checked })
                      }
                      className="accent-emerald-700"
                    />
                    Destacar
                  </label>
                )}
              </div>
            </div>

            {newEntryBlocksCash && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-800 font-bold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                Res. 111/2023 BCC: Compra de {formatCup(newEntryTotal)} supera el límite en efectivo ({formatCup(maxCash)}). Seleccione pago electrónico o crédito.
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEntryOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-600 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || newEntryBlocksCash}
                className="rounded-lg bg-emerald-700 px-5 py-2 font-bold text-white hover:bg-emerald-800 disabled:opacity-40 cursor-pointer"
              >
                {saving ? 'Creando e ingresando...' : 'Crear producto, dar entrada y sincronizar'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ========================================================================
          MODAL: EDITAR FICHA / FOTO / COMPATIBILIDAD / PRECIO / CATÁLOGO
         ======================================================================== */}
      <Modal
        open={Boolean(fichaModal)}
        onClose={() => {
          const back = fichaReturnToEntry;
          setFichaModal(null);
          setFichaReturnToEntry(false);
          if (back) setEntryOpen(true);
        }}
        title={fichaModal ? `Editar Ficha — ${fichaModal.sku}` : ''}
        subtitle="Sincronizado en tiempo real con Mostrador (POS), Precios y Tablilla y Catálogo público"
        maxWidth="max-w-2xl"
      >
        {fichaModal && (
          <form onSubmit={handleSaveFicha} className="space-y-4 text-xs">
            <ImagePickerField
              value={fichaModal.image_url}
              onChange={(img) => setFichaModal((f) => ({ ...f, image_url: img }))}
              label="Foto del producto (≤800×800 WebP/JPEG)"
              disabled={!privacy.canUploadPhotos && user.role !== 'jefe'}
            />

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="font-semibold text-slate-700">Nombre del producto *</span>
                <input
                  required
                  value={fichaModal.name}
                  onChange={(e) => setFichaModal({ ...fichaModal, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Categoría</span>
                <input
                  value={fichaModal.category}
                  onChange={(e) => setFichaModal({ ...fichaModal, category: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="font-semibold text-slate-700">
                  Compatibilidad / Especificaciones (buscable en POS y visible en Catálogo)
                </span>
                <input
                  value={fichaModal.compatibility}
                  onChange={(e) => setFichaModal({ ...fichaModal, compatibility: e.target.value })}
                  placeholder="Ej. Formato 1 kg · Compatible con modelo X · Voltaje 110V"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="font-semibold text-slate-700">
                  Descripción corta para clientes (Catálogo WhatsApp)
                </span>
                <input
                  value={fichaModal.catalog_description}
                  onChange={(e) =>
                    setFichaModal({ ...fichaModal, catalog_description: e.target.value })
                  }
                  placeholder="Breve detalle comercial para el cliente"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 rounded-xl bg-slate-50 border border-slate-200 p-3">
              {privacy.canViewGlobalCosts && (
                <label className="block">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                    <Lock className="h-3 w-3 text-amber-700" /> Costo unitario CUP (privado)
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={fichaModal.unit_cost_cup}
                    onChange={(e) => setFichaModal({ ...fichaModal, unit_cost_cup: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                </label>
              )}
              <label className="block">
                <span className="font-semibold text-slate-700">
                  {privacy.canEditPrices
                    ? 'Precio de venta público (CUP)'
                    : 'Proponer nuevo precio CUP (aprueba el Jefe)'}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={fichaModal.sale_price_cup}
                  onChange={(e) => setFichaModal({ ...fichaModal, sale_price_cup: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold"
                />
                {fichaModal.cost_sheet?.max_legal_price_cup > 0 && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Máx. legal MFP: {formatCup(fichaModal.cost_sheet.max_legal_price_cup)}
                  </p>
                )}
              </label>
              {Math.abs(Number(fichaModal.sale_price_cup) - Number(fichaModal.original_price_cup)) >=
                0.01 && (
                <label className="block sm:col-span-2">
                  <span className="font-semibold text-slate-700">
                    Motivo del ajuste de precio (queda en historial con tu usuario)
                  </span>
                  <input
                    value={fichaModal.price_reason}
                    onChange={(e) => setFichaModal({ ...fichaModal, price_reason: e.target.value })}
                    placeholder="Ej. Nuevo lote de proveedor / ajuste comercial"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5"
                  />
                </label>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="font-semibold text-slate-700">Mín. Almacén</span>
                <input
                  type="number"
                  min="0"
                  value={fichaModal.warehouse_min_stock}
                  onChange={(e) =>
                    setFichaModal({ ...fichaModal, warehouse_min_stock: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Mín. Mostrador</span>
                <input
                  type="number"
                  min="0"
                  value={fichaModal.kiosk_min_stock}
                  onChange={(e) => setFichaModal({ ...fichaModal, kiosk_min_stock: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Vencimiento</span>
                <input
                  type="date"
                  value={fichaModal.next_expiry_date}
                  onChange={(e) =>
                    setFichaModal({ ...fichaModal, next_expiry_date: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </label>
            </div>

            {privacy.canPublishCatalog && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3.5 py-2.5">
                <label className="inline-flex items-center gap-2 font-bold text-emerald-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fichaModal.catalog_visible}
                    onChange={(e) =>
                      setFichaModal({ ...fichaModal, catalog_visible: e.target.checked })
                    }
                    className="h-4 w-4 accent-emerald-700"
                  />
                  Mostrar en Catálogo público
                </label>
                {fichaModal.catalog_visible && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fichaModal.catalog_featured}
                      onChange={(e) =>
                        setFichaModal({ ...fichaModal, catalog_featured: e.target.checked })
                      }
                      className="accent-emerald-700"
                    />
                    Producto destacado
                  </label>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const back = fichaReturnToEntry;
                  setFichaModal(null);
                  setFichaReturnToEntry(false);
                  if (back) setEntryOpen(true);
                }}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-600 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-5 py-2 font-bold text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                {saving
                  ? 'Guardando...'
                  : fichaReturnToEntry
                    ? 'Guardar y volver a la entrada'
                    : 'Guardar ficha y foto'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: SC-2-09 Transfer */}
      <Modal
        open={Boolean(transferModal)}
        onClose={() => setTransferModal(null)}
        title="Vale de Entrega Almacén → Mostrador (SC-2-09)"
        subtitle={
          transferModal
            ? `${transferModal.product.name} · Disponible en almacén: ${transferModal.product.warehouse_stock} ${transferModal.product.unit}`
            : ''
        }
      >
        {transferModal && (
          <form onSubmit={handleTransfer} className="space-y-3.5 text-xs">
            <label className="block">
              <span className="font-semibold text-slate-700">
                Cantidad a pasar a Mostrador (POS) *
              </span>
              <input
                type="number"
                step="0.01"
                min="0.1"
                max={transferModal.product.warehouse_stock}
                required
                value={transferModal.quantity}
                onChange={(e) => setTransferModal({ ...transferModal, quantity: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
              />
            </label>
            <label className="block">
              <span className="font-semibold text-slate-700">Observación / Lote FEFO</span>
              <input
                value={transferModal.reason}
                onChange={(e) => setTransferModal({ ...transferModal, reason: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTransferModal(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-600 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 cursor-pointer"
              >
                Emitir SC-2-09 y actualizar IPV
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: SC-2-16 Merma */}
      <Modal
        open={Boolean(mermaModal)}
        onClose={() => setMermaModal(null)}
        title="Reportar Acta de Merma, Rotura o Vencimiento (SC-2-16)"
        subtitle="Control Interno Res. 60/22 — Requiere aprobación del Jefe o Economía y sincroniza el Catálogo"
      >
        {mermaModal && (
          <form onSubmit={handleCreateMerma} className="space-y-3.5 text-xs">
            <label className="block">
              <span className="font-semibold text-slate-700">Producto *</span>
              <select
                value={mermaModal.product_id}
                onChange={(e) => setMermaModal({ ...mermaModal, product_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name} (Alm: {p.warehouse_stock} / POS: {p.kiosk_stock} {p.unit})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-semibold text-slate-700">Área donde ocurrió *</span>
                <select
                  value={mermaModal.location}
                  onChange={(e) => setMermaModal({ ...mermaModal, location: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="ALMACEN">Almacén</option>
                  <option value="KIOSKO">Mostrador (POS / IPV)</option>
                </select>
              </label>
              <label className="block">
                <span className="font-semibold text-slate-700">Cantidad afectada *</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  required
                  value={mermaModal.quantity}
                  onChange={(e) => setMermaModal({ ...mermaModal, quantity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
            <label className="block">
              <span className="font-semibold text-slate-700">Causa detallada del acta *</span>
              <textarea
                rows={2}
                required
                placeholder="Ej. Envase fracturado en manipulación, caducidad de lote..."
                value={mermaModal.reason}
                onChange={(e) => setMermaModal({ ...mermaModal, reason: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMermaModal(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-600 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700 cursor-pointer"
              >
                Emitir Acta SC-2-16
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
